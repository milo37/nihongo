import { mkdtemp, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertPhase10DatabaseApiPerformanceEvidence,
  createPhase10TimingMeasurement,
  phase10ApiPerformanceBudget,
  phase10DatabasePerformanceBudget,
  readPhase10DatabaseApiPerformanceEvidence,
  writePhase10DatabaseApiPerformanceEvidence,
  type Phase10DatabaseApiPerformanceEvidence
} from './phase10PerformanceEvidence.js'

const temporaryDirectories: string[] = []

const statementEvidence = {
  executePerSample: 1,
  queryPerSample: 5,
  sampleCount: 21,
  sqlPerSample: 6,
  totalExecuteCount: 21,
  totalQueryCount: 105,
  totalSqlCount: 126,
  totalTransactionCount: 21,
  transactionPerSample: 1
} as const

const createEvidence = (): Phase10DatabaseApiPerformanceEvidence => {
  const databaseTiming = createPhase10TimingMeasurement({
    ...phase10DatabasePerformanceBudget,
    metric: 'dashboard-insights-service',
    samplesMs: Array.from({ length: 20 }, (_, index) => index + 1)
  })
  const apiTiming = createPhase10TimingMeasurement({
    ...phase10ApiPerformanceBudget,
    metric: 'dashboard-insights-http',
    samplesMs: Array.from({ length: 20 }, (_, index) => index + 1)
  })
  return {
    api: {
      ...apiTiming,
      cacheControl: 'private, no-store',
      noStoreCount: 21,
      principalResolutionCount: 21,
      rateLimitCount: 21,
      requestCount: 21,
      route: 'GET /api/v1/dashboard/insights',
      schemaValidationCount: 21,
      serviceCallCount: 21,
      statements: statementEvidence,
      status: 200,
      statusOkCount: 21
    },
    database: {
      ...databaseTiming,
      plan: {
        cardinality: {
          answerFactCount: 528,
          broadMaximumRows: 600,
          rankedSessionCount: 120,
          recentSessionCount: 3,
          tagFactCount: 600,
          targetCatalogCount: 5
        },
        cteAssertionCount: 5,
        diskSortCount: 0,
        overCardinalityNodeCount: 0,
        queryCount: 5,
        repeatedSubplanCount: 0,
        totalNodeCount: 25
      },
      statements: statementEvidence
    },
    fixture: { answerCount: 528, sessionCount: 120, tagFactCount: 600 },
    kind: 'nihongo.phase10.database-api-performance',
    metadata: {
      command: 'pnpm run test:phase10:performance:database-api',
      commit: 'a'.repeat(40),
      generatedAt: '2026-09-30T00:00:00.000Z',
      mode: 'test',
      node: 'v22.23.0',
      pnpm: '10.2.1',
      sourceTreeDirty: false
    },
    schemaVersion: 1,
    status: 'passed',
    writes: { businessWriteDelta: 0 }
  }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true })
    })
  )
})

describe('Phase 10 DB/API performance evidence', () => {
  it('pins independently reviewed DB and API timing budgets', () => {
    expect(phase10DatabasePerformanceBudget).toEqual({
      absoluteCeilingMs: 250,
      baselineP95Ms: 16.954,
      ratioLimit: 8
    })
    expect(phase10ApiPerformanceBudget).toEqual({
      absoluteCeilingMs: 250,
      baselineP95Ms: 16.845,
      ratioLimit: 8
    })
  })

  it('uses 20 rounded samples with the pinned median and nearest-rank p95', () => {
    const timing = createPhase10TimingMeasurement({
      absoluteCeilingMs: 250,
      baselineP95Ms: 16.954,
      ratioLimit: 8,
      metric: 'dashboard-insights-service',
      samplesMs: Array.from({ length: 20 }, (_, index) => index + 1)
    })

    expect(timing.statisticsMs).toEqual({
      max: 20,
      median: 10.5,
      min: 1,
      p95: 19
    })
    expect(timing.budget).toEqual({
      absoluteCeilingMs: 250,
      baselineP95Ms: 16.954,
      observedToBaselineRatio: 1.121,
      passed: true,
      ratioCeilingMs: 135.632,
      ratioLimit: 8
    })
  })

  it('rejects wrong sample counts, non-finite values, and forged budgets', () => {
    expect(() =>
      createPhase10TimingMeasurement({
        absoluteCeilingMs: 250,
        baselineP95Ms: 16.954,
        ratioLimit: 8,
        metric: 'dashboard-insights-service',
        samplesMs: [1]
      })
    ).toThrow(/PHASE10_PERFORMANCE_MEASUREMENT_INVALID/u)
    expect(() =>
      createPhase10TimingMeasurement({
        absoluteCeilingMs: 250,
        baselineP95Ms: 16.954,
        ratioLimit: 8,
        metric: 'dashboard-insights-service',
        samplesMs: Array.from({ length: 20 }, () => Number.NaN)
      })
    ).toThrow(/PHASE10_PERFORMANCE_MEASUREMENT_INVALID/u)

    const validEvidence = createEvidence()
    const forged = {
      ...validEvidence,
      database: {
        ...validEvidence.database,
        budget: { ...validEvidence.database.budget, passed: false }
      }
    }
    expect(() => assertPhase10DatabaseApiPerformanceEvidence(forged)).toThrow(
      /PHASE10_PERFORMANCE_EVIDENCE_BUDGET_INVALID/u
    )

    const forgedBaseline = {
      ...validEvidence,
      api: {
        ...validEvidence.api,
        budget: {
          ...validEvidence.api.budget,
          baselineP95Ms: 16.846
        }
      }
    }
    expect(() =>
      assertPhase10DatabaseApiPerformanceEvidence(forgedBaseline)
    ).toThrow(/PHASE10_PERFORMANCE_EVIDENCE_BUDGET_INVALID/u)
  })

  it('rejects extra fields and structural counter mutations', () => {
    const extraField = {
      ...createEvidence(),
      credential: 'must-not-be-recorded'
    }
    expect(() =>
      assertPhase10DatabaseApiPerformanceEvidence(extraField)
    ).toThrow(/PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID/u)

    const validEvidence = createEvidence()
    const wrongStatements = {
      ...validEvidence,
      database: {
        ...validEvidence.database,
        statements: {
          ...validEvidence.database.statements,
          queryPerSample: 6
        }
      }
    }
    expect(() =>
      assertPhase10DatabaseApiPerformanceEvidence(wrongStatements)
    ).toThrow(/PHASE10_PERFORMANCE_EVIDENCE_CONTRACT_INVALID/u)

    const invalidFixture = {
      ...validEvidence,
      fixture: { answerCount: 0, sessionCount: 0, tagFactCount: 0 }
    }
    expect(() =>
      assertPhase10DatabaseApiPerformanceEvidence(invalidFixture)
    ).toThrow(/PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID/u)

    const invalidTimestamp = {
      ...validEvidence,
      metadata: { ...validEvidence.metadata, generatedAt: '0' }
    }
    expect(() =>
      assertPhase10DatabaseApiPerformanceEvidence(invalidTimestamp)
    ).toThrow(/PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID/u)
  })

  it('writes canonical evidence atomically with mode 0600', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'nihongo-phase10-performance-evidence-')
    )
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'database-api.json')

    await writePhase10DatabaseApiPerformanceEvidence({
      evidence: createEvidence(),
      filePath
    })

    expect(await readPhase10DatabaseApiPerformanceEvidence(filePath)).toEqual(
      createEvidence()
    )
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })
})
