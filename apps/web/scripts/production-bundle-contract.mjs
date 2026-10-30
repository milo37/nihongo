import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, readFile, readdir, readlink } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual, promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { validateProductionBundleRuntime } from './production-bundle-runtime-contract.mjs'
import { assertBrowserBuildGraph } from '../../../scripts/operations/browser-artifact-check.mjs'

export const phase10BundleBaseline = Object.freeze({
  emittedFileCount: 87,
  initialAssetCount: 25,
  initialGzipBytes: 236_021,
  initialRawBytes: 764_037,
  javaScriptAssetCount: 85,
  javaScriptGzipBytes: 446_849,
  javaScriptRawBytes: 1_360_890,
  largestJavaScriptGzipBytes: 124_213,
  largestJavaScriptRawBytes: 417_581,
  largestLazyJavaScriptGzipBytes: 22_581,
  largestLazyJavaScriptRawBytes: 96_743,
  totalGzipBytes: 456_255,
  totalRawBytes: 1_405_403
})

export const phase10BundleCeilings = Object.freeze({
  emittedFileCount: 90,
  initialAssetCount: 25,
  initialGzipBytes: 248_000,
  initialRawBytes: 803_000,
  javaScriptAssetCount: 88,
  javaScriptGzipBytes: 470_000,
  javaScriptRawBytes: 1_429_000,
  largestJavaScriptGzipBytes: 131_000,
  largestJavaScriptRawBytes: 439_000,
  largestLazyJavaScriptGzipBytes: 24_000,
  largestLazyJavaScriptRawBytes: 102_000,
  totalGzipBytes: 480_000,
  totalRawBytes: 1_476_000
})

export const phase10ApprovedStaticAssetPaths = Object.freeze([
  'auth/apple-mark.svg',
  'auth/google-mark.svg',
  'brand/harumaru-lockup-160.png',
  'brand/harumaru-lockup-320.png',
  'brand/harumaru-lockup.svg',
  'brand/harumaru-symbol-16.png',
  'brand/harumaru-symbol-32.png',
  'brand/harumaru-symbol.svg',
  'favicon.ico',
  'favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
])

export const phase10AllowedProductionModulePackages = Object.freeze([
  '@hookform/resolvers',
  '@tanstack/query-core',
  '@tanstack/react-query',
  'axios',
  'i18next',
  'react',
  'react-dom',
  'react-hook-form',
  'react-i18next',
  'react-router',
  'scheduler',
  'use-sync-external-store',
  'zod',
  'zustand'
])

export const phase10AdminLazySources = Object.freeze([
  'src/app/admin-question/create/page.tsx',
  'src/app/admin-question/edit/page.tsx',
  'src/app/admin-question/page.tsx'
])

export const phase10DashboardLazySource = 'src/app/dashboard/page.tsx'

export const phase10ForbiddenMockSources = Object.freeze([
  'src/mocks/browser.ts',
  'src/mocks/components/MockAuthenticationNotice.tsx',
  'src/mocks/service.ts'
])

export const phase10ForbiddenMockMarkers = Object.freeze([
  'MockAuthenticationNotice',
  'msw/browser',
  'setupWorker'
])

const MANIFEST_RELATIVE_PATH = '.vite/phase10-manifest.json'
const SSR_MANIFEST_RELATIVE_PATH = '.vite/phase10-ssr-manifest.json'
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const FORBIDDEN_MODULE_PATTERNS = [
  /(?:^|\/)e2e(?:\/|$)/u,
  /(?:^|\/)src\/(?:__tests__|mocks|test)(?:\/|$)/u,
  /\.(?:spec|test)\.[cm]?[jt]sx?$/u,
  /\.stories\.[cm]?[jt]sx?$/u,
  /(?:^|\/)node_modules\/msw\//u,
  /(?:^|\/)node_modules\/@axe-core\/playwright\//u,
  /(?:^|\/)node_modules\/(?:@playwright\/test|playwright(?:-core)?)\//u
]
const ALLOWED_PRODUCTION_MODULE_PACKAGES = new Set(
  phase10AllowedProductionModulePackages
)
const execFileAsync = promisify(execFile)

const exactKeys = (value, expected) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).toSorted()) ===
    JSON.stringify([...expected].toSorted())

// Keep every emitted byte in the inventory; only these approved assets have a separate total.
const summarizePayloadAccounting = (rows) => {
  const staticRows = rows.filter(({ path: file }) =>
    phase10ApprovedStaticAssetPaths.includes(file)
  )
  if (staticRows.length !== phase10ApprovedStaticAssetPaths.length) {
    throw new Error('PHASE10_BUNDLE_APPROVED_STATIC_ASSET_MISSING')
  }
  return {
    totalMeasurementScope: 'payload-excluding-exact-approved-static-assets',
    approvedStaticAssets: {
      paths: phase10ApprovedStaticAssetPaths,
      gzipBytes: sum(staticRows.map(({ gzip }) => gzip)),
      rawBytes: sum(staticRows.map(({ raw }) => raw))
    },
    emittedPayload: {
      gzipBytes: sum(rows.map(({ gzip }) => gzip)),
      rawBytes: sum(rows.map(({ raw }) => raw))
    }
  }
}

const assertSafeRelativePath = (value, label) => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').includes('..')
  ) {
    throw new Error(`PHASE10_BUNDLE_UNSAFE_${label}`)
  }
}

const readPayloadFiles = async (directory, relativeDirectory = '') => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await readPayloadFiles(absolutePath, relativePath)))
    } else if (
      entry.isFile() &&
      ![MANIFEST_RELATIVE_PATH, SSR_MANIFEST_RELATIVE_PATH].includes(
        relativePath
      )
    ) {
      const body = await readFile(absolutePath)
      files.push({
        contentSha256: createHash('sha256').update(body).digest('hex'),
        path: relativePath,
        rawBytes: body.length,
        gzipBytes: gzipSync(body, { level: 9 }).length,
        source: body.toString('utf8')
      })
    }
  }
  return files.toSorted((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  )
}

const readManifest = async (distDirectory) => {
  const raw = JSON.parse(
    await readFile(path.join(distDirectory, MANIFEST_RELATIVE_PATH), 'utf8')
  )
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('PHASE10_BUNDLE_MANIFEST_INVALID')
  }
  return raw
}

const packageNameFromModuleSource = (source) => {
  const marker = '/node_modules/'
  const markerIndex = ('/' + source).lastIndexOf(marker)
  if (markerIndex === -1) return null
  const packagePath = ('/' + source).slice(markerIndex + marker.length)
  const segments = packagePath.split('/')
  return segments[0]?.startsWith('@')
    ? `${segments[0]}/${segments[1] ?? ''}`
    : segments[0]
}

const assertProductionModuleSource = (source) => {
  const packageName = packageNameFromModuleSource(source)
  if (
    FORBIDDEN_MODULE_PATTERNS.some((pattern) => pattern.test(source)) ||
    (packageName !== null &&
      !ALLOWED_PRODUCTION_MODULE_PACKAGES.has(packageName))
  ) {
    throw new Error(`PHASE10_BUNDLE_FORBIDDEN_MODULE:${source}`)
  }
}

const canonicalSource = (source, artifact) => {
  if (
    typeof source !== 'string' ||
    source.length === 0 ||
    source.startsWith('/') ||
    source.includes('\\')
  ) {
    throw new Error('PHASE10_BUNDLE_UNSAFE_MANIFEST_SOURCE')
  }
  if (!source.startsWith('../')) {
    assertSafeRelativePath(source, 'MANIFEST_SOURCE')
    return source
  }
  const resolved = path.posix.normalize(
    path.posix.join('apps', artifact, source)
  )
  if (
    !['packages/browser/', 'packages/contracts/', 'node_modules/'].some(
      (prefix) => resolved.startsWith(prefix)
    )
  ) {
    throw new Error('PHASE10_BUNDLE_UNSAFE_MANIFEST_SOURCE')
  }
  assertSafeRelativePath(resolved, 'MANIFEST_SOURCE')
  return resolved
}
const assertCanonicalModule = (source, artifact) => {
  if (canonicalSource(source, artifact) !== source)
    throw new Error('PHASE10_BUNDLE_UNSAFE_MODULE_SOURCE')
  assertProductionModuleSource(source)
  assertBrowserBuildGraph(artifact, [
    source.startsWith('src/') ? `apps/${artifact}/${source}` : source
  ])
}

const readModuleGraph = async (distDirectory, artifact, base) => {
  const raw = JSON.parse(
    await readFile(path.join(distDirectory, SSR_MANIFEST_RELATIVE_PATH), 'utf8')
  )
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('PHASE10_BUNDLE_SSR_MANIFEST_INVALID')
  }
  const rows = Object.entries(raw)
    .map(([source, assets]) => {
      if (
        source.length === 0 ||
        source.includes('\\') ||
        !Array.isArray(assets) ||
        !assets.every(
          (asset) =>
            typeof asset === 'string' &&
            asset.startsWith(base + 'assets/') &&
            !asset.includes('\\')
        )
      ) {
        throw new Error('PHASE10_BUNDLE_SSR_MANIFEST_ENTRY_INVALID')
      }
      const normalizedAssets = assets
        .map((asset) => '/' + asset.slice(base.length))
        .toSorted()
      if (new Set(normalizedAssets).size !== normalizedAssets.length) {
        throw new Error('PHASE10_BUNDLE_SSR_MANIFEST_ENTRY_INVALID')
      }
      const mapped = canonicalSource(source, artifact)
      assertCanonicalModule(mapped, artifact)
      return { assets: normalizedAssets, source: mapped }
    })
    .toSorted((left, right) =>
      left.source < right.source ? -1 : left.source > right.source ? 1 : 0
    )
  if (new Set(rows.map(({ source }) => source)).size !== rows.length) {
    throw new Error('PHASE10_BUNDLE_DUPLICATE_MODULE_SOURCE')
  }
  return rows
}

const normalizeManifestEntry = (source, value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PHASE10_BUNDLE_MANIFEST_ENTRY_INVALID')
  }
  assertSafeRelativePath(source, 'MANIFEST_SOURCE')
  assertSafeRelativePath(value.file, 'MANIFEST_FILE')
  const normalizeReferences = (references, label) => {
    if (references === undefined) return []
    if (
      !Array.isArray(references) ||
      !references.every(
        (reference) => typeof reference === 'string' && reference.length > 0
      )
    ) {
      throw new Error(`PHASE10_BUNDLE_MANIFEST_${label}_INVALID`)
    }
    return [...references].toSorted()
  }
  const imports = normalizeReferences(value.imports, 'IMPORTS')
  const dynamicImports = normalizeReferences(
    value.dynamicImports,
    'DYNAMIC_IMPORTS'
  )
  const css = normalizeReferences(value.css, 'CSS')
  css.forEach((file) => assertSafeRelativePath(file, 'MANIFEST_CSS'))
  return {
    source,
    file: value.file,
    isEntry: value.isEntry === true,
    isDynamicEntry: value.isDynamicEntry === true,
    imports,
    dynamicImports,
    css
  }
}

const collectStaticClosure = (entriesBySource, entrySources) => {
  const closure = new Set()
  const pending = [...entrySources]
  while (pending.length > 0) {
    const source = pending.pop()
    if (!source || closure.has(source)) continue
    const entry = entriesBySource.get(source)
    if (!entry) throw new Error('PHASE10_BUNDLE_MISSING_MANIFEST_NODE')
    closure.add(source)
    pending.push(...entry.imports)
  }
  return closure
}

const collectFullClosure = (entriesBySource, entrySources) => {
  const closure = new Set()
  const pending = [...entrySources]
  while (pending.length > 0) {
    const source = pending.pop()
    if (!source || closure.has(source)) continue
    const entry = entriesBySource.get(source)
    if (!entry) throw new Error('PHASE10_BUNDLE_MISSING_MANIFEST_NODE')
    closure.add(source)
    pending.push(...entry.imports, ...entry.dynamicImports)
  }
  return closure
}

const readHtmlInitialAssets = (html, base) =>
  [...html.matchAll(/(?:src|href)=["']\/([^"']+\.(?:css|js))["']/giu)]
    .map((match) => '/' + match[1])
    .map((value) =>
      value.startsWith(base + 'assets/') ? value.slice(base.length) : value
    )
    .filter((value) => value !== undefined)
    .toSorted()

const sum = (values) => values.reduce((total, value) => total + value, 0)

const largestBy = (rows, field) =>
  rows.toSorted(
    (left, right) =>
      right[field] - left[field] ||
      (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  )[0]

export const evaluatePhase10BundleBudgets = (actual) =>
  Object.fromEntries(
    Object.keys(phase10BundleBaseline)
      .toSorted()
      .map((metric) => {
        const baseline = phase10BundleBaseline[metric]
        const ceiling = phase10BundleCeilings[metric]
        const measured = actual[metric]
        if (
          !Number.isSafeInteger(baseline) ||
          !Number.isSafeInteger(ceiling) ||
          !Number.isSafeInteger(measured) ||
          baseline <= 0 ||
          ceiling < baseline ||
          measured < 0
        ) {
          throw new Error('PHASE10_BUNDLE_BUDGET_INVALID')
        }
        return [
          metric,
          {
            actual: measured,
            baseline,
            ceiling,
            delta: measured - baseline,
            passed: measured <= ceiling,
            ratio: Number((measured / baseline).toFixed(6))
          }
        ]
      })
  )

export const createPhase10BundleBudgetError = (
  budgets,
  largestLazyJavaScriptByGzip,
  graph
) => {
  const orderedGraph = graph.toSorted((left, right) =>
    left.source < right.source ? -1 : left.source > right.source ? 1 : 0
  )
  const manifestEntries = orderedGraph
    .filter(({ file }) => file === largestLazyJavaScriptByGzip.path)
    .map(
      ({
        source,
        file,
        isEntry,
        isDynamicEntry,
        imports,
        dynamicImports,
        css
      }) => ({
        source,
        file,
        isEntry,
        isDynamicEntry,
        imports: imports.toSorted(),
        dynamicImports: dynamicImports.toSorted(),
        css: css.toSorted()
      })
    )
  const sources = new Set(manifestEntries.map(({ source }) => source))
  const incomingEdges = orderedGraph.flatMap((entry) =>
    ['imports', 'dynamicImports'].flatMap((kind) =>
      entry[kind]
        .filter((target) => sources.has(target))
        .toSorted()
        .map((target) => ({ source: entry.source, kind, target }))
    )
  )
  return new Error(
    `PHASE10_BUNDLE_BUDGET_EXCEEDED:${JSON.stringify({
      budgets: Object.fromEntries(
        Object.entries(budgets).toSorted(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0
        )
      ),
      largestLazyJavaScriptByGzip: {
        path: largestLazyJavaScriptByGzip.path,
        rawBytes: largestLazyJavaScriptByGzip.rawBytes,
        gzipBytes: largestLazyJavaScriptByGzip.gzipBytes,
        contentSha256: largestLazyJavaScriptByGzip.contentSha256,
        manifestEntries,
        incomingEdges
      }
    })}`
  )
}

const assertExpectedLazyBoundary = (entriesBySource, source) => {
  const entry = entriesBySource.get(source)
  if (!entry || !entry.isDynamicEntry || entry.isInitial) {
    throw new Error(`PHASE10_BUNDLE_LAZY_BOUNDARY_MISSING:${source}`)
  }
  return {
    file: entry.file,
    isDynamicEntry: entry.isDynamicEntry,
    isInitial: entry.isInitial,
    source
  }
}

export const describePhase10PayloadIdentity = (source) => {
  const omitted = { kind: 'body-omitted', body: null, relativeTargets: [] }
  if (source.length > 1024) return omitted
  const parseNames = (list) => {
    const matches = list
      .split(',')
      .map((item) =>
        item
          .trim()
          .match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u)
      )
    if (matches.some((match) => match === null)) return null
    return matches.map((match) => ({
      name: match[1],
      alias: match[2] ?? match[1]
    }))
  }
  const direct = source.match(
    /^\s*export\s*\{(?<names>[^{}]+)\}\s*from\s*(?<quote>["'])(?<target>\.\/[\w.-]+\.js)\k<quote>\s*;?\s*$/u
  )
  if (direct) {
    const names = parseNames(direct.groups.names)
    if (
      !names ||
      new Set(names.map(({ alias }) => alias)).size !== names.length
    )
      return omitted
    return {
      kind: 'local-reexport-only',
      body: null,
      relativeTargets: [direct.groups.target],
      bindings: names.map(({ name, alias }) => ({
        imported: name,
        local: null,
        exported: alias
      })),
      executableStatementCount: 0
    }
  }
  const forwarded = source.match(
    /^\s*import\s*\{(?<imports>[^{}]+)\}\s*from\s*(?<quote>["'])(?<target>\.\/[\w.-]+\.js)\k<quote>\s*;\s*export\s*\{(?<exports>[^{}]+)\}\s*;?\s*$/u
  )
  if (!forwarded) return omitted
  const imports = parseNames(forwarded.groups.imports)
  const exports = parseNames(forwarded.groups.exports)
  if (
    !imports ||
    !exports ||
    new Set(imports.map(({ alias }) => alias)).size !== imports.length ||
    new Set(exports.map(({ alias }) => alias)).size !== exports.length ||
    exports.some(({ name }) => !imports.some(({ alias }) => alias === name)) ||
    imports.some(({ alias }) => !exports.some(({ name }) => name === alias))
  )
    return omitted
  return {
    kind: 'local-import-named-export-only',
    body: null,
    relativeTargets: [forwarded.groups.target],
    bindings: exports.map(({ name, alias }) => ({
      imported: imports.find((entry) => entry.alias === name).name,
      local: name,
      exported: alias
    })),
    executableStatementCount: 0
  }
}

export const createPhase10SsrAssetClosureError = (
  actualPaths,
  expectedPaths,
  missingAssets = []
) => {
  const actual = new Set(actualPaths)
  const expected = new Set(expectedPaths)
  return new Error(
    `PHASE10_BUNDLE_SSR_ASSET_CLOSURE_MISMATCH:${JSON.stringify({
      missing: [...expected].filter((file) => !actual.has(file)).toSorted(),
      extra: [...actual].filter((file) => !expected.has(file)).toSorted(),
      ...(missingAssets.length > 0 ? { missingAssets } : {})
    })}`
  )
}

// Only already-recognized, safe import/export tokens enter the evidence proof.
export const createPhase10ForwardingProof = (payload, entry) => {
  const identity = describePhase10PayloadIdentity(payload.source)
  if (identity.kind === 'body-omitted') return null
  const syntaxTokens =
    payload.source.match(
      /\s+|["']\.\/[\w.-]+\.js["']|[A-Za-z_$][\w$]*|[{},;]/gu
    ) ?? []
  if (syntaxTokens.join('') !== payload.source) return null
  return {
    path: payload.path,
    source: entry.source,
    target: path.posix.join(
      path.posix.dirname(payload.path),
      identity.relativeTargets[0]
    ),
    contentSha256: payload.contentSha256,
    rawBytes: payload.rawBytes,
    gzipBytes: payload.gzipBytes,
    syntaxTokens,
    identity
  }
}

export const assertPhase10ForwardingCoverage = ({
  graph,
  moduleRows,
  inventoryRows,
  forwardingFacades
}) => {
  if (!Array.isArray(forwardingFacades))
    throw new Error('PHASE10_BUNDLE_FORWARDING_PROOF_INVALID')
  const expected = new Set(
    graph.filter(({ isEntry }) => !isEntry).map(({ file }) => file)
  )
  const ssr = new Set(
    moduleRows.flatMap(({ assets }) => assets.map((asset) => asset.slice(1)))
  )
  const rowsByPath = new Map(inventoryRows.map((row) => [row.path, row]))
  const graphBySource = new Map(graph.map((entry) => [entry.source, entry]))
  const filesByPath = new Map(graph.map((entry) => [entry.file, entry]))
  const proved = new Set()
  for (const proof of forwardingFacades) {
    if (
      !exactKeys(proof, [
        'path',
        'source',
        'target',
        'contentSha256',
        'rawBytes',
        'gzipBytes',
        'syntaxTokens',
        'identity'
      ]) ||
      !Array.isArray(proof.syntaxTokens) ||
      proof.syntaxTokens.length > 1024 ||
      proof.syntaxTokens.some(
        (token) =>
          typeof token !== 'string' ||
          token.length > 1024 ||
          !/^(?:\s+|["']\.\/[\w.-]+\.js["']|[A-Za-z_$][\w$]*|[{},;])$/u.test(
            token
          )
      )
    ) {
      throw new Error('PHASE10_BUNDLE_FORWARDING_PROOF_INVALID')
    }
    const source = proof.syntaxTokens.join('')
    const identity = describePhase10PayloadIdentity(source)
    const bytes = Buffer.from(source, 'utf8')
    const row = rowsByPath.get(proof.path)
    const entry = graphBySource.get(proof.source)
    const target = filesByPath.get(proof.target)
    const sourceModules = moduleRows.filter(
      (module) => module.source === proof.source
    )
    if (
      identity.kind === 'body-omitted' ||
      !isDeepStrictEqual(identity, proof.identity) ||
      !row ||
      proof.contentSha256 !== row.contentSha256 ||
      proof.rawBytes !== row.raw ||
      proof.gzipBytes !== row.gzip ||
      createHash('sha256').update(bytes).digest('hex') !== row.contentSha256 ||
      bytes.length !== row.raw ||
      gzipSync(bytes, { level: 9 }).length !== row.gzip ||
      proof.target !==
        path.posix.join(
          path.posix.dirname(proof.path),
          identity.relativeTargets[0]
        ) ||
      !entry ||
      entry.file !== proof.path ||
      entry.isEntry ||
      !entry.isDynamicEntry ||
      entry.css.length !== 0 ||
      entry.dynamicImports.length !== 0 ||
      !target ||
      entry.imports.length !== 1 ||
      entry.imports[0] !== target.source ||
      !graph.some((parent) => parent.dynamicImports.includes(proof.source)) ||
      sourceModules.length !== 1 ||
      !sourceModules[0].assets.includes('/' + proof.target) ||
      !ssr.has(proof.target) ||
      !expected.has(proof.path) ||
      ssr.has(proof.path) ||
      proved.has(proof.path)
    ) {
      throw new Error('PHASE10_BUNDLE_FORWARDING_PROOF_INVALID')
    }
    assertProductionModuleSource(proof.source)
    proved.add(proof.path)
  }
  if (
    JSON.stringify(forwardingFacades.map(({ path: file }) => file)) !==
    JSON.stringify([...proved].toSorted())
  ) {
    throw new Error('PHASE10_BUNDLE_FORWARDING_PROOF_INVALID')
  }
  const covered = new Set([...ssr, ...proved])
  if (
    JSON.stringify([...covered].toSorted()) !==
    JSON.stringify([...expected].toSorted())
  ) {
    throw createPhase10SsrAssetClosureError(covered, expected)
  }
}

const collectArtifactEvidence = async ({
  distDirectory,
  metadata,
  artifact,
  base
}) => {
  const payloadFiles = await readPayloadFiles(distDirectory)
  const moduleGraph = await readModuleGraph(distDirectory, artifact, base)
  if (payloadFiles.length === 0) {
    throw new Error('PHASE10_BUNDLE_EMPTY')
  }
  const payloadByPath = new Map(payloadFiles.map((row) => [row.path, row]))
  if (payloadByPath.size !== payloadFiles.length) {
    throw new Error('PHASE10_BUNDLE_DUPLICATE_PAYLOAD_PATH')
  }

  validateProductionBundleRuntime(payloadFiles)
  for (const marker of phase10ForbiddenMockMarkers) {
    if (
      payloadFiles.some(
        (asset) => asset.path.includes(marker) || asset.source.includes(marker)
      )
    ) {
      throw new Error(`PHASE10_BUNDLE_FORBIDDEN_MOCK_MARKER:${marker}`)
    }
  }

  const manifest = await readManifest(distDirectory)
  const graph = Object.entries(manifest)
    .map(([source, value]) =>
      normalizeManifestEntry(canonicalSource(source, artifact), {
        ...value,
        imports: value.imports?.map((reference) =>
          canonicalSource(reference, artifact)
        ),
        dynamicImports: value.dynamicImports?.map((reference) =>
          canonicalSource(reference, artifact)
        )
      })
    )
    .toSorted((left, right) =>
      left.source < right.source ? -1 : left.source > right.source ? 1 : 0
    )
  const entriesBySource = new Map(graph.map((entry) => [entry.source, entry]))
  if (entriesBySource.size !== graph.length) {
    throw new Error('PHASE10_BUNDLE_DUPLICATE_MANIFEST_SOURCE')
  }
  const outputFiles = new Set()
  for (const entry of graph) {
    if (outputFiles.has(entry.file)) {
      throw new Error('PHASE10_BUNDLE_DUPLICATE_OUTPUT_MAPPING')
    }
    outputFiles.add(entry.file)
    if (!payloadByPath.has(entry.file)) {
      throw new Error('PHASE10_BUNDLE_MISSING_OUTPUT_FILE')
    }
    for (const reference of [...entry.imports, ...entry.dynamicImports]) {
      if (!entriesBySource.has(reference)) {
        throw new Error('PHASE10_BUNDLE_MISSING_MANIFEST_NODE')
      }
    }
    for (const cssFile of entry.css) {
      if (!payloadByPath.has(cssFile)) {
        throw new Error('PHASE10_BUNDLE_MISSING_CSS_FILE')
      }
    }
  }
  const javaScriptRows = payloadFiles.filter(({ path: file }) =>
    file.endsWith('.js')
  )
  const javaScriptPaths = new Set(javaScriptRows.map(({ path: file }) => file))
  if (
    javaScriptPaths.size !== outputFiles.size ||
    [...javaScriptPaths].some((file) => !outputFiles.has(file))
  ) {
    throw new Error('PHASE10_BUNDLE_ORPHAN_JAVASCRIPT')
  }

  const entrySources = graph
    .filter(({ isEntry }) => isEntry)
    .map(({ source }) => source)
  if (entrySources.length !== 1 || entrySources[0] !== 'index.html') {
    throw new Error('PHASE10_BUNDLE_ENTRY_INVALID')
  }
  const fullClosure = collectFullClosure(entriesBySource, entrySources)
  if (fullClosure.size !== graph.length) {
    throw new Error('PHASE10_BUNDLE_ORPHAN_MANIFEST_NODE')
  }
  const staticClosure = collectStaticClosure(entriesBySource, entrySources)
  const initialAssets = new Set()
  for (const source of staticClosure) {
    const entry = entriesBySource.get(source)
    if (!entry) throw new Error('PHASE10_BUNDLE_MISSING_MANIFEST_NODE')
    initialAssets.add(entry.file)
    entry.css.forEach((file) => initialAssets.add(file))
  }
  const htmlRow = payloadByPath.get('index.html')
  if (!htmlRow) throw new Error('PHASE10_BUNDLE_INDEX_HTML_MISSING')
  const htmlAssets = readHtmlInitialAssets(htmlRow.source, base)
  if (
    JSON.stringify(htmlAssets) !== JSON.stringify([...initialAssets].toSorted())
  ) {
    throw new Error('PHASE10_BUNDLE_HTML_GRAPH_MISMATCH')
  }

  const evidenceGraph = graph.map((entry) => ({
    ...entry,
    isInitial: staticClosure.has(entry.source)
  }))
  const evidenceBySource = new Map(
    evidenceGraph.map((entry) => [entry.source, entry])
  )
  for (const { assets } of moduleGraph) {
    for (const asset of assets) {
      const payloadPath = asset.slice(1)
      if (!payloadByPath.has(payloadPath) || !outputFiles.has(payloadPath)) {
        throw new Error('PHASE10_BUNDLE_SSR_ASSET_MISMATCH')
      }
    }
  }
  const ssrAssetPaths = new Set(
    moduleGraph.flatMap(({ assets }) => assets.map((asset) => asset.slice(1)))
  )
  const entryOutputFiles = new Set(
    graph.filter(({ isEntry }) => isEntry).map(({ file }) => file)
  )
  const expectedSsrAssetPaths = [...outputFiles]
    .filter((file) => !entryOutputFiles.has(file))
    .toSorted()
  const inventory = payloadFiles.map(
    ({ contentSha256, path: file, rawBytes, gzipBytes }) => ({
      contentSha256,
      gzip: gzipBytes,
      path: file,
      raw: rawBytes
    })
  )
  const forwardingFacades = expectedSsrAssetPaths
    .filter((file) => !ssrAssetPaths.has(file))
    .map((file) =>
      createPhase10ForwardingProof(
        payloadByPath.get(file),
        graph.find((entry) => entry.file === file)
      )
    )
    .filter((proof) => proof !== null)
  assertPhase10ForwardingCoverage({
    graph,
    moduleRows: moduleGraph,
    inventoryRows: inventory,
    forwardingFacades
  })
  for (const source of phase10ForbiddenMockSources) {
    if (evidenceBySource.has(source)) {
      throw new Error(`PHASE10_BUNDLE_FORBIDDEN_MOCK_SOURCE:${source}`)
    }
  }

  const initialRows = [...initialAssets].map((file) => {
    const row = payloadByPath.get(file)
    if (!row) throw new Error('PHASE10_BUNDLE_INITIAL_ASSET_MISSING')
    return row
  })
  const lazyJavaScriptRows = javaScriptRows.filter(
    ({ path: file }) => !initialAssets.has(file)
  )
  const largestJavaScriptByRaw = largestBy(javaScriptRows, 'rawBytes')
  const largestJavaScriptByGzip = largestBy(javaScriptRows, 'gzipBytes')
  const largestLazyJavaScriptByRaw = largestBy(lazyJavaScriptRows, 'rawBytes')
  const largestLazyJavaScriptByGzip = largestBy(lazyJavaScriptRows, 'gzipBytes')
  if (
    !largestJavaScriptByRaw ||
    !largestJavaScriptByGzip ||
    !largestLazyJavaScriptByRaw ||
    !largestLazyJavaScriptByGzip
  ) {
    throw new Error('PHASE10_BUNDLE_LARGEST_ASSET_MISSING')
  }
  const payloadAccounting = summarizePayloadAccounting(inventory)
  const measurements = {
    emittedFileCount: payloadFiles.length,
    initialAssetCount: initialRows.length,
    initialGzipBytes: sum(initialRows.map(({ gzipBytes }) => gzipBytes)),
    initialRawBytes: sum(initialRows.map(({ rawBytes }) => rawBytes)),
    javaScriptAssetCount: javaScriptRows.length,
    javaScriptGzipBytes: sum(javaScriptRows.map(({ gzipBytes }) => gzipBytes)),
    javaScriptRawBytes: sum(javaScriptRows.map(({ rawBytes }) => rawBytes)),
    largestJavaScriptGzipBytes: largestJavaScriptByGzip.gzipBytes,
    largestJavaScriptRawBytes: largestJavaScriptByRaw.rawBytes,
    largestLazyJavaScriptGzipBytes: largestLazyJavaScriptByGzip.gzipBytes,
    largestLazyJavaScriptRawBytes: largestLazyJavaScriptByRaw.rawBytes,
    totalGzipBytes:
      payloadAccounting.emittedPayload.gzipBytes -
      payloadAccounting.approvedStaticAssets.gzipBytes,
    totalRawBytes:
      payloadAccounting.emittedPayload.rawBytes -
      payloadAccounting.approvedStaticAssets.rawBytes
  }
  const budgets = evaluatePhase10BundleBudgets(measurements)

  const inventorySha256 = createHash('sha256')
    .update(
      JSON.stringify(
        inventory.map(({ gzip, path: file, raw }) => ({
          path: file,
          raw,
          gzip
        }))
      )
    )
    .digest('hex')
  const payloadSha256 = createHash('sha256')
    .update(JSON.stringify(inventory))
    .digest('hex')
  const admin =
    artifact === 'admin'
      ? phase10AdminLazySources.map((source) =>
          assertExpectedLazyBoundary(evidenceBySource, source)
        )
      : []
  const dashboard =
    artifact === 'web'
      ? assertExpectedLazyBoundary(evidenceBySource, phase10DashboardLazySource)
      : null
  const evidence = {
    boundaries: { admin, dashboard },
    budgets,
    graph: evidenceGraph,
    forwardingFacades,
    inventory: {
      payloadSha256,
      rows: inventory,
      sha256: inventorySha256
    },
    kind: 'nihongo.phase10.bundle-performance',
    largestAssets: {
      javaScriptByGzip: {
        gzipBytes: largestJavaScriptByGzip.gzipBytes,
        path: largestJavaScriptByGzip.path,
        rawBytes: largestJavaScriptByGzip.rawBytes
      },
      javaScriptByRaw: {
        gzipBytes: largestJavaScriptByRaw.gzipBytes,
        path: largestJavaScriptByRaw.path,
        rawBytes: largestJavaScriptByRaw.rawBytes
      },
      lazyJavaScriptByGzip: {
        gzipBytes: largestLazyJavaScriptByGzip.gzipBytes,
        path: largestLazyJavaScriptByGzip.path,
        rawBytes: largestLazyJavaScriptByGzip.rawBytes
      },
      lazyJavaScriptByRaw: {
        gzipBytes: largestLazyJavaScriptByRaw.gzipBytes,
        path: largestLazyJavaScriptByRaw.path,
        rawBytes: largestLazyJavaScriptByRaw.rawBytes
      }
    },
    measurements,
    metadata,
    modules: {
      count: moduleGraph.length,
      sha256: createHash('sha256')
        .update(JSON.stringify(moduleGraph))
        .digest('hex'),
      rows: moduleGraph
    },
    payloadAccounting,
    schemaVersion: 3,
    status: Object.values(evaluatePhase10BundleBudgets(measurements)).every(
      (budget) => budget.passed
    )
      ? 'passed'
      : 'failed'
  }
  assertArtifactEvidence(evidence, artifact)
  return evidence
}

const assertArtifactEvidence = (value, artifact) => {
  if (
    !exactKeys(value, [
      'boundaries',
      'budgets',
      'graph',
      'forwardingFacades',
      'inventory',
      'kind',
      'largestAssets',
      'measurements',
      'metadata',
      'modules',
      'payloadAccounting',
      'schemaVersion',
      'status'
    ]) ||
    value.schemaVersion !== 3 ||
    value.kind !== 'nihongo.phase10.bundle-performance' ||
    !['passed', 'failed'].includes(value.status) ||
    !exactKeys(value.metadata, [
      'command',
      'commit',
      'environment',
      'generatedAt',
      'mode',
      'sourceTreeDirty',
      'sourceTreeSha256',
      'versions'
    ]) ||
    value.metadata.command !==
      'pnpm exec vite build --manifest .vite/phase10-manifest.json --ssrManifest .vite/phase10-ssr-manifest.json --outDir <temporary-out-dir> --emptyOutDir' ||
    !GIT_COMMIT_PATTERN.test(value.metadata.commit) ||
    typeof value.metadata.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.metadata.generatedAt)) ||
    new Date(value.metadata.generatedAt).toISOString() !==
      value.metadata.generatedAt ||
    value.metadata.mode !== 'production' ||
    typeof value.metadata.sourceTreeDirty !== 'boolean' ||
    typeof value.metadata.sourceTreeSha256 !== 'string' ||
    !SHA256_PATTERN.test(value.metadata.sourceTreeSha256) ||
    !exactKeys(value.metadata.environment, [
      'apiBaseUrl',
      'apiMode',
      'nodeEnvironment'
    ]) ||
    value.metadata.environment.apiBaseUrl !== '/api' ||
    value.metadata.environment.apiMode !== 'real' ||
    value.metadata.environment.nodeEnvironment !== 'production' ||
    !exactKeys(value.metadata.versions, ['node', 'pnpm', 'vite']) ||
    value.metadata.versions.node !== 'v22.23.0' ||
    value.metadata.versions.pnpm !== '10.2.1' ||
    value.metadata.versions.vite !== '8.2.4' ||
    !Array.isArray(value.graph) ||
    value.graph.length === 0 ||
    !exactKeys(value.inventory, ['payloadSha256', 'rows', 'sha256']) ||
    !SHA256_PATTERN.test(value.inventory.sha256) ||
    !SHA256_PATTERN.test(value.inventory.payloadSha256) ||
    !Array.isArray(value.inventory.rows) ||
    value.inventory.rows.length === 0 ||
    !exactKeys(value.modules, ['count', 'rows', 'sha256']) ||
    !Number.isSafeInteger(value.modules.count) ||
    value.modules.count < 1 ||
    !SHA256_PATTERN.test(value.modules.sha256) ||
    !Array.isArray(value.modules.rows) ||
    value.modules.rows.length !== value.modules.count ||
    !exactKeys(value.boundaries, ['admin', 'dashboard']) ||
    !Array.isArray(value.boundaries.admin) ||
    value.boundaries.admin.length !==
      (artifact === 'admin' ? phase10AdminLazySources.length : 0) ||
    (artifact === 'web'
      ? !value.boundaries.dashboard ||
        typeof value.boundaries.dashboard !== 'object'
      : value.boundaries.dashboard !== null)
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_SCHEMA_INVALID')
  }

  const moduleRows = value.modules.rows
  const moduleSources = moduleRows.map(({ source }) => source)
  if (
    moduleRows.some(
      (row) =>
        !exactKeys(row, ['assets', 'source']) ||
        typeof row.source !== 'string' ||
        row.source.length === 0 ||
        row.source.includes('\\') ||
        !Array.isArray(row.assets) ||
        row.assets.some(
          (asset) =>
            typeof asset !== 'string' ||
            !asset.startsWith('/assets/') ||
            asset.includes('\\')
        ) ||
        new Set(row.assets).size !== row.assets.length ||
        JSON.stringify(row.assets) !==
          JSON.stringify([...row.assets].toSorted())
    ) ||
    new Set(moduleSources).size !== moduleSources.length ||
    JSON.stringify(moduleSources) !==
      JSON.stringify([...moduleSources].toSorted()) ||
    createHash('sha256').update(JSON.stringify(moduleRows)).digest('hex') !==
      value.modules.sha256
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_MODULES_INVALID')
  }
  moduleSources.forEach((source) => assertCanonicalModule(source, artifact))

  const rows = value.inventory.rows
  for (const row of rows) {
    if (
      !exactKeys(row, ['contentSha256', 'gzip', 'path', 'raw']) ||
      typeof row.contentSha256 !== 'string' ||
      !SHA256_PATTERN.test(row.contentSha256) ||
      !Number.isSafeInteger(row.gzip) ||
      row.gzip < 0 ||
      !Number.isSafeInteger(row.raw) ||
      row.raw < 0
    ) {
      throw new Error('PHASE10_BUNDLE_EVIDENCE_SCHEMA_INVALID')
    }
    assertSafeRelativePath(row.path, 'EVIDENCE_PATH')
  }
  if (
    new Set(rows.map(({ path: file }) => file)).size !== rows.length ||
    JSON.stringify(rows.map(({ path: file }) => file)) !==
      JSON.stringify(rows.map(({ path: file }) => file).toSorted()) ||
    createHash('sha256')
      .update(
        JSON.stringify(
          rows.map(({ gzip, path: file, raw }) => ({
            path: file,
            raw,
            gzip
          }))
        )
      )
      .digest('hex') !== value.inventory.sha256 ||
    createHash('sha256').update(JSON.stringify(rows)).digest('hex') !==
      value.inventory.payloadSha256
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_INVENTORY_INVALID')
  }

  const rowsByPath = new Map(rows.map((row) => [row.path, row]))
  const graph = value.graph
  const graphSources = graph.map(({ source }) => source)
  if (
    JSON.stringify(graphSources) !==
      JSON.stringify([...graphSources].toSorted()) ||
    new Set(graphSources).size !== graphSources.length
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_GRAPH_INVALID')
  }
  const graphBySource = new Map()
  const outputFiles = new Set()
  for (const entry of graph) {
    if (
      !exactKeys(entry, [
        'css',
        'dynamicImports',
        'file',
        'imports',
        'isDynamicEntry',
        'isEntry',
        'isInitial',
        'source'
      ]) ||
      typeof entry.isDynamicEntry !== 'boolean' ||
      typeof entry.isEntry !== 'boolean' ||
      typeof entry.isInitial !== 'boolean'
    ) {
      throw new Error('PHASE10_BUNDLE_EVIDENCE_GRAPH_INVALID')
    }
    assertSafeRelativePath(entry.source, 'EVIDENCE_GRAPH_SOURCE')
    assertSafeRelativePath(entry.file, 'EVIDENCE_GRAPH_FILE')
    if (
      outputFiles.has(entry.file) ||
      !rowsByPath.has(entry.file) ||
      !entry.file.endsWith('.js')
    ) {
      throw new Error('PHASE10_BUNDLE_EVIDENCE_GRAPH_INVALID')
    }
    outputFiles.add(entry.file)
    graphBySource.set(entry.source, entry)
    for (const [label, references] of [
      ['CSS', entry.css],
      ['DYNAMIC_IMPORTS', entry.dynamicImports],
      ['IMPORTS', entry.imports]
    ]) {
      if (
        !Array.isArray(references) ||
        references.some(
          (reference) => typeof reference !== 'string' || reference.length === 0
        ) ||
        new Set(references).size !== references.length ||
        JSON.stringify(references) !==
          JSON.stringify([...references].toSorted())
      ) {
        throw new Error(`PHASE10_BUNDLE_EVIDENCE_GRAPH_${label}_INVALID`)
      }
    }
    entry.css.forEach((file) => {
      assertSafeRelativePath(file, 'EVIDENCE_GRAPH_CSS')
      if (!rowsByPath.has(file)) {
        throw new Error('PHASE10_BUNDLE_EVIDENCE_GRAPH_CSS_INVALID')
      }
    })
  }
  for (const { assets } of moduleRows) {
    for (const asset of assets) {
      const payloadPath = asset.slice(1)
      if (!rowsByPath.has(payloadPath) || !outputFiles.has(payloadPath)) {
        throw new Error('PHASE10_BUNDLE_EVIDENCE_SSR_GRAPH_INVALID')
      }
    }
  }
  assertPhase10ForwardingCoverage({
    graph,
    moduleRows,
    inventoryRows: rows,
    forwardingFacades: value.forwardingFacades
  })
  for (const entry of graph) {
    for (const reference of [...entry.imports, ...entry.dynamicImports]) {
      if (!graphBySource.has(reference)) {
        throw new Error('PHASE10_BUNDLE_EVIDENCE_GRAPH_REFERENCE_INVALID')
      }
    }
  }
  const entrySources = graph
    .filter(({ isEntry }) => isEntry)
    .map(({ source }) => source)
  if (JSON.stringify(entrySources) !== JSON.stringify(['index.html'])) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_ENTRY_INVALID')
  }
  const fullClosure = collectFullClosure(graphBySource, entrySources)
  if (fullClosure.size !== graph.length) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_ORPHAN_MANIFEST_NODE')
  }
  const staticClosure = collectStaticClosure(graphBySource, entrySources)
  if (
    graph.some(
      ({ isInitial, source }) => isInitial !== staticClosure.has(source)
    )
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_INITIAL_GRAPH_INVALID')
  }
  const javaScriptRows = rows.filter(({ path: file }) => file.endsWith('.js'))
  if (
    javaScriptRows.length !== outputFiles.size ||
    javaScriptRows.some(({ path: file }) => !outputFiles.has(file))
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_JAVASCRIPT_GRAPH_INVALID')
  }
  const initialAssets = new Set()
  for (const source of staticClosure) {
    const entry = graphBySource.get(source)
    if (!entry) {
      throw new Error('PHASE10_BUNDLE_EVIDENCE_INITIAL_GRAPH_INVALID')
    }
    initialAssets.add(entry.file)
    entry.css.forEach((file) => initialAssets.add(file))
  }
  const initialRows = [...initialAssets].map((file) => rowsByPath.get(file))
  if (initialRows.some((row) => row === undefined)) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_INITIAL_ASSET_INVALID')
  }
  const lazyJavaScriptRows = javaScriptRows.filter(
    ({ path: file }) => !initialAssets.has(file)
  )
  const largestJavaScriptByRaw = largestBy(javaScriptRows, 'raw')
  const largestJavaScriptByGzip = largestBy(javaScriptRows, 'gzip')
  const largestLazyJavaScriptByRaw = largestBy(lazyJavaScriptRows, 'raw')
  const largestLazyJavaScriptByGzip = largestBy(lazyJavaScriptRows, 'gzip')
  if (
    !largestJavaScriptByRaw ||
    !largestJavaScriptByGzip ||
    !largestLazyJavaScriptByRaw ||
    !largestLazyJavaScriptByGzip
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_LARGEST_ASSET_INVALID')
  }
  const expectedAccounting = summarizePayloadAccounting(rows)
  const accounting = value.payloadAccounting
  if (
    !exactKeys(accounting, [
      'totalMeasurementScope',
      'approvedStaticAssets',
      'emittedPayload'
    ]) ||
    accounting.totalMeasurementScope !==
      expectedAccounting.totalMeasurementScope ||
    !exactKeys(accounting.approvedStaticAssets, [
      'paths',
      'gzipBytes',
      'rawBytes'
    ]) ||
    JSON.stringify(accounting.approvedStaticAssets.paths) !==
      JSON.stringify(phase10ApprovedStaticAssetPaths) ||
    !exactKeys(accounting.emittedPayload, ['gzipBytes', 'rawBytes']) ||
    ['gzipBytes', 'rawBytes'].some(
      (key) =>
        accounting.approvedStaticAssets[key] !==
          expectedAccounting.approvedStaticAssets[key] ||
        accounting.emittedPayload[key] !==
          expectedAccounting.emittedPayload[key]
    )
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_PAYLOAD_ACCOUNTING_INVALID')
  }
  const expectedMeasurements = {
    emittedFileCount: rows.length,
    initialAssetCount: initialRows.length,
    initialGzipBytes: sum(initialRows.map(({ gzip }) => gzip)),
    initialRawBytes: sum(initialRows.map(({ raw }) => raw)),
    javaScriptAssetCount: javaScriptRows.length,
    javaScriptGzipBytes: sum(javaScriptRows.map(({ gzip }) => gzip)),
    javaScriptRawBytes: sum(javaScriptRows.map(({ raw }) => raw)),
    largestJavaScriptGzipBytes: largestJavaScriptByGzip.gzip,
    largestJavaScriptRawBytes: largestJavaScriptByRaw.raw,
    largestLazyJavaScriptGzipBytes: largestLazyJavaScriptByGzip.gzip,
    largestLazyJavaScriptRawBytes: largestLazyJavaScriptByRaw.raw,
    totalGzipBytes:
      expectedAccounting.emittedPayload.gzipBytes -
      expectedAccounting.approvedStaticAssets.gzipBytes,
    totalRawBytes:
      expectedAccounting.emittedPayload.rawBytes -
      expectedAccounting.approvedStaticAssets.rawBytes
  }
  if (
    !exactKeys(value.measurements, Object.keys(phase10BundleBaseline)) ||
    !exactKeys(value.budgets, Object.keys(phase10BundleBaseline)) ||
    Object.entries(expectedMeasurements).some(
      ([metric, measured]) => value.measurements[metric] !== measured
    )
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_SCHEMA_INVALID')
  }
  for (const metric of Object.keys(phase10BundleBaseline)) {
    const budget = value.budgets[metric]
    const expected = evaluatePhase10BundleBudgets(value.measurements)[metric]
    if (
      !Number.isSafeInteger(value.measurements[metric]) ||
      value.measurements[metric] < 0 ||
      !exactKeys(budget, [
        'actual',
        'baseline',
        'ceiling',
        'delta',
        'passed',
        'ratio'
      ]) ||
      Object.entries(expected).some(
        ([field, expectedValue]) => budget[field] !== expectedValue
      ) ||
      typeof budget.passed !== 'boolean'
    ) {
      throw new Error('PHASE10_BUNDLE_EVIDENCE_BUDGET_INVALID')
    }
  }

  const expectedStatus = Object.values(value.budgets).every(
    (budget) => budget.passed
  )
    ? 'passed'
    : 'failed'
  if (value.status !== expectedStatus)
    throw new Error('PHASE10_BUNDLE_EVIDENCE_BUDGET_STATUS_INVALID')

  const assertLargestAsset = (actual, expected) => {
    if (
      !exactKeys(actual, ['gzipBytes', 'path', 'rawBytes']) ||
      actual.path !== expected.path ||
      actual.rawBytes !== expected.raw ||
      actual.gzipBytes !== expected.gzip
    ) {
      throw new Error('PHASE10_BUNDLE_EVIDENCE_LARGEST_ASSET_INVALID')
    }
  }
  if (
    !exactKeys(value.largestAssets, [
      'javaScriptByGzip',
      'javaScriptByRaw',
      'lazyJavaScriptByGzip',
      'lazyJavaScriptByRaw'
    ])
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_LARGEST_ASSET_INVALID')
  }
  assertLargestAsset(
    value.largestAssets.javaScriptByGzip,
    largestJavaScriptByGzip
  )
  assertLargestAsset(
    value.largestAssets.javaScriptByRaw,
    largestJavaScriptByRaw
  )
  assertLargestAsset(
    value.largestAssets.lazyJavaScriptByGzip,
    largestLazyJavaScriptByGzip
  )
  assertLargestAsset(
    value.largestAssets.lazyJavaScriptByRaw,
    largestLazyJavaScriptByRaw
  )

  const assertBoundary = (boundary, source) => {
    const graphEntry = graphBySource.get(source)
    if (
      !exactKeys(boundary, ['file', 'isDynamicEntry', 'isInitial', 'source']) ||
      boundary.source !== source ||
      boundary.file !== graphEntry?.file ||
      boundary.isDynamicEntry !== true ||
      boundary.isInitial !== false ||
      graphEntry?.isDynamicEntry !== true ||
      graphEntry?.isInitial !== false
    ) {
      throw new Error('PHASE10_BUNDLE_EVIDENCE_BOUNDARY_INVALID')
    }
  }
  if (
    JSON.stringify(value.boundaries.admin.map(({ source }) => source)) !==
    JSON.stringify(artifact === 'admin' ? phase10AdminLazySources : [])
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_BOUNDARY_INVALID')
  }
  value.boundaries.admin.forEach((boundary, index) =>
    assertBoundary(boundary, phase10AdminLazySources[index])
  )
  if (artifact === 'web')
    assertBoundary(value.boundaries.dashboard, phase10DashboardLazySource)
}

export const phase10SplitBundleCommand =
  'pnpm --filter @nihongo/web run build && pnpm --filter @nihongo/admin run build'

const singleBuildCommand =
  'pnpm exec vite build --manifest .vite/phase10-manifest.json --ssrManifest .vite/phase10-ssr-manifest.json --outDir <temporary-out-dir> --emptyOutDir'
const splitArtifacts = ['web', 'admin']

const combineArtifactEvidence = (artifacts) => {
  const rows = splitArtifacts
    .flatMap((artifact) =>
      artifacts[artifact].evidence.inventory.rows.map((row) => ({
        ...row,
        path: `${artifact}/${row.path}`
      }))
    )
    .toSorted((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    )
  const web = artifacts.web.evidence
  const admin = artifacts.admin.evidence
  for (const file of phase10ApprovedStaticAssetPaths) {
    const first = web.inventory.rows.find((row) => row.path === file)
    const second = admin.inventory.rows.find((row) => row.path === file)
    if (!first || !second || !isDeepStrictEqual(first, second))
      throw new Error('PHASE10_BUNDLE_SPLIT_STATIC_ASSET_MISMATCH')
  }
  // Keep the original allowance of exactly one canonical static12 copy.
  const payloadAccounting = {
    totalMeasurementScope: web.payloadAccounting.totalMeasurementScope,
    approvedStaticAssets: web.payloadAccounting.approvedStaticAssets,
    emittedPayload: {
      gzipBytes: sum(rows.map((row) => row.gzip)),
      rawBytes: sum(rows.map((row) => row.raw))
    }
  }
  const measurements = Object.fromEntries(
    Object.keys(phase10BundleBaseline).map((metric) => [
      metric,
      metric.startsWith('largest')
        ? Math.max(web.measurements[metric], admin.measurements[metric])
        : web.measurements[metric] + admin.measurements[metric]
    ])
  )
  measurements.totalGzipBytes =
    payloadAccounting.emittedPayload.gzipBytes -
    payloadAccounting.approvedStaticAssets.gzipBytes
  measurements.totalRawBytes =
    payloadAccounting.emittedPayload.rawBytes -
    payloadAccounting.approvedStaticAssets.rawBytes
  const sha256 = createHash('sha256')
    .update(
      JSON.stringify(
        rows.map(({ gzip, path: file, raw }) => ({ path: file, raw, gzip }))
      )
    )
    .digest('hex')
  const payloadSha256 = createHash('sha256')
    .update(JSON.stringify(rows))
    .digest('hex')
  return {
    evaluation: 'informational',
    measurements,
    budgets: evaluatePhase10BundleBudgets(measurements),
    inventory: {
      sha256,
      payloadSha256,
      rows
    },
    payloadAccounting
  }
}

export const collectPhase10BundleEvidence = async ({
  distDirectories,
  metadata
}) => {
  const artifacts = {}
  for (const artifact of splitArtifacts) {
    const distDirectory = distDirectories[artifact]
    const buildManifest = JSON.parse(
      await readFile(
        path.join(distDirectory, 'browser-build-manifest.json'),
        'utf8'
      )
    )
    artifacts[artifact] = {
      base: artifact === 'web' ? '/' : '/admin/',
      buildManifest,
      evidence: await collectArtifactEvidence({
        distDirectory,
        artifact,
        base: artifact === 'web' ? '/' : '/admin/',
        metadata: { ...metadata, command: singleBuildCommand }
      })
    }
  }
  const evidence = {
    schemaVersion: 4,
    kind: 'nihongo.phase10.bundle-performance',
    status: splitArtifacts.every(
      (artifact) => artifacts[artifact].evidence.status === 'passed'
    )
      ? 'passed'
      : 'failed',
    metadata,
    artifacts,
    combined: combineArtifactEvidence(artifacts)
  }
  assertPhase10BundleEvidence(evidence)
  return evidence
}

export const assertPhase10BundleEvidence = (value) => {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'kind',
      'status',
      'metadata',
      'artifacts',
      'combined'
    ]) ||
    value.schemaVersion !== 4 ||
    value.kind !== 'nihongo.phase10.bundle-performance' ||
    !['passed', 'failed'].includes(value.status) ||
    !exactKeys(value.artifacts, splitArtifacts) ||
    value.metadata?.command !== phase10SplitBundleCommand
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_SCHEMA_INVALID')
  }
  for (const artifact of splitArtifacts) {
    const profile = value.artifacts[artifact]
    if (
      !exactKeys(profile, ['base', 'buildManifest', 'evidence']) ||
      profile.base !== (artifact === 'web' ? '/' : '/admin/')
    )
      throw new Error('PHASE10_BUNDLE_EVIDENCE_ARTIFACT_INVALID')
    assertArtifactEvidence(profile.evidence, artifact)
    if (
      !isDeepStrictEqual(profile.evidence.metadata, {
        ...value.metadata,
        command: singleBuildCommand
      })
    )
      throw new Error('PHASE10_BUNDLE_EVIDENCE_ARTIFACT_METADATA_INVALID')
    const manifest = profile.buildManifest
    if (
      !exactKeys(manifest, ['artifact', 'releaseId', 'modules']) ||
      manifest.artifact !== artifact ||
      manifest.releaseId !== value.metadata.commit ||
      !Array.isArray(manifest.modules) ||
      new Set(manifest.modules).size !== manifest.modules.length ||
      !isDeepStrictEqual(manifest.modules, [...manifest.modules].toSorted())
    )
      throw new Error('PHASE10_BUNDLE_EVIDENCE_ARTIFACT_MANIFEST_INVALID')
    assertBrowserBuildGraph(artifact, manifest.modules)
    const bytes = Buffer.from(
      JSON.stringify({
        artifact: manifest.artifact,
        releaseId: manifest.releaseId,
        modules: manifest.modules
      })
    )
    const row = profile.evidence.inventory.rows.find(
      (entry) => entry.path === 'browser-build-manifest.json'
    )
    if (
      !row ||
      row.contentSha256 !== createHash('sha256').update(bytes).digest('hex') ||
      row.raw !== bytes.length ||
      row.gzip !== gzipSync(bytes, { level: 9 }).length
    )
      throw new Error('PHASE10_BUNDLE_EVIDENCE_ARTIFACT_MANIFEST_INVALID')
  }
  const expected = combineArtifactEvidence(value.artifacts)
  if (!isDeepStrictEqual(value.combined, expected))
    throw new Error('PHASE10_BUNDLE_EVIDENCE_COMBINED_INVALID')
  const expectedStatus = splitArtifacts.every(
    (artifact) => value.artifacts[artifact].evidence.status === 'passed'
  )
    ? 'passed'
    : 'failed'
  if (value.status !== expectedStatus)
    throw new Error('PHASE10_BUNDLE_EVIDENCE_BUDGET_STATUS_INVALID')
}

export const assertPhase10BundleEvidenceProvenance = async ({
  evidence,
  repositoryRoot,
  currentTime = Date.now(),
  maximumAgeMilliseconds = 5 * 60 * 1_000
}) => {
  assertPhase10BundleEvidence(evidence)
  if (
    typeof repositoryRoot !== 'string' ||
    !path.isAbsolute(repositoryRoot) ||
    !Number.isSafeInteger(currentTime) ||
    !Number.isSafeInteger(maximumAgeMilliseconds) ||
    maximumAgeMilliseconds <= 0
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_PROVENANCE_INPUT_INVALID')
  }
  const generatedAt = Date.parse(evidence.metadata.generatedAt)
  if (
    generatedAt > currentTime + 5_000 ||
    currentTime - generatedAt > maximumAgeMilliseconds
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_STALE')
  }
  const repositoryState = await readPhase10BundleRepositoryState(repositoryRoot)
  if (
    repositoryState.commit !== evidence.metadata.commit ||
    repositoryState.sourceTreeDirty !== evidence.metadata.sourceTreeDirty ||
    repositoryState.sourceTreeSha256 !== evidence.metadata.sourceTreeSha256
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_PROVENANCE_MISMATCH')
  }
}

export const readPhase10BundleRepositoryState = async (repositoryRoot) => {
  if (typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)) {
    throw new Error('PHASE10_BUNDLE_REPOSITORY_ROOT_INVALID')
  }
  const [commitResult, statusResult, filesResult] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8'
    }),
    execFileAsync(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      {
        cwd: repositoryRoot,
        encoding: 'utf8'
      }
    ),
    execFileAsync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  ])
  const trackedPaths = filesResult.stdout
    .split('\0')
    .filter((relativePath) => relativePath.length > 0)
    .toSorted()
  const sourceTreeHash = createHash('sha256')
  for (const relativePath of trackedPaths) {
    const absolutePath = path.resolve(repositoryRoot, relativePath)
    if (
      absolutePath !== repositoryRoot &&
      !absolutePath.startsWith(`${repositoryRoot}${path.sep}`)
    ) {
      throw new Error('PHASE10_BUNDLE_REPOSITORY_PATH_INVALID')
    }
    sourceTreeHash.update(`path\0${relativePath}\0`)
    try {
      const fileStats = await lstat(absolutePath)
      sourceTreeHash.update(`mode\0${fileStats.mode & 0o777}\0`)
      if (fileStats.isSymbolicLink()) {
        sourceTreeHash.update(`symlink\0${await readlink(absolutePath)}\0`)
      } else if (fileStats.isFile()) {
        sourceTreeHash.update('file\0')
        sourceTreeHash.update(await readFile(absolutePath))
        sourceTreeHash.update('\0')
      } else {
        sourceTreeHash.update('unsupported\0')
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      sourceTreeHash.update('missing\0')
    }
  }
  return {
    commit: commitResult.stdout.trim(),
    sourceTreeDirty: statusResult.stdout.trim().length > 0,
    sourceTreeSha256: sourceTreeHash.digest('hex')
  }
}
