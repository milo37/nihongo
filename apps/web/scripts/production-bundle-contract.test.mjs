import { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import {
  assertBundleEvidence,
  assertBundleForwardingCoverage,
  createBundleBudgetError,
  createBundleForwardingProof,
  createBundleSsrAssetClosureError,
  describeBundlePayloadIdentity,
  evaluateBundleBudgets,
  allowedProductionModulePackages,
  adminLazySources,
  approvedStaticAssetPaths,
  bundleBaseline,
  bundleCeilings,
  dashboardLazySource,
  forbiddenMockMarkers,
  forbiddenMockSources
} from './production-bundle-contract.mjs'

test('keeps the previous bundle exports compatible', async () => {
  const bundle = await import('./production-bundle-contract.mjs')
  assert.equal(typeof bundle.splitBundleCommand, 'string')
  for (const name of [
    'describeBundlePayloadIdentity',
    'createBundleSsrAssetClosureError',
    'createBundleForwardingProof',
    'assertBundleForwardingCoverage',
    'collectBundleEvidence',
    'assertBundleEvidence',
    'assertBundleEvidenceProvenance',
    'readBundleRepositoryState'
  ]) {
    assert.equal(typeof bundle[name], 'function', name)
  }
  assert.equal(
    bundle.describePhase10PayloadIdentity,
    bundle.describeBundlePayloadIdentity
  )
  assert.equal(
    bundle.createPhase10SsrAssetClosureError,
    bundle.createBundleSsrAssetClosureError
  )
  assert.equal(
    bundle.createPhase10ForwardingProof,
    bundle.createBundleForwardingProof
  )
  assert.equal(
    bundle.assertPhase10ForwardingCoverage,
    bundle.assertBundleForwardingCoverage
  )
  assert.equal(bundle.phase10SplitBundleCommand, bundle.splitBundleCommand)
  assert.equal(
    bundle.collectPhase10BundleEvidence,
    bundle.collectBundleEvidence
  )
  assert.equal(bundle.assertPhase10BundleEvidence, bundle.assertBundleEvidence)
  assert.equal(
    bundle.assertPhase10BundleEvidenceProvenance,
    bundle.assertBundleEvidenceProvenance
  )
  assert.equal(
    bundle.readPhase10BundleRepositoryState,
    bundle.readBundleRepositoryState
  )
})

test('keeps one explicit ceiling for every bundle measurement', () => {
  assert.deepEqual(
    Object.keys(bundleBaseline).toSorted(),
    Object.keys(bundleCeilings).toSorted()
  )
  for (const metric of Object.keys(bundleBaseline)) {
    assert.ok(Number.isSafeInteger(bundleBaseline[metric]), metric)
    assert.ok(bundleCeilings[metric] >= bundleBaseline[metric], metric)
  }
})

test('keeps separated ADMIN/dashboard lazy routes and mock-only source inventory', () => {
  const readLazySources = (router) =>
    [
      ...readFileSync(new URL(router, import.meta.url), 'utf8').matchAll(
        /import\('@app\/([^']+)'\)/gu
      )
    ]
      .map((match) => `src/app/${match[1]}.tsx`)
      .toSorted()
  assert.deepEqual(
    [
      ...adminLazySources,
      'src/app/admin-import/page.tsx',
      'src/app/admin-question/detail/page.tsx'
    ].toSorted(),
    readLazySources('../../admin/src/app/admin-question/router.tsx')
  )
  assert.deepEqual(
    [dashboardLazySource],
    readLazySources('../src/app/dashboard/router.tsx')
  )
  assert.deepEqual(forbiddenMockSources, [
    'src/mocks/browser.ts',
    'src/mocks/components/MockAuthenticationNotice.tsx',
    'src/mocks/service.ts'
  ])
  assert.deepEqual(forbiddenMockMarkers, [
    'MockAuthenticationNotice',
    'msw/browser',
    'setupWorker'
  ])
  assert.deepEqual(allowedProductionModulePackages, [
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
})

test('accepts the measured baseline and rejects every exceeded ceiling', () => {
  const baselineBudgets = evaluateBundleBudgets(bundleBaseline)
  assert.equal(
    Object.values(baselineBudgets).every(({ passed }) => passed),
    true
  )

  for (const metric of Object.keys(bundleCeilings)) {
    const measurements = {
      ...bundleBaseline,
      [metric]: bundleCeilings[metric] + 1
    }
    assert.equal(
      evaluateBundleBudgets(measurements)[metric].passed,
      false,
      metric
    )
  }
})

test('fails closed on incomplete bundle evidence', () => {
  assert.throws(
    () =>
      assertBundleEvidence({
        kind: 'nihongo.phase10.bundle-performance',
        schemaVersion: 1,
        status: 'passed'
      }),
    /PHASE10_BUNDLE_EVIDENCE_SCHEMA_INVALID/u
  )
})

test('separates only the exact unchanged Vite approved static asset list', () => {
  const config = readFileSync(
    new URL('../../../packages/browser/vite.config.ts', import.meta.url),
    'utf8'
  )
  const approvedPaths = [
    ...config
      .split('const approvedBrandAssetPaths = [')[1]
      .split('] as const')[0]
      .matchAll(/'([^']+)'/gu)
  ].map((match) => match[1])
  assert.deepEqual(approvedStaticAssetPaths, approvedPaths)
  assert.equal(approvedPaths.length, 12)
})

test('reports exact sorted missing and extra SSR asset paths', () => {
  const error = createBundleSsrAssetClosureError(
    new Set(['assets/shared.js', 'assets/extra-z.js', 'assets/extra-a.js']),
    ['assets/missing-z.js', 'assets/shared.js', 'assets/missing-a.js']
  )
  assert.equal(
    error.message,
    'PHASE10_BUNDLE_SSR_ASSET_CLOSURE_MISMATCH:' +
      JSON.stringify({
        missing: ['assets/missing-a.js', 'assets/missing-z.js'],
        extra: ['assets/extra-a.js', 'assets/extra-z.js']
      })
  )
})

test('recognizes only forwarding local imports and named exports', () => {
  assert.deepEqual(
    describeBundlePayloadIdentity(
      'import{t as e}from"./page-CNAv-V64.js";export{e as PracticePage};\n'
    ),
    {
      kind: 'local-import-named-export-only',
      body: null,
      relativeTargets: ['./page-CNAv-V64.js'],
      bindings: [{ imported: 't', local: 'e', exported: 'PracticePage' }],
      executableStatementCount: 0
    }
  )
  assert.deepEqual(
    describeBundlePayloadIdentity(
      'export{a as default}from"./implementation-A1.js";\n'
    ),
    {
      kind: 'local-reexport-only',
      body: null,
      relativeTargets: ['./implementation-A1.js'],
      bindings: [{ imported: 'a', local: null, exported: 'default' }],
      executableStatementCount: 0
    }
  )
  for (const source of [
    'import "./side-effect.js";export{a};',
    'import{a}from"https://example.test/a.js";export{a};',
    'import{a}from"../a.js";export{a};',
    'import{a}from"./a.js";export{a};console.log(a);',
    'import{a}from"./a.js";export{b};',
    'import{a}from"./a.js";export{a as x,a as x};',
    'import{a as x,b as x}from"./a.js";export{x};',
    'import{a,b}from"./a.js";export{a};',
    "export const value = 'private test text';"
  ]) {
    assert.deepEqual(describeBundlePayloadIdentity(source), {
      kind: 'body-omitted',
      body: null,
      relativeTargets: []
    })
  }
})

// Pure helper inputs exercise coverage relations; no canonical producer input is replaced.
test('proves exact forwarding coverage and rejects unbound claims', () => {
  const source = 'import{t as e}from"./implementation.js";export{e as Page};\n'
  const bytes = Buffer.from(source)
  const entry = {
    source: 'src/feature/page.tsx',
    file: 'assets/facade.js',
    isEntry: false,
    isDynamicEntry: true,
    imports: ['_implementation.js'],
    dynamicImports: [],
    css: []
  }
  const graph = [
    {
      source: 'index.html',
      file: 'assets/index.js',
      isEntry: true,
      isDynamicEntry: false,
      imports: [],
      dynamicImports: [entry.source],
      css: []
    },
    {
      source: '_implementation.js',
      file: 'assets/implementation.js',
      isEntry: false,
      isDynamicEntry: false,
      imports: [],
      dynamicImports: [],
      css: []
    },
    entry
  ]
  const payload = {
    path: entry.file,
    source,
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    contentSha256: createHash('sha256').update(bytes).digest('hex')
  }
  const proof = createBundleForwardingProof(payload, entry)
  const input = {
    graph,
    moduleRows: [
      { source: entry.source, assets: ['/assets/implementation.js'] }
    ],
    inventoryRows: [
      {
        path: entry.file,
        raw: payload.rawBytes,
        gzip: payload.gzipBytes,
        contentSha256: payload.contentSha256
      }
    ],
    forwardingFacades: [proof]
  }
  assert.doesNotThrow(() => assertBundleForwardingCoverage(input))
  for (const mutate of [
    (value) => {
      value.forwardingFacades[0].target = 'assets/other.js'
    },
    (value) => {
      value.forwardingFacades[0].contentSha256 = '0'.repeat(64)
    },
    (value) => {
      value.forwardingFacades[0].identity.bindings[0].exported = 'Other'
    },
    (value) => {
      value.forwardingFacades[0].syntaxTokens = ['export', ' ', 'const', 'x']
    },
    (value) => {
      value.forwardingFacades[0].source = '_implementation.js'
    },
    (value) => {
      value.forwardingFacades = []
    },
    (value) => {
      value.forwardingFacades.push(value.forwardingFacades[0])
    },
    (value) => {
      value.moduleRows[0].assets.push('/assets/extra.js')
    },
    (value) => {
      value.moduleRows[0].assets.push('/assets/facade.js')
    }
  ]) {
    const candidate = JSON.parse(JSON.stringify(input))
    mutate(candidate)
    assert.throws(() => assertBundleForwardingCoverage(candidate), /PHASE10_/u)
  }
})

test('reports sorted budget metrics and exact lazy asset context without body', () => {
  const budgets = evaluateBundleBudgets({
    ...bundleBaseline,
    largestLazyJavaScriptGzipBytes: 24_058
  })
  const asset = {
    path: 'assets/locale.js',
    rawBytes: 92_000,
    gzipBytes: 24_058,
    contentSha256: 'a'.repeat(64),
    source: 'RAW_ASSET_BODY_MUST_NOT_BE_LOGGED'
  }
  const graph = [
    {
      source: 'src/locale.ts',
      file: asset.path,
      isEntry: false,
      isDynamicEntry: true,
      imports: ['_z.js', '_a.js'],
      dynamicImports: [],
      css: ['z.css', 'a.css']
    },
    {
      source: 'index.html',
      file: 'assets/index.js',
      isEntry: true,
      isDynamicEntry: false,
      imports: [],
      dynamicImports: ['src/locale.ts'],
      css: []
    }
  ]
  const error = createBundleBudgetError(budgets, asset, graph)
  assert.equal(
    error.message.startsWith('PHASE10_BUNDLE_BUDGET_EXCEEDED:'),
    true
  )
  assert.equal(error.message.includes(asset.source), false)
  const context = JSON.parse(error.message.split('EXCEEDED:')[1])
  assert.deepEqual(context.budgets, budgets)
  assert.deepEqual(
    Object.keys(context.budgets),
    Object.keys(budgets).toSorted()
  )
  assert.deepEqual(context.budgets.largestLazyJavaScriptGzipBytes, {
    actual: 24_058,
    baseline: 22_581,
    ceiling: 24_000,
    delta: 1_477,
    passed: false,
    ratio: 1.065409
  })
  assert.deepEqual(context.largestLazyJavaScriptByGzip, {
    path: asset.path,
    rawBytes: asset.rawBytes,
    gzipBytes: asset.gzipBytes,
    contentSha256: asset.contentSha256,
    manifestEntries: [
      { ...graph[0], imports: ['_a.js', '_z.js'], css: ['a.css', 'z.css'] }
    ],
    incomingEdges: [
      { source: 'index.html', kind: 'dynamicImports', target: 'src/locale.ts' }
    ]
  })
  assert.equal(
    createBundleBudgetError(
      Object.fromEntries(Object.entries(budgets).reverse()),
      asset,
      graph.toReversed().map((entry) => ({
        ...entry,
        imports: entry.imports.toReversed(),
        dynamicImports: entry.dynamicImports.toReversed(),
        css: entry.css.toReversed()
      }))
    ).message,
    error.message
  )
})
