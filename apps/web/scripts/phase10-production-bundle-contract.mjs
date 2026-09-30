import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, readFile, readdir, readlink } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { validateProductionBundleRuntime } from './phase9-production-bundle-contract.mjs'

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

export const phase10AcceptedBundleDigest =
  '30905281018ac9428bbfb246dee0ec4a5f9ed40a09ea8460e3f87823f7c5f784'

export const phase10AcceptedBundlePayloadDigest =
  '4312053cfe11e247ad424fd137ba349d8311078c6d31a1fcedfe16799675127c'

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
  'src/app/admin-audit/page.tsx',
  'src/app/admin-import/page.tsx',
  'src/app/admin-question/create/page.tsx',
  'src/app/admin-question/detail/page.tsx',
  'src/app/admin-question/page.tsx',
  'src/app/admin-report/detail/page.tsx',
  'src/app/admin-report/page.tsx'
])

export const phase10ChartLazySource =
  'src/app/dashboard/components/DashboardInsightChart.tsx'

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
  const markerIndex = source.lastIndexOf(marker)
  if (markerIndex === -1) return null
  const packagePath = source.slice(markerIndex + marker.length)
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

const readModuleGraph = async (distDirectory) => {
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
            asset.startsWith('/assets/') &&
            !asset.includes('\\')
        )
      ) {
        throw new Error('PHASE10_BUNDLE_SSR_MANIFEST_ENTRY_INVALID')
      }
      const normalizedAssets = [...assets].toSorted()
      if (new Set(normalizedAssets).size !== normalizedAssets.length) {
        throw new Error('PHASE10_BUNDLE_SSR_MANIFEST_ENTRY_INVALID')
      }
      assertProductionModuleSource(source)
      return { assets: normalizedAssets, source }
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

const readHtmlInitialAssets = (html) =>
  [...html.matchAll(/(?:src|href)=["']\/([^"']+\.(?:css|js))["']/giu)]
    .map((match) => match[1])
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

export const collectPhase10BundleEvidence = async ({
  distDirectory,
  metadata
}) => {
  const payloadFiles = await readPayloadFiles(distDirectory)
  const moduleGraph = await readModuleGraph(distDirectory)
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
    .map(([source, value]) => normalizeManifestEntry(source, value))
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
  const htmlAssets = readHtmlInitialAssets(htmlRow.source)
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
  if (
    JSON.stringify([...ssrAssetPaths].toSorted()) !==
    JSON.stringify(expectedSsrAssetPaths)
  ) {
    throw new Error('PHASE10_BUNDLE_SSR_ASSET_CLOSURE_MISMATCH')
  }
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
    totalGzipBytes: sum(payloadFiles.map(({ gzipBytes }) => gzipBytes)),
    totalRawBytes: sum(payloadFiles.map(({ rawBytes }) => rawBytes))
  }
  const budgets = evaluatePhase10BundleBudgets(measurements)
  if (Object.values(budgets).some(({ passed }) => !passed)) {
    throw new Error('PHASE10_BUNDLE_BUDGET_EXCEEDED')
  }

  const inventory = payloadFiles.map(
    ({ contentSha256, path: file, rawBytes, gzipBytes }) => ({
      contentSha256,
      gzip: gzipBytes,
      path: file,
      raw: rawBytes
    })
  )
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
  const admin = phase10AdminLazySources.map((source) =>
    assertExpectedLazyBoundary(evidenceBySource, source)
  )
  const chart = assertExpectedLazyBoundary(
    evidenceBySource,
    phase10ChartLazySource
  )
  const evidence = {
    boundaries: { admin, chart },
    budgets,
    graph: evidenceGraph,
    inventory: {
      acceptedBaselineSha256: phase10AcceptedBundleDigest,
      matchesAcceptedBaseline: inventorySha256 === phase10AcceptedBundleDigest,
      payloadAcceptedBaselineSha256: phase10AcceptedBundlePayloadDigest,
      payloadMatchesAcceptedBaseline:
        payloadSha256 === phase10AcceptedBundlePayloadDigest,
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
    schemaVersion: 1,
    status: 'passed'
  }
  assertPhase10BundleEvidence(evidence)
  return evidence
}

export const assertPhase10BundleEvidence = (value) => {
  if (
    !exactKeys(value, [
      'boundaries',
      'budgets',
      'graph',
      'inventory',
      'kind',
      'largestAssets',
      'measurements',
      'metadata',
      'modules',
      'schemaVersion',
      'status'
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'nihongo.phase10.bundle-performance' ||
    value.status !== 'passed' ||
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
    value.metadata.versions.vite !== '8.2.1' ||
    !Array.isArray(value.graph) ||
    value.graph.length === 0 ||
    !exactKeys(value.inventory, [
      'acceptedBaselineSha256',
      'matchesAcceptedBaseline',
      'payloadAcceptedBaselineSha256',
      'payloadMatchesAcceptedBaseline',
      'payloadSha256',
      'rows',
      'sha256'
    ]) ||
    !SHA256_PATTERN.test(value.inventory.sha256) ||
    value.inventory.acceptedBaselineSha256 !== phase10AcceptedBundleDigest ||
    value.inventory.matchesAcceptedBaseline !==
      (value.inventory.sha256 === phase10AcceptedBundleDigest) ||
    !SHA256_PATTERN.test(value.inventory.payloadSha256) ||
    value.inventory.payloadAcceptedBaselineSha256 !==
      phase10AcceptedBundlePayloadDigest ||
    value.inventory.payloadMatchesAcceptedBaseline !==
      (value.inventory.payloadSha256 === phase10AcceptedBundlePayloadDigest) ||
    !Array.isArray(value.inventory.rows) ||
    value.inventory.rows.length === 0 ||
    !exactKeys(value.modules, ['count', 'rows', 'sha256']) ||
    !Number.isSafeInteger(value.modules.count) ||
    value.modules.count < 1 ||
    !SHA256_PATTERN.test(value.modules.sha256) ||
    !Array.isArray(value.modules.rows) ||
    value.modules.rows.length !== value.modules.count ||
    !exactKeys(value.boundaries, ['admin', 'chart']) ||
    !Array.isArray(value.boundaries.admin) ||
    value.boundaries.admin.length !== phase10AdminLazySources.length ||
    !value.boundaries.chart ||
    typeof value.boundaries.chart !== 'object'
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
  moduleSources.forEach(assertProductionModuleSource)

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
  const ssrAssetPaths = new Set(
    moduleRows.flatMap(({ assets }) => assets.map((asset) => asset.slice(1)))
  )
  const entryOutputFiles = new Set(
    graph.filter(({ isEntry }) => isEntry).map(({ file }) => file)
  )
  if (
    JSON.stringify([...ssrAssetPaths].toSorted()) !==
    JSON.stringify(
      [...outputFiles].filter((file) => !entryOutputFiles.has(file)).toSorted()
    )
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_SSR_GRAPH_INVALID')
  }
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
    totalGzipBytes: sum(rows.map(({ gzip }) => gzip)),
    totalRawBytes: sum(rows.map(({ raw }) => raw))
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
      budget.passed !== true
    ) {
      throw new Error('PHASE10_BUNDLE_EVIDENCE_BUDGET_INVALID')
    }
  }

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
    JSON.stringify(phase10AdminLazySources)
  ) {
    throw new Error('PHASE10_BUNDLE_EVIDENCE_BOUNDARY_INVALID')
  }
  value.boundaries.admin.forEach((boundary, index) =>
    assertBoundary(boundary, phase10AdminLazySources[index])
  )
  assertBoundary(value.boundaries.chart, phase10ChartLazySource)
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
