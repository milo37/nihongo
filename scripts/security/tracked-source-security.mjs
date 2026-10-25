import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import {
  lstat as lstatDefault,
  readFile as readFileDefault,
  readlink as readlinkDefault
} from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { writeCanonicalEvidence } from './security-evidence.mjs'

const execFileDefault = promisify(execFileCallback)
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const EXACT_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/u
const ALLOWLIST_CLASSIFICATIONS = new Set([
  'DOCUMENTED_PLACEHOLDER',
  'SYNTHETIC_TEST_FIXTURE',
  'FORMAT_CANARY'
])
const NON_ALLOWLISTABLE_SECRET_RULES = new Set([
  'PRIVATE_KEY_PEM',
  'AWS_ACCESS_KEY_ID',
  'GITHUB_TOKEN',
  'GITLAB_TOKEN',
  'SLACK_TOKEN',
  'STRIPE_LIVE_SECRET',
  'GOOGLE_API_KEY',
  'NPM_TOKEN'
])

const STRONG_SECRET_RULES = [
  {
    ruleId: 'PRIVATE_KEY_PEM',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gu
  },
  { ruleId: 'AWS_ACCESS_KEY_ID', pattern: /\bAKIA[0-9A-Z]{16}\b/gu },
  {
    ruleId: 'GITHUB_TOKEN',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/gu
  },
  { ruleId: 'GITLAB_TOKEN', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/gu },
  { ruleId: 'SLACK_TOKEN', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu },
  {
    ruleId: 'STRIPE_LIVE_SECRET',
    pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/gu
  },
  { ruleId: 'GOOGLE_API_KEY', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/gu },
  { ruleId: 'NPM_TOKEN', pattern: /\bnpm_[A-Za-z0-9]{30,}\b/gu }
]

const SENSITIVE_ASSIGNMENT_PATTERN =
  /(?:["'`]?)(?:api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key|secret)(?:["'`]?)\s*[:=]\s*(?:["'`]([A-Za-z0-9+/=_-]{20,})["'`]|([A-Za-z0-9+/=_-]{20,})(?=\s*(?:#.*)?$))/gimu
const CREDENTIAL_URI_PATTERN =
  /\b(?:amqps?|mariadb|mongodb(?:\+srv)?|mysql|postgres(?:ql)?|rediss?):\/\/[^\s:/@]+:([^\s/@?#]{20,})@/giu

const SAFE_CREDENTIAL_MARKERS = [
  'changeme',
  'dummy',
  'example',
  'fake',
  'fixture',
  'mock',
  'placeholder',
  'replace',
  'test',
  'ci_'
]

const digest = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex')

const toPosixPath = (value) => value.replaceAll(path.sep, '/')

const getLineAndColumn = (text, offset) => {
  const prefix = text.slice(0, offset)
  const lines = prefix.split('\n')
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1
  }
}

const createFinding = ({ kind, ruleId, filePath, text, offset, rawMatch }) => {
  const { line, column } = getLineAndColumn(text, offset)
  return {
    kind,
    ruleId,
    path: toPosixPath(filePath),
    line,
    column,
    fingerprint: digest(`${ruleId}\0${toPosixPath(filePath)}\0${rawMatch}`)
  }
}

const compareFindings = (left, right) =>
  left.path.localeCompare(right.path) ||
  left.line - right.line ||
  left.column - right.column ||
  left.ruleId.localeCompare(right.ruleId)

const shannonEntropy = (value) => {
  const counts = new Map()
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1)
  }
  let entropy = 0
  for (const count of counts.values()) {
    const probability = count / value.length
    entropy -= probability * Math.log2(probability)
  }
  return entropy
}

const isHighEntropyCredential = (value) => {
  const lowered = value.toLowerCase()
  if (SAFE_CREDENTIAL_MARKERS.some((marker) => lowered.includes(marker))) {
    return false
  }
  const distinctCharacters = new Set(value).size
  if (/^[0-9a-f]{32,}$/iu.test(value)) {
    return distinctCharacters >= 8
  }
  return (
    value.length >= 24 &&
    /^[A-Za-z0-9+/=_-]+$/u.test(value) &&
    distinctCharacters >= 12 &&
    shannonEntropy(value) >= 4.2
  )
}

export const scanTrackedSecretText = ({ filePath, text }) => {
  const findings = []
  for (const { ruleId, pattern } of STRONG_SECRET_RULES) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      findings.push(
        createFinding({
          kind: 'SECRET',
          ruleId,
          filePath,
          text,
          offset: match.index,
          rawMatch: match[0]
        })
      )
    }
  }

  SENSITIVE_ASSIGNMENT_PATTERN.lastIndex = 0
  for (const match of text.matchAll(SENSITIVE_ASSIGNMENT_PATTERN)) {
    const candidate = match[1] ?? match[2] ?? ''
    if (!isHighEntropyCredential(candidate)) continue
    const candidateOffset = match.index + match[0].indexOf(candidate)
    findings.push(
      createFinding({
        kind: 'SECRET',
        ruleId: 'GENERIC_HIGH_ENTROPY_CREDENTIAL',
        filePath,
        text,
        offset: candidateOffset,
        rawMatch: candidate
      })
    )
  }

  CREDENTIAL_URI_PATTERN.lastIndex = 0
  for (const match of text.matchAll(CREDENTIAL_URI_PATTERN)) {
    const candidate = match[1] ?? ''
    let decodedCandidate = candidate
    try {
      decodedCandidate = decodeURIComponent(candidate)
    } catch {
      decodedCandidate = candidate
    }
    if (!isHighEntropyCredential(decodedCandidate)) continue
    const candidateOffset = match.index + match[0].indexOf(candidate)
    findings.push(
      createFinding({
        kind: 'SECRET',
        ruleId: 'CREDENTIAL_URI_PASSWORD',
        filePath,
        text,
        offset: candidateOffset,
        rawMatch: candidate
      })
    )
  }

  return findings.toSorted(compareFindings)
}

export const isWebRuntimeSourcePath = (filePath) => {
  const normalized = toPosixPath(filePath)
  return (
    normalized.startsWith('apps/web/src/') &&
    /\.(?:ts|tsx)$/u.test(normalized) &&
    !/\.(?:test|spec)\.[^.]+$/u.test(normalized) &&
    !normalized.includes('/test/') &&
    !normalized.includes('/__tests__/')
  )
}

const getPropertyName = (node) => {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node)
  ) {
    return node.text
  }
  return undefined
}

const getAccessName = (node) => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteral(node.argumentExpression)
  ) {
    return node.argumentExpression.text
  }
  return undefined
}

export const scanUnsafeHtmlSource = ({ filePath, sourceText }) => {
  if (!isWebRuntimeSourcePath(filePath)) return []
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const findings = []
  const addFinding = (node, ruleId) => {
    const offset = node.getStart(sourceFile)
    findings.push(
      createFinding({
        kind: 'UNSAFE_HTML',
        ruleId,
        filePath,
        text: sourceText,
        offset,
        rawMatch: node.getText(sourceFile)
      })
    )
  }

  const visit = (node) => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile)
      if (name === 'dangerouslySetInnerHTML') {
        addFinding(node, 'JSX_DANGEROUSLY_SET_INNER_HTML')
      } else if (name === 'srcDoc') {
        addFinding(node, 'DOM_SRC_DOC')
      }
    }

    if (
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node)
    ) {
      const name = getPropertyName(node.name)
      if (name === 'dangerouslySetInnerHTML') {
        addFinding(node, 'OBJECT_DANGEROUSLY_SET_INNER_HTML')
      } else if (name === 'srcDoc') {
        addFinding(node, 'DOM_SRC_DOC')
      }
    }

    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const name = getAccessName(node)
      if (name === 'innerHTML') addFinding(node, 'DOM_INNER_HTML')
      if (name === 'outerHTML') addFinding(node, 'DOM_OUTER_HTML')
      if (name === 'srcDoc') addFinding(node, 'DOM_SRC_DOC')
    }

    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
        addFinding(node, 'DYNAMIC_EVAL')
      }
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Function'
      ) {
        addFinding(node, 'DYNAMIC_FUNCTION')
      }
      if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text
        const owner = node.expression.expression
        if (method === 'insertAdjacentHTML') {
          addFinding(node, 'DOM_INSERT_ADJACENT_HTML')
        } else if (method === 'createContextualFragment') {
          addFinding(node, 'DOM_CONTEXTUAL_FRAGMENT')
        } else if (
          (method === 'write' || method === 'writeln') &&
          ts.isIdentifier(owner) &&
          owner.text === 'document'
        ) {
          addFinding(node, 'DOCUMENT_WRITE')
        } else if (method === 'setAttribute') {
          const firstArgument = node.arguments[0]
          if (
            firstArgument &&
            ts.isStringLiteral(firstArgument) &&
            /^on/iu.test(firstArgument.text)
          ) {
            addFinding(node, 'EVENT_HANDLER_ATTRIBUTE')
          }
        }
      }
    }

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'DOMParser') {
        addFinding(node, 'DOM_PARSER')
      } else if (node.expression.text === 'Function') {
        addFinding(node, 'DYNAMIC_FUNCTION')
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings.toSorted(compareFindings)
}

const assertExactObjectKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  const actual = Object.keys(value).toSorted()
  const wanted = [...expected].toSorted()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} has unknown or missing fields.`)
  }
}

export const validateSecretAllowlist = ({ document, now }) => {
  assertExactObjectKeys(document, ['schemaVersion', 'entries'], 'allowlist')
  if (document.schemaVersion !== 1 || !Array.isArray(document.entries)) {
    throw new Error('allowlist schema is invalid.')
  }
  const today = now.toISOString().slice(0, 10)
  const identities = new Set()
  return document.entries.map((entry, index) => {
    assertExactObjectKeys(
      entry,
      ['path', 'line', 'ruleId', 'fingerprint', 'classification', 'expiresOn'],
      `allowlist entry ${index}`
    )
    if (
      typeof entry.path !== 'string' ||
      !EXACT_PATH_PATTERN.test(entry.path) ||
      entry.path.startsWith('/') ||
      entry.path.split('/').includes('..') ||
      /[*?[\]\\]/u.test(entry.path) ||
      !Number.isSafeInteger(entry.line) ||
      entry.line < 1 ||
      typeof entry.ruleId !== 'string' ||
      NON_ALLOWLISTABLE_SECRET_RULES.has(entry.ruleId) ||
      typeof entry.fingerprint !== 'string' ||
      !SHA256_PATTERN.test(entry.fingerprint) ||
      !ALLOWLIST_CLASSIFICATIONS.has(entry.classification) ||
      typeof entry.expiresOn !== 'string' ||
      !DATE_PATTERN.test(entry.expiresOn) ||
      entry.expiresOn < today
    ) {
      throw new Error(`allowlist entry ${index} is invalid or expired.`)
    }
    const identity = [
      entry.path,
      entry.line,
      entry.ruleId,
      entry.fingerprint
    ].join('\0')
    if (identities.has(identity)) {
      throw new Error(`allowlist entry ${index} is duplicated.`)
    }
    identities.add(identity)
    return { ...entry }
  })
}

export const reconcileSecretAllowlist = ({ allowlist, findings }) => {
  const used = new Set()
  const activeFindings = []
  const suppressedFindings = []
  for (const finding of findings) {
    const index = allowlist.findIndex(
      (entry) =>
        entry.path === finding.path &&
        entry.line === finding.line &&
        entry.ruleId === finding.ruleId &&
        entry.fingerprint === finding.fingerprint
    )
    if (index === -1) activeFindings.push(finding)
    else {
      used.add(index)
      suppressedFindings.push(finding)
    }
  }
  return {
    activeFindings,
    suppressedFindings,
    unusedEntries: allowlist.filter((_, index) => !used.has(index))
  }
}

const assertRepositoryRelativePath = (filePath) => {
  const normalized = toPosixPath(filePath)
  if (
    path.posix.isAbsolute(normalized) ||
    normalized.length === 0 ||
    normalized.split('/').includes('..')
  ) {
    throw new Error('SECURITY_TRACKED_PATH_INVALID')
  }
  return normalized
}

export const runTrackedSourceSecurityGate = async ({
  repositoryRoot,
  allowlistPath,
  evidenceDirectory,
  now = new Date(),
  execFileImpl = execFileDefault,
  readFileImpl = readFileDefault,
  lstatImpl = lstatDefault,
  readlinkImpl = readlinkDefault
}) => {
  const execution = await execFileImpl(
    'git',
    ['ls-files', '-z', '--cached', '--'],
    {
      cwd: repositoryRoot,
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024
    }
  )
  const output = Buffer.isBuffer(execution.stdout)
    ? execution.stdout.toString('utf8')
    : String(execution.stdout)
  const files = output
    .split('\0')
    .filter(Boolean)
    .map(assertRepositoryRelativePath)
    .toSorted()
  const allowlistDocument = JSON.parse(
    await readFileImpl(allowlistPath, 'utf8')
  )
  const allowlist = validateSecretAllowlist({
    document: allowlistDocument,
    now
  })
  const secretFindings = []
  const unsafeHtmlFindings = []

  for (const filePath of files) {
    const absolutePath = path.resolve(repositoryRoot, filePath)
    if (
      absolutePath !== repositoryRoot &&
      !absolutePath.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)
    ) {
      throw new Error('SECURITY_TRACKED_PATH_INVALID')
    }
    let stats
    try {
      stats = await lstatImpl(absolutePath)
    } catch {
      throw new Error('SECURITY_TRACKED_FILE_UNREADABLE')
    }
    let text
    try {
      if (stats.isSymbolicLink()) {
        text = String(await readlinkImpl(absolutePath))
      } else if (stats.isFile()) {
        const content = await readFileImpl(absolutePath)
        const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content)
        if (buffer.includes(0)) continue
        text = buffer.toString('utf8')
      } else {
        throw new Error('not a regular tracked file')
      }
    } catch {
      throw new Error('SECURITY_TRACKED_FILE_UNREADABLE')
    }
    secretFindings.push(...scanTrackedSecretText({ filePath, text }))
    unsafeHtmlFindings.push(
      ...scanUnsafeHtmlSource({ filePath, sourceText: text })
    )
  }

  const reconciled = reconcileSecretAllowlist({
    allowlist,
    findings: secretFindings.toSorted(compareFindings)
  })
  const evidence = {
    schemaVersion: 1,
    kind: 'nihongo.tracked-source-security',
    status:
      reconciled.activeFindings.length === 0 &&
      reconciled.unusedEntries.length === 0 &&
      unsafeHtmlFindings.length === 0
        ? 'passed'
        : 'failed',
    scannedFileCount: files.length,
    activeSecretFindings: reconciled.activeFindings,
    suppressedSecretFindingCount: reconciled.suppressedFindings.length,
    unusedAllowlistEntryCount: reconciled.unusedEntries.length,
    unsafeHtmlFindings: unsafeHtmlFindings.toSorted(compareFindings)
  }
  await writeCanonicalEvidence({
    filePath: path.join(evidenceDirectory, 'tracked-source-security.json'),
    value: evidence
  })
  if (evidence.status !== 'passed') {
    throw new Error('SECURITY_TRACKED_SOURCE_GATE_FAILED')
  }
  return evidence
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectExecution) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
  )
  const evidenceDirectory =
    process.env.PHASE10_SECURITY_EVIDENCE_DIR ??
    path.join(repositoryRoot, 'test-results/phase10-evidence/security')
  runTrackedSourceSecurityGate({
    repositoryRoot,
    allowlistPath: path.join(
      repositoryRoot,
      'scripts/security/tracked-secret-allowlist.v1.json'
    ),
    evidenceDirectory
  })
    .then((evidence) => {
      process.stdout.write(
        `${JSON.stringify({
          event: 'phase10.tracked_source_security.passed',
          scannedFileCount: evidence.scannedFileCount
        })}\n`
      )
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          event: 'phase10.tracked_source_security.failed',
          errorCode:
            error instanceof Error ? error.message : 'SECURITY_UNKNOWN_FAILURE'
        })}\n`
      )
      process.exitCode = 1
    })
}
