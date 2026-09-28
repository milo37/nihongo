import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

interface PathPolicyEntry {
  path: string
  rationale: string
}

interface DeferredScope extends PathPolicyEntry {
  ownerSlice: number
}

interface AllowlistEntry extends DeferredScope {
  literal: string
}

export interface LiteralPolicy {
  version: number
  currentSlice: number
  scanRoot: string
  excludedPathPrefixes: PathPolicyEntry[]
  migratedPaths: string[]
  deferredScopes: DeferredScope[]
  allowlist: AllowlistEntry[]
}

export interface LiteralCandidate {
  path: string
  literal: string
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(scriptDirectory, '..')
const policyPath = resolve(scriptDirectory, 'phase9-ui-literal-policy.json')
const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as LiteralPolicy
const hangulPattern = /[\u3131-\u318e\uac00-\ud7a3]/u
const forbiddenPathCharacters = ['*', '?', '[', ']', '{', '}'] as const

const toPosixPath = (path: string): string => path.split(sep).join('/')

const normalizeLiteral = (literal: string): string => {
  return literal.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

const isWithinPath = (filePath: string, path: string): boolean => {
  return filePath === path || filePath.startsWith(`${path}/`)
}

const validatePolicy = (): void => {
  if (policy.version !== 1 || !Number.isInteger(policy.currentSlice)) {
    throw new Error('Phase 9 literal policy version/currentSlice is invalid.')
  }

  for (const entry of [
    ...policy.excludedPathPrefixes,
    ...policy.deferredScopes,
    ...policy.allowlist
  ]) {
    if (
      !entry.path ||
      forbiddenPathCharacters.some((character) =>
        entry.path.includes(character)
      ) ||
      !entry.rationale.trim()
    ) {
      throw new Error(`Invalid exact policy entry: ${JSON.stringify(entry)}`)
    }
  }

  for (const entry of policy.allowlist) {
    if (
      !entry.literal.trim() ||
      !Number.isInteger(entry.ownerSlice) ||
      entry.ownerSlice < 1
    ) {
      throw new Error(`Invalid allowlist entry: ${JSON.stringify(entry)}`)
    }
  }
}

const listSourceFiles = (directory: string): string[] => {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      return listSourceFiles(absolutePath)
    }

    if (
      !entry.isFile() ||
      !/\.tsx?$/u.test(entry.name) ||
      /(?:\.test|\.spec|\.stories)\.tsx?$/u.test(entry.name) ||
      entry.name.endsWith('.d.ts')
    ) {
      return []
    }

    return [absolutePath]
  })
}

const isTypeOnlyLiteral = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isTypeNode(current)) {
      return true
    }
    if (ts.isStatement(current) || ts.isExpression(current)) {
      return false
    }
    current = current.parent
  }
  return false
}

const shouldSkipStringLiteral = (node: ts.StringLiteral): boolean => {
  const parent = node.parent
  return (
    (ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) ||
    (ts.isExportDeclaration(parent) && parent.moduleSpecifier === node) ||
    (ts.isExternalModuleReference(parent) && parent.expression === node) ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent)) &&
      parent.name === node) ||
    (ts.isEnumMember(parent) && parent.initializer === node) ||
    isTypeOnlyLiteral(node)
  )
}

const collectCandidates = (absolutePath: string): LiteralCandidate[] => {
  const sourceText = readFileSync(absolutePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const sourcePath = toPosixPath(relative(webRoot, absolutePath))
  const literals = new Set<string>()

  const addLiteral = (value: string): void => {
    const normalized = normalizeLiteral(value)
    if (normalized && hangulPattern.test(normalized)) {
      literals.add(normalized)
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      addLiteral(node.text)
    } else if (ts.isStringLiteral(node) && !shouldSkipStringLiteral(node)) {
      addLiteral(node.text)
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      addLiteral(node.text)
    } else if (ts.isTemplateExpression(node)) {
      addLiteral(
        [
          node.head.text,
          ...node.templateSpans.map((span) => span.literal.text)
        ].join(' {{expression}} ')
      )
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return [...literals].map((literal) => ({ path: sourcePath, literal }))
}

type CandidateClassification =
  | { status: 'allowed'; allowlistIndex: number }
  | { status: 'deferred' | 'excluded' | 'unreviewed' }

export const classifyCandidate = (
  candidate: LiteralCandidate,
  literalPolicy: LiteralPolicy
): CandidateClassification => {
  if (
    literalPolicy.excludedPathPrefixes.some((entry) =>
      isWithinPath(candidate.path, entry.path)
    )
  ) {
    return { status: 'excluded' }
  }

  const allowlistIndex = literalPolicy.allowlist.findIndex(
    (entry) =>
      entry.path === candidate.path &&
      normalizeLiteral(entry.literal) === normalizeLiteral(candidate.literal)
  )
  if (allowlistIndex >= 0) {
    return { status: 'allowed', allowlistIndex }
  }

  const deferredScope = literalPolicy.deferredScopes.find((scope) =>
    isWithinPath(candidate.path, scope.path)
  )
  if (deferredScope && deferredScope.ownerSlice > literalPolicy.currentSlice) {
    return { status: 'deferred' }
  }

  return { status: 'unreviewed' }
}

const run = (): void => {
  validatePolicy()

  const candidates = listSourceFiles(resolve(webRoot, policy.scanRoot)).flatMap(
    collectCandidates
  )
  const excluded: LiteralCandidate[] = []
  const deferred: LiteralCandidate[] = []
  const allowed: LiteralCandidate[] = []
  const unreviewed: LiteralCandidate[] = []
  const matchedAllowlist = new Set<string>()

  for (const candidate of candidates) {
    const classification = classifyCandidate(candidate, policy)

    if (classification.status === 'excluded') {
      excluded.push(candidate)
      continue
    }
    if (classification.status === 'allowed') {
      matchedAllowlist.add(String(classification.allowlistIndex))
      allowed.push(candidate)
      continue
    }
    if (classification.status === 'deferred') {
      deferred.push(candidate)
      continue
    }

    unreviewed.push(candidate)
  }

  const staleAllowlist = policy.allowlist.filter(
    (_entry, index) => !matchedAllowlist.has(String(index))
  )
  const expiredDeferredScopes = policy.deferredScopes.filter(
    (scope) => scope.ownerSlice <= policy.currentSlice
  )

  const summary = {
    currentSlice: policy.currentSlice,
    candidates: candidates.length,
    excluded: excluded.length,
    deferred: deferred.length,
    allowed: allowed.length,
    unreviewed: unreviewed.length,
    staleAllowlist: staleAllowlist.length,
    expiredDeferredScopes: expiredDeferredScopes.length
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)

  if (
    unreviewed.length > 0 ||
    staleAllowlist.length > 0 ||
    expiredDeferredScopes.length > 0
  ) {
    if (unreviewed.length > 0) {
      process.stderr.write(
        `Unreviewed UI literals:\n${JSON.stringify(unreviewed, null, 2)}\n`
      )
    }
    if (staleAllowlist.length > 0) {
      process.stderr.write(
        `Stale allowlist entries:\n${JSON.stringify(staleAllowlist, null, 2)}\n`
      )
    }
    if (expiredDeferredScopes.length > 0) {
      process.stderr.write(
        `Expired deferred scopes:\n${JSON.stringify(expiredDeferredScopes, null, 2)}\n`
      )
    }
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run()
}
