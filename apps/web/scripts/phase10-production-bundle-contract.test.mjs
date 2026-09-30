import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertPhase10BundleEvidence,
  evaluatePhase10BundleBudgets,
  phase10AcceptedBundleDigest,
  phase10AcceptedBundlePayloadDigest,
  phase10AllowedProductionModulePackages,
  phase10AdminLazySources,
  phase10BundleBaseline,
  phase10BundleCeilings,
  phase10ChartLazySource,
  phase10ForbiddenMockMarkers,
  phase10ForbiddenMockSources
} from './phase10-production-bundle-contract.mjs'

test('pins the accepted Phase 9 production baseline and Phase 10 ceilings', () => {
  assert.deepEqual(phase10BundleBaseline, {
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
  assert.deepEqual(phase10BundleCeilings, {
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
  assert.equal(
    phase10AcceptedBundleDigest,
    '30905281018ac9428bbfb246dee0ec4a5f9ed40a09ea8460e3f87823f7c5f784'
  )
  assert.equal(
    phase10AcceptedBundlePayloadDigest,
    '4312053cfe11e247ad424fd137ba349d8311078c6d31a1fcedfe16799675127c'
  )
})

test('pins the exact ADMIN, chart and mock-only source inventory', () => {
  assert.deepEqual(phase10AdminLazySources, [
    'src/app/admin-audit/page.tsx',
    'src/app/admin-import/page.tsx',
    'src/app/admin-question/create/page.tsx',
    'src/app/admin-question/detail/page.tsx',
    'src/app/admin-question/page.tsx',
    'src/app/admin-report/detail/page.tsx',
    'src/app/admin-report/page.tsx'
  ])
  assert.equal(
    phase10ChartLazySource,
    'src/app/dashboard/components/DashboardInsightChart.tsx'
  )
  assert.deepEqual(phase10ForbiddenMockSources, [
    'src/mocks/browser.ts',
    'src/mocks/components/MockAuthenticationNotice.tsx',
    'src/mocks/service.ts'
  ])
  assert.deepEqual(phase10ForbiddenMockMarkers, [
    'MockAuthenticationNotice',
    'msw/browser',
    'setupWorker'
  ])
  assert.deepEqual(phase10AllowedProductionModulePackages, [
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
  const baselineBudgets = evaluatePhase10BundleBudgets(phase10BundleBaseline)
  assert.equal(
    Object.values(baselineBudgets).every(({ passed }) => passed),
    true
  )

  for (const metric of Object.keys(phase10BundleCeilings)) {
    const measurements = {
      ...phase10BundleBaseline,
      [metric]: phase10BundleCeilings[metric] + 1
    }
    assert.equal(
      evaluatePhase10BundleBudgets(measurements)[metric].passed,
      false,
      metric
    )
  }
})

test('fails closed on incomplete bundle evidence', () => {
  assert.throws(
    () =>
      assertPhase10BundleEvidence({
        kind: 'nihongo.phase10.bundle-performance',
        schemaVersion: 1,
        status: 'passed'
      }),
    /PHASE10_BUNDLE_EVIDENCE_SCHEMA_INVALID/u
  )
})
