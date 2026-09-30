import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/u

export const phase10DatabasePerformanceBudget = Object.freeze({
  absoluteCeilingMs: 250,
  baselineP95Ms: 16.954,
  ratioLimit: 8
})

export const phase10ApiPerformanceBudget = Object.freeze({
  absoluteCeilingMs: 250,
  baselineP95Ms: 16.845,
  ratioLimit: 8
})

interface TimingStatistics {
  readonly max: number
  readonly median: number
  readonly min: number
  readonly p95: number
}

interface TimingBudget {
  readonly absoluteCeilingMs: number
  readonly baselineP95Ms: number
  readonly observedToBaselineRatio: number
  readonly passed: boolean
  readonly ratioCeilingMs: number
  readonly ratioLimit: number
}

interface StatementEvidence {
  readonly executePerSample: number
  readonly queryPerSample: number
  readonly sampleCount: number
  readonly sqlPerSample: number
  readonly totalExecuteCount: number
  readonly totalQueryCount: number
  readonly totalSqlCount: number
  readonly totalTransactionCount: number
  readonly transactionPerSample: number
}

export interface Phase10TimingMeasurement {
  readonly budget: TimingBudget
  readonly measuredCount: number
  readonly metric: string
  readonly samplesMs: readonly number[]
  readonly statisticsMs: TimingStatistics
  readonly warmupCount: number
}

export interface Phase10DatabaseApiPerformanceEvidence {
  readonly api: Phase10TimingMeasurement & {
    readonly cacheControl: 'private, no-store'
    readonly noStoreCount: number
    readonly principalResolutionCount: number
    readonly rateLimitCount: number
    readonly requestCount: number
    readonly route: 'GET /api/v1/dashboard/insights'
    readonly schemaValidationCount: number
    readonly serviceCallCount: number
    readonly statements: StatementEvidence
    readonly status: 200
    readonly statusOkCount: number
  }
  readonly database: Phase10TimingMeasurement & {
    readonly plan: {
      readonly cteAssertionCount: number
      readonly cardinality: {
        readonly answerFactCount: number
        readonly broadMaximumRows: number
        readonly rankedSessionCount: number
        readonly recentSessionCount: number
        readonly tagFactCount: number
        readonly targetCatalogCount: number
      }
      readonly diskSortCount: number
      readonly overCardinalityNodeCount: number
      readonly queryCount: number
      readonly repeatedSubplanCount: number
      readonly totalNodeCount: number
    }
    readonly statements: StatementEvidence
  }
  readonly fixture: {
    readonly answerCount: number
    readonly sessionCount: number
    readonly tagFactCount: number
  }
  readonly kind: 'nihongo.phase10.database-api-performance'
  readonly metadata: {
    readonly command: 'pnpm run test:phase10:performance:database-api'
    readonly commit: string
    readonly generatedAt: string
    readonly mode: 'test'
    readonly node: string
    readonly pnpm: string
    readonly sourceTreeDirty: boolean
  }
  readonly schemaVersion: 1
  readonly status: 'passed'
  readonly writes: {
    readonly businessWriteDelta: 0
  }
}

const exactKeys = (value: unknown, expected: readonly string[]): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).toSorted()) ===
    JSON.stringify([...expected].toSorted())

const roundMilliseconds = (value: number): number => Number(value.toFixed(3))

const assertFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const isRoundedMillisecond = (value: unknown): value is number =>
  assertFiniteNonNegative(value) && roundMilliseconds(value) === value

const calculateStatistics = (samples: readonly number[]): TimingStatistics => {
  const sorted = [...samples].toSorted((left, right) => left - right)
  const lowerMedian = sorted[9]
  const upperMedian = sorted[10]
  const p95 = sorted[18]
  const min = sorted[0]
  const max = sorted[19]
  if (
    min === undefined ||
    lowerMedian === undefined ||
    upperMedian === undefined ||
    p95 === undefined ||
    max === undefined
  ) {
    throw new Error('PHASE10_PERFORMANCE_SAMPLE_COUNT_INVALID')
  }
  return {
    max,
    median: roundMilliseconds((lowerMedian + upperMedian) / 2),
    min,
    p95
  }
}

export const createPhase10TimingMeasurement = ({
  absoluteCeilingMs,
  baselineP95Ms,
  ratioLimit,
  metric,
  samplesMs
}: {
  readonly absoluteCeilingMs: number
  readonly baselineP95Ms: number
  readonly ratioLimit: number
  readonly metric: string
  readonly samplesMs: readonly number[]
}): Phase10TimingMeasurement => {
  const roundedSamples = samplesMs.map(roundMilliseconds)
  if (
    roundedSamples.length !== 20 ||
    roundedSamples.some((sample) => !assertFiniteNonNegative(sample)) ||
    !assertFiniteNonNegative(baselineP95Ms) ||
    baselineP95Ms === 0 ||
    !assertFiniteNonNegative(ratioLimit) ||
    ratioLimit < 1 ||
    !assertFiniteNonNegative(absoluteCeilingMs) ||
    typeof metric !== 'string' ||
    metric.length === 0
  ) {
    throw new Error('PHASE10_PERFORMANCE_MEASUREMENT_INVALID')
  }
  const statisticsMs = calculateStatistics(roundedSamples)
  const ratioCeilingMs = roundMilliseconds(baselineP95Ms * ratioLimit)
  return {
    budget: {
      absoluteCeilingMs,
      baselineP95Ms,
      observedToBaselineRatio: roundMilliseconds(
        statisticsMs.p95 / baselineP95Ms
      ),
      passed:
        statisticsMs.p95 <= ratioCeilingMs &&
        statisticsMs.p95 <= absoluteCeilingMs,
      ratioCeilingMs,
      ratioLimit
    },
    measuredCount: roundedSamples.length,
    metric,
    samplesMs: roundedSamples,
    statisticsMs,
    warmupCount: 1
  }
}

const assertTimingMeasurement = (value: unknown): void => {
  if (
    !exactKeys(value, [
      'budget',
      'measuredCount',
      'metric',
      'samplesMs',
      'statisticsMs',
      'warmupCount'
    ])
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID')
  }
  const timing = value as Record<string, unknown>
  if (
    timing.warmupCount !== 1 ||
    timing.measuredCount !== 20 ||
    typeof timing.metric !== 'string' ||
    timing.metric.length === 0 ||
    !Array.isArray(timing.samplesMs) ||
    timing.samplesMs.length !== 20 ||
    timing.samplesMs.some((sample) => !isRoundedMillisecond(sample)) ||
    !exactKeys(timing.statisticsMs, ['max', 'median', 'min', 'p95']) ||
    !exactKeys(timing.budget, [
      'absoluteCeilingMs',
      'baselineP95Ms',
      'observedToBaselineRatio',
      'passed',
      'ratioCeilingMs',
      'ratioLimit'
    ])
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID')
  }
  const statistics = timing.statisticsMs as Record<string, unknown>
  const expectedStatistics = calculateStatistics(
    timing.samplesMs as readonly number[]
  )
  if (
    JSON.stringify(statistics) !== JSON.stringify(expectedStatistics) ||
    !Object.values(statistics).every(assertFiniteNonNegative)
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_STATISTICS_INVALID')
  }
  const budget = timing.budget as Record<string, unknown>
  if (
    !assertFiniteNonNegative(budget.baselineP95Ms) ||
    budget.baselineP95Ms === 0 ||
    !assertFiniteNonNegative(budget.ratioLimit) ||
    budget.ratioLimit < 1 ||
    !assertFiniteNonNegative(budget.ratioCeilingMs) ||
    !assertFiniteNonNegative(budget.absoluteCeilingMs) ||
    budget.ratioCeilingMs !==
      roundMilliseconds(budget.baselineP95Ms * budget.ratioLimit) ||
    budget.observedToBaselineRatio !==
      roundMilliseconds(expectedStatistics.p95 / budget.baselineP95Ms) ||
    budget.passed !==
      (expectedStatistics.p95 <= budget.ratioCeilingMs &&
        expectedStatistics.p95 <= budget.absoluteCeilingMs)
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_BUDGET_INVALID')
  }
}

const assertStatementEvidence = (
  value: unknown,
  expectedSampleCount: number
): void => {
  if (
    !exactKeys(value, [
      'executePerSample',
      'queryPerSample',
      'sampleCount',
      'sqlPerSample',
      'totalExecuteCount',
      'totalQueryCount',
      'totalSqlCount',
      'totalTransactionCount',
      'transactionPerSample'
    ])
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID')
  }
  const statements = value as Record<string, unknown>
  if (
    !Object.values(statements).every(
      (count) => Number.isSafeInteger(count) && Number(count) >= 0
    ) ||
    statements.executePerSample !== 1 ||
    statements.queryPerSample !== 5 ||
    statements.transactionPerSample !== 1 ||
    statements.sqlPerSample !== 6 ||
    statements.sampleCount !== expectedSampleCount ||
    statements.totalExecuteCount !== expectedSampleCount ||
    statements.totalQueryCount !== expectedSampleCount * 5 ||
    statements.totalTransactionCount !== expectedSampleCount ||
    statements.totalSqlCount !== expectedSampleCount * 6
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_CONTRACT_INVALID')
  }
}

export const assertPhase10DatabaseApiPerformanceEvidence: (
  value: unknown
) => asserts value is Phase10DatabaseApiPerformanceEvidence = (value) => {
  if (
    !exactKeys(value, [
      'api',
      'database',
      'fixture',
      'kind',
      'metadata',
      'schemaVersion',
      'status',
      'writes'
    ])
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID')
  }
  const evidence = value as Record<string, unknown>
  if (
    evidence.schemaVersion !== 1 ||
    evidence.kind !== 'nihongo.phase10.database-api-performance' ||
    evidence.status !== 'passed' ||
    !exactKeys(evidence.metadata, [
      'command',
      'commit',
      'generatedAt',
      'mode',
      'node',
      'pnpm',
      'sourceTreeDirty'
    ]) ||
    !exactKeys(evidence.fixture, [
      'answerCount',
      'sessionCount',
      'tagFactCount'
    ]) ||
    !exactKeys(evidence.writes, ['businessWriteDelta'])
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID')
  }
  const metadata = evidence.metadata as Record<string, unknown>
  const fixture = evidence.fixture as Record<string, unknown>
  const writes = evidence.writes as Record<string, unknown>
  if (
    metadata.command !== 'pnpm run test:phase10:performance:database-api' ||
    typeof metadata.commit !== 'string' ||
    !GIT_COMMIT_PATTERN.test(metadata.commit) ||
    typeof metadata.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(metadata.generatedAt)) ||
    new Date(metadata.generatedAt).toISOString() !== metadata.generatedAt ||
    metadata.mode !== 'test' ||
    metadata.node !== 'v22.23.0' ||
    metadata.pnpm !== '10.2.1' ||
    typeof metadata.sourceTreeDirty !== 'boolean' ||
    !Object.values(fixture).every(
      (count) => Number.isSafeInteger(count) && Number(count) >= 0
    ) ||
    Number(fixture.answerCount) < 500 ||
    fixture.sessionCount !== 120 ||
    Number(fixture.tagFactCount) < 1 ||
    writes.businessWriteDelta !== 0
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID')
  }

  const database = evidence.database as Record<string, unknown>
  const api = evidence.api as Record<string, unknown>
  if (
    !exactKeys(database, [
      'budget',
      'measuredCount',
      'metric',
      'plan',
      'samplesMs',
      'statements',
      'statisticsMs',
      'warmupCount'
    ]) ||
    !exactKeys(api, [
      'budget',
      'cacheControl',
      'measuredCount',
      'metric',
      'noStoreCount',
      'principalResolutionCount',
      'rateLimitCount',
      'requestCount',
      'route',
      'samplesMs',
      'schemaValidationCount',
      'serviceCallCount',
      'statements',
      'statisticsMs',
      'status',
      'statusOkCount',
      'warmupCount'
    ])
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID')
  }
  const databaseTiming = Object.fromEntries(
    Object.entries(database).filter(
      ([key]) => !['plan', 'statements'].includes(key)
    )
  )
  const apiTiming = Object.fromEntries(
    Object.entries(api).filter(
      ([key]) =>
        ![
          'cacheControl',
          'noStoreCount',
          'principalResolutionCount',
          'rateLimitCount',
          'requestCount',
          'route',
          'schemaValidationCount',
          'serviceCallCount',
          'statements',
          'status',
          'statusOkCount'
        ].includes(key)
    )
  )
  assertTimingMeasurement(databaseTiming)
  assertTimingMeasurement(apiTiming)
  if (
    !exactKeys(database.plan, [
      'cardinality',
      'cteAssertionCount',
      'diskSortCount',
      'overCardinalityNodeCount',
      'queryCount',
      'repeatedSubplanCount',
      'totalNodeCount'
    ])
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID')
  }
  const plan = database.plan as Record<string, unknown>
  if (
    !exactKeys(plan.cardinality, [
      'answerFactCount',
      'broadMaximumRows',
      'rankedSessionCount',
      'recentSessionCount',
      'tagFactCount',
      'targetCatalogCount'
    ])
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_SCHEMA_INVALID')
  }
  const cardinality = plan.cardinality as Record<string, unknown>
  assertStatementEvidence(database.statements, 21)
  assertStatementEvidence(api.statements, 21)
  if (
    plan.queryCount !== 5 ||
    plan.cteAssertionCount !== 5 ||
    plan.repeatedSubplanCount !== 0 ||
    plan.overCardinalityNodeCount !== 0 ||
    plan.diskSortCount !== 0 ||
    !Number.isSafeInteger(plan.totalNodeCount) ||
    Number(plan.totalNodeCount) < 5 ||
    !Object.values(cardinality).every(
      (count) => Number.isSafeInteger(count) && Number(count) >= 0
    ) ||
    cardinality.answerFactCount !== fixture.answerCount ||
    Number(cardinality.broadMaximumRows) < Number(fixture.answerCount) ||
    cardinality.rankedSessionCount !== fixture.sessionCount ||
    cardinality.recentSessionCount !== 3 ||
    cardinality.tagFactCount !== fixture.tagFactCount ||
    Number(cardinality.targetCatalogCount) < 1 ||
    database.metric !== 'dashboard-insights-service' ||
    (database.budget as Record<string, unknown>).baselineP95Ms !==
      phase10DatabasePerformanceBudget.baselineP95Ms ||
    (database.budget as Record<string, unknown>).ratioLimit !==
      phase10DatabasePerformanceBudget.ratioLimit ||
    (database.budget as Record<string, unknown>).absoluteCeilingMs !==
      phase10DatabasePerformanceBudget.absoluteCeilingMs ||
    api.metric !== 'dashboard-insights-http' ||
    (api.budget as Record<string, unknown>).baselineP95Ms !==
      phase10ApiPerformanceBudget.baselineP95Ms ||
    (api.budget as Record<string, unknown>).ratioLimit !==
      phase10ApiPerformanceBudget.ratioLimit ||
    (api.budget as Record<string, unknown>).absoluteCeilingMs !==
      phase10ApiPerformanceBudget.absoluteCeilingMs ||
    api.route !== 'GET /api/v1/dashboard/insights' ||
    api.status !== 200 ||
    api.cacheControl !== 'private, no-store' ||
    api.principalResolutionCount !== 21 ||
    api.rateLimitCount !== 21 ||
    api.requestCount !== 21 ||
    api.schemaValidationCount !== 21 ||
    api.noStoreCount !== 21 ||
    api.serviceCallCount !== 21 ||
    api.statusOkCount !== 21 ||
    (database.budget as Record<string, unknown>).passed !== true ||
    (api.budget as Record<string, unknown>).passed !== true
  ) {
    throw new Error('PHASE10_PERFORMANCE_EVIDENCE_CONTRACT_INVALID')
  }
}

const canonicalize = (value: unknown): unknown => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('PHASE10_PERFORMANCE_EVIDENCE_NONFINITE')
    }
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    )
  }
  throw new Error('PHASE10_PERFORMANCE_EVIDENCE_VALUE_INVALID')
}

export const writePhase10DatabaseApiPerformanceEvidence = async ({
  evidence,
  filePath
}: {
  readonly evidence: Phase10DatabaseApiPerformanceEvidence
  readonly filePath: string
}): Promise<void> => {
  assertPhase10DatabaseApiPerformanceEvidence(evidence)
  await mkdir(path.dirname(filePath), { mode: 0o700, recursive: true })
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`
  )
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(canonicalize(evidence), null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    )
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

export const readPhase10DatabaseApiPerformanceEvidence = async (
  filePath: string
): Promise<Phase10DatabaseApiPerformanceEvidence> => {
  const evidence = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  assertPhase10DatabaseApiPerformanceEvidence(evidence)
  return evidence
}
