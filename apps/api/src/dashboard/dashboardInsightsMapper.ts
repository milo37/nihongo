import {
  dashboardInsightTagLimit,
  dashboardInsightsWindowDays,
  dashboardWeaknessFullConfidenceAttempts,
  dashboardWeaknessMinAttempts,
  getDashboardInsightsResponseSchema,
  type DashboardInsightMetric,
  type DashboardInsightTagStat,
  type DashboardRecommendation,
  type DashboardWeakness,
  type GetDashboardInsightsResponse
} from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { opaqueIdSchema } from '@nihongo/contracts/common/id'
import {
  wrongNoteQuestionPreviewSchema,
  wrongNoteTagLabelSchema
} from '@nihongo/contracts/wrong-note/list-wrong-notes'
import {
  buildDashboardRecommendations,
  compareDashboardWeaknesses,
  createLevelSubjectKey,
  selectTopDashboardWeaknesses,
  type DashboardDueRecommendationGroup,
  type DashboardInsightLevel,
  type DashboardInsightQuestionType,
  type DashboardInsightSubject,
  type DashboardRecommendation as DomainDashboardRecommendation,
  type DashboardRepeatedWrongCandidate,
  type DashboardScoredWeakness,
  type DashboardTargetPracticeCandidate,
  type DashboardWeaknessCandidate
} from '@nihongo/domain/dashboard/calculate-dashboard-insights'
import { createWrongNoteQuestionPreview } from '../wrong-note/wrongNoteMapper.js'
import type {
  DashboardInsightsNonTagRecord,
  DashboardInsightsReviewRecord,
  DashboardInsightsSnapshotRecord,
  DashboardInsightsTagRecord
} from './dashboardInsightsRepository.js'

const DAY_MILLISECONDS = 86_400_000
const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
const SUBJECTS = ['VOCABULARY', 'GRAMMAR', 'READING'] as const
const QUESTION_TYPES = [
  'KANJI_READING',
  'ORTHOGRAPHY',
  'CONTEXT_VOCABULARY',
  'PARAPHRASE',
  'WORD_USAGE',
  'GRAMMAR_SELECT',
  'SENTENCE_ORDER',
  'TEXT_GRAMMAR',
  'SHORT_READING',
  'MEDIUM_READING',
  'LONG_READING',
  'INFO_RETRIEVAL'
] as const

const LEVEL_SET = new Set<string>(LEVELS)
const SUBJECT_SET = new Set<string>(SUBJECTS)
const QUESTION_TYPE_SET = new Set<string>(QUESTION_TYPES)
const REPEATED_STATUSES = new Set<string>(['NEW', 'REVIEWING', 'AGAIN'])

export class DashboardInsightsMapperIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DashboardInsightsMapperIntegrityError'
  }
}

const fail = (message: string): never => {
  throw new DashboardInsightsMapperIntegrityError(message)
}

const requireValue = <Value>(
  value: Value | null | undefined,
  message: string
): Value => {
  if (value === null || value === undefined) fail(message)
  return value as Value
}

const assertValidDate = (value: Date, field: string): void => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    fail(`${field} must be a valid Date.`)
  }
}

const toSafeCount = (value: bigint, field: string): number => {
  const converted = Number(value)
  if (
    value < 0n ||
    !Number.isSafeInteger(converted) ||
    BigInt(converted) !== value
  ) {
    fail(`${field} must be a non-negative safe integer.`)
  }
  return converted
}

const toSafeInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${field} must be a non-negative safe integer.`)
  }
  return value
}

const toLevel = (
  value: string | null,
  field: string
): DashboardInsightLevel => {
  if (value === null || !LEVEL_SET.has(value)) {
    fail(`${field} contains an invalid JLPT level.`)
  }
  return value as DashboardInsightLevel
}

const toSubject = (
  value: string | null,
  field: string
): DashboardInsightSubject => {
  if (value === null || !SUBJECT_SET.has(value)) {
    fail(`${field} contains an invalid question subject.`)
  }
  return value as DashboardInsightSubject
}

const toQuestionType = (
  value: string | null,
  field: string
): DashboardInsightQuestionType => {
  if (value === null || !QUESTION_TYPE_SET.has(value)) {
    fail(`${field} contains an invalid question type.`)
  }
  return value as DashboardInsightQuestionType
}

const assertNull = (value: unknown, field: string): void => {
  if (value !== null) {
    fail(`${field} must be null for this aggregate kind.`)
  }
}

const toMetric = (
  record:
    | DashboardInsightsNonTagRecord
    | DashboardInsightsTagRecord
    | undefined,
  field: string
): DashboardInsightMetric => {
  if (!record) {
    return {
      attemptedCount: 0,
      correctCount: 0,
      correctRateBasisPoints: null,
      averageElapsedSec: null,
      lastAnsweredAt: null
    }
  }

  const attemptedCount = toSafeCount(
    record.attemptedCount,
    `${field}.attemptedCount`
  )
  const correctCount = toSafeCount(record.correctCount, `${field}.correctCount`)
  const incorrectCount = toSafeCount(
    record.incorrectCount,
    `${field}.incorrectCount`
  )
  const elapsedTotal = toSafeCount(record.elapsedTotal, `${field}.elapsedTotal`)
  if (correctCount + incorrectCount !== attemptedCount) {
    fail(`${field} correct and incorrect counts must sum to attemptedCount.`)
  }
  if (attemptedCount === 0) {
    if (
      correctCount !== 0 ||
      elapsedTotal !== 0 ||
      record.lastAnsweredAt !== null
    ) {
      fail(`${field} empty aggregate must have zero counts and no timestamp.`)
    }
    return {
      attemptedCount: 0,
      correctCount: 0,
      correctRateBasisPoints: null,
      averageElapsedSec: null,
      lastAnsweredAt: null
    }
  }
  const lastAnsweredAt = requireValue(
    record.lastAnsweredAt,
    `${field} non-empty aggregate must have a timestamp.`
  )
  assertValidDate(lastAnsweredAt, `${field}.lastAnsweredAt`)

  return {
    attemptedCount,
    correctCount,
    correctRateBasisPoints: Number(
      (BigInt(correctCount) * 10_000n + BigInt(attemptedCount) / 2n) /
        BigInt(attemptedCount)
    ),
    averageElapsedSec: Number(
      (BigInt(elapsedTotal) + BigInt(attemptedCount) / 2n) /
        BigInt(attemptedCount)
    ),
    lastAnsweredAt: lastAnsweredAt.toISOString()
  }
}

interface ParsedNonTagRows {
  readonly overall: DashboardInsightsNonTagRecord
  readonly byLevel: ReadonlyMap<
    DashboardInsightLevel,
    DashboardInsightsNonTagRecord
  >
  readonly bySubject: ReadonlyMap<
    DashboardInsightSubject,
    DashboardInsightsNonTagRecord
  >
  readonly byQuestionType: ReadonlyMap<
    DashboardInsightQuestionType,
    DashboardInsightsNonTagRecord
  >
  readonly weaknessCandidates: readonly DashboardWeaknessCandidate[]
}

const parseNonTagRows = (
  rows: readonly DashboardInsightsNonTagRecord[]
): ParsedNonTagRows => {
  let overall: DashboardInsightsNonTagRecord | null = null
  const byLevel = new Map<
    DashboardInsightLevel,
    DashboardInsightsNonTagRecord
  >()
  const bySubject = new Map<
    DashboardInsightSubject,
    DashboardInsightsNonTagRecord
  >()
  const byQuestionType = new Map<
    DashboardInsightQuestionType,
    DashboardInsightsNonTagRecord
  >()
  const weaknessCandidates: DashboardWeaknessCandidate[] = []
  const weaknessKeys = new Set<string>()

  for (const row of rows) {
    switch (row.kind) {
      case 'OVERALL': {
        if (overall) fail('Dashboard insights contains duplicate OVERALL rows.')
        assertNull(row.level, 'OVERALL.level')
        assertNull(row.subject, 'OVERALL.subject')
        assertNull(row.questionType, 'OVERALL.questionType')
        toMetric(row, 'overall')
        overall = row
        break
      }
      case 'LEVEL': {
        const level = toLevel(row.level, 'LEVEL.level')
        assertNull(row.subject, 'LEVEL.subject')
        assertNull(row.questionType, 'LEVEL.questionType')
        if (byLevel.has(level)) fail(`Duplicate LEVEL aggregate: ${level}.`)
        toMetric(row, `byLevel.${level}`)
        byLevel.set(level, row)
        break
      }
      case 'SUBJECT': {
        const subject = toSubject(row.subject, 'SUBJECT.subject')
        assertNull(row.level, 'SUBJECT.level')
        assertNull(row.questionType, 'SUBJECT.questionType')
        if (bySubject.has(subject)) {
          fail(`Duplicate SUBJECT aggregate: ${subject}.`)
        }
        toMetric(row, `bySubject.${subject}`)
        bySubject.set(subject, row)
        break
      }
      case 'QUESTION_TYPE': {
        const questionType = toQuestionType(
          row.questionType,
          'QUESTION_TYPE.questionType'
        )
        assertNull(row.level, 'QUESTION_TYPE.level')
        assertNull(row.subject, 'QUESTION_TYPE.subject')
        if (byQuestionType.has(questionType)) {
          fail(`Duplicate QUESTION_TYPE aggregate: ${questionType}.`)
        }
        toMetric(row, `byQuestionType.${questionType}`)
        byQuestionType.set(questionType, row)
        break
      }
      case 'SUBJECT_WEAKNESS': {
        const level = toLevel(row.level, 'SUBJECT_WEAKNESS.level')
        const subject = toSubject(row.subject, 'SUBJECT_WEAKNESS.subject')
        assertNull(row.questionType, 'SUBJECT_WEAKNESS.questionType')
        const key = `SUBJECT|${level}|${subject}`
        if (weaknessKeys.has(key)) fail(`Duplicate weakness row: ${key}.`)
        weaknessKeys.add(key)
        const metric = toMetric(row, key)
        if (metric.lastAnsweredAt === null)
          fail(`${key} must contain attempts.`)
        const lastAnsweredAt = requireValue(
          row.lastAnsweredAt,
          `${key} must contain attempts.`
        )
        weaknessCandidates.push({
          dimension: 'SUBJECT',
          key,
          level,
          subject,
          attemptedCount: metric.attemptedCount,
          incorrectCount: toSafeCount(
            row.incorrectCount,
            `${key}.incorrectCount`
          ),
          repeatExtra: toSafeCount(row.repeatExtra, `${key}.repeatExtra`),
          lastAnsweredAt
        })
        break
      }
      case 'QUESTION_TYPE_WEAKNESS': {
        const level = toLevel(row.level, 'QUESTION_TYPE_WEAKNESS.level')
        const subject = toSubject(row.subject, 'QUESTION_TYPE_WEAKNESS.subject')
        const questionType = toQuestionType(
          row.questionType,
          'QUESTION_TYPE_WEAKNESS.questionType'
        )
        const key = `QUESTION_TYPE|${level}|${subject}|${questionType}`
        if (weaknessKeys.has(key)) fail(`Duplicate weakness row: ${key}.`)
        weaknessKeys.add(key)
        const metric = toMetric(row, key)
        if (metric.lastAnsweredAt === null)
          fail(`${key} must contain attempts.`)
        const lastAnsweredAt = requireValue(
          row.lastAnsweredAt,
          `${key} must contain attempts.`
        )
        weaknessCandidates.push({
          dimension: 'QUESTION_TYPE',
          key,
          level,
          subject,
          questionType,
          attemptedCount: metric.attemptedCount,
          incorrectCount: toSafeCount(
            row.incorrectCount,
            `${key}.incorrectCount`
          ),
          repeatExtra: toSafeCount(row.repeatExtra, `${key}.repeatExtra`),
          lastAnsweredAt
        })
        break
      }
      default:
        fail('Dashboard insights contains an unknown non-tag row kind.')
    }
  }

  const requiredOverall = requireValue(
    overall,
    'Dashboard insights is missing its OVERALL row.'
  )
  return {
    overall: requiredOverall,
    byLevel,
    bySubject,
    byQuestionType,
    weaknessCandidates
  }
}

interface ParsedTagRows {
  readonly metrics: ReadonlyMap<string, DashboardInsightTagStat>
  readonly weaknessCandidates: readonly DashboardWeaknessCandidate[]
}

const parseTagRows = (
  rows: readonly DashboardInsightsTagRecord[]
): ParsedTagRows => {
  const metrics = new Map<string, DashboardInsightTagStat>()
  const weaknessCandidates: DashboardWeaknessCandidate[] = []
  const weaknessKeys = new Set<string>()

  for (const row of rows) {
    const parsedTagId = opaqueIdSchema.safeParse(row.tagId)
    const parsedTagLabel = wrongNoteTagLabelSchema.safeParse(row.tagLabel)
    if (
      !parsedTagId.success ||
      parsedTagId.data !== row.tagId ||
      !parsedTagLabel.success ||
      parsedTagLabel.data !== row.tagLabel ||
      [...row.tagLabel].length > 100
    ) {
      fail('Tag aggregates require canonical bounded tag identity and label.')
    }
    if (row.kind === 'TAG') {
      assertNull(row.level, 'TAG.level')
      assertNull(row.subject, 'TAG.subject')
      if (metrics.has(row.tagId)) fail(`Duplicate TAG aggregate: ${row.tagId}.`)
      const metric = toMetric(row, `byTag.${row.tagId}`)
      if (metric.attemptedCount === 0) {
        fail(`TAG aggregate must contain attempts: ${row.tagId}.`)
      }
      metrics.set(row.tagId, {
        tagId: row.tagId,
        tagLabel: row.tagLabel,
        ...metric
      })
      continue
    }
    if (row.kind !== 'TAG_WEAKNESS') {
      fail('Dashboard insights contains an unknown tag row kind.')
    }

    const level = toLevel(row.level, 'TAG_WEAKNESS.level')
    const subject = toSubject(row.subject, 'TAG_WEAKNESS.subject')
    const key = `TAG|${level}|${subject}|${row.tagId}`
    if (weaknessKeys.has(key)) fail(`Duplicate weakness row: ${key}.`)
    weaknessKeys.add(key)
    const metric = toMetric(row, key)
    if (metric.lastAnsweredAt === null) fail(`${key} must contain attempts.`)
    weaknessCandidates.push({
      dimension: 'TAG',
      key,
      level,
      subject,
      tagId: row.tagId,
      tagLabel: row.tagLabel,
      attemptedCount: metric.attemptedCount,
      incorrectCount: toSafeCount(row.incorrectCount, `${key}.incorrectCount`),
      repeatExtra: toSafeCount(row.repeatExtra, `${key}.repeatExtra`),
      lastAnsweredAt: row.lastAnsweredAt
    })
  }

  return { metrics, weaknessCandidates }
}

interface ParsedReviewRows {
  readonly actionableCounts: ReadonlyMap<string, number>
  readonly dueCount: number
  readonly dueGroups: readonly DashboardDueRecommendationGroup[]
  readonly repeatedCount: number
  readonly repeatedWrongCandidates: readonly DashboardRepeatedWrongCandidate[]
}

const parseReviewRows = (
  rows: readonly DashboardInsightsReviewRecord[],
  observedAt: Date
): ParsedReviewRows => {
  let counts: DashboardInsightsReviewRecord | null = null
  const dueGroups: DashboardDueRecommendationGroup[] = []
  const repeatedWrongCandidates: DashboardRepeatedWrongCandidate[] = []
  const actionableCounts = new Map<string, number>()
  const dueKeys = new Set<string>()

  for (const row of rows) {
    switch (row.kind) {
      case 'COUNTS':
        if (counts) fail('Dashboard insights contains duplicate COUNTS rows.')
        if (row.repeatedCount === null)
          fail('COUNTS.repeatedCount is required.')
        counts = row
        break
      case 'DUE_GROUP': {
        const level = toLevel(row.level, 'DUE_GROUP.level')
        const subject = toSubject(row.subject, 'DUE_GROUP.subject')
        const key = createLevelSubjectKey(level, subject)
        if (dueKeys.has(key)) fail(`Duplicate due group: ${key}.`)
        const earliestDueAt = requireValue(
          row.earliestDueAt,
          `Due group requires earliestDueAt: ${key}.`
        )
        assertValidDate(earliestDueAt, `${key}.earliestDueAt`)
        if (earliestDueAt.getTime() > observedAt.getTime()) {
          fail(`Due group is later than observedAt: ${key}.`)
        }
        const dueCount = toSafeCount(row.totalCount, `${key}.dueCount`)
        if (dueCount === 0) fail(`Due group count must be positive: ${key}.`)
        dueKeys.add(key)
        dueGroups.push({
          level,
          subject,
          dueCount,
          earliestDueAt
        })
        break
      }
      case 'REPEATED_CANDIDATE': {
        const level = toLevel(row.level, 'REPEATED_CANDIDATE.level')
        const subject = toSubject(row.subject, 'REPEATED_CANDIDATE.subject')
        if (
          row.questionId === null ||
          row.questionText === null ||
          row.wrongCount === null ||
          row.status === null ||
          row.lastWrongAt === null ||
          row.isDue !== false ||
          !REPEATED_STATUSES.has(row.status)
        ) {
          fail('Repeated candidate is missing required eligible evidence.')
        }
        const questionId = requireValue(
          row.questionId,
          'Repeated candidate requires questionId.'
        )
        const questionText = requireValue(
          row.questionText,
          'Repeated candidate requires questionText.'
        )
        const wrongCount = requireValue(
          row.wrongCount,
          'Repeated candidate requires wrongCount.'
        )
        const lastWrongAt = requireValue(
          row.lastWrongAt,
          'Repeated candidate requires lastWrongAt.'
        )
        assertValidDate(lastWrongAt, 'REPEATED_CANDIDATE.lastWrongAt')
        if (lastWrongAt.getTime() > observedAt.getTime()) {
          fail('Repeated candidate lastWrongAt is later than observedAt.')
        }
        const safeWrongCount = toSafeInteger(
          wrongCount,
          'REPEATED_CANDIDATE.wrongCount'
        )
        const parsedQuestionId = opaqueIdSchema.safeParse(questionId)
        const questionPreview = createWrongNoteQuestionPreview(questionText)
        const parsedQuestionPreview =
          wrongNoteQuestionPreviewSchema.safeParse(questionPreview)
        if (
          row.totalCount !== 1n ||
          safeWrongCount < 2 ||
          !parsedQuestionId.success ||
          parsedQuestionId.data !== questionId ||
          !parsedQuestionPreview.success ||
          parsedQuestionPreview.data !== questionPreview
        ) {
          fail('Repeated candidate identity and evidence must be canonical.')
        }
        repeatedWrongCandidates.push({
          level,
          subject,
          questionId,
          questionPreview,
          wrongCount: safeWrongCount,
          status: row.status as 'NEW' | 'REVIEWING' | 'AGAIN',
          lastWrongAt,
          isDue: false
        })
        break
      }
      case 'WEAKNESS_ACTIONABLE': {
        const level = toLevel(row.level, 'WEAKNESS_ACTIONABLE.level')
        const subject = toSubject(row.subject, 'WEAKNESS_ACTIONABLE.subject')
        const key = createLevelSubjectKey(level, subject)
        if (actionableCounts.has(key)) {
          fail(`Duplicate weakness actionability aggregate: ${key}.`)
        }
        const count = toSafeCount(row.totalCount, `${key}.actionableCount`)
        if (count === 0) fail(`Actionability count must be positive: ${key}.`)
        actionableCounts.set(key, count)
        break
      }
      default:
        fail('Dashboard insights contains an unknown review row kind.')
    }
  }

  const countRow = requireValue(
    counts,
    'Dashboard insights is missing its COUNTS row.'
  )
  const repeatedCountValue = requireValue(
    countRow.repeatedCount,
    'COUNTS.repeatedCount is required.'
  )
  const dueCount = toSafeCount(countRow.totalCount, 'reviewQueueCounts.due')
  const repeatedCount = toSafeCount(
    repeatedCountValue,
    'reviewQueueCounts.repeated'
  )
  const groupedDueCount = dueGroups.reduce(
    (total, group) => total + group.dueCount,
    0
  )
  if (groupedDueCount !== dueCount) {
    fail('Due group counts must sum to the total due count.')
  }
  if (repeatedWrongCandidates.length > 1) {
    fail('Dashboard insights must return at most one repeated candidate.')
  }
  if (repeatedWrongCandidates.length > repeatedCount) {
    fail('Repeated candidate exceeds the repeated queue count.')
  }
  return {
    actionableCounts,
    dueCount,
    dueGroups,
    repeatedCount,
    repeatedWrongCandidates
  }
}

const parseTargetRows = (
  snapshot: DashboardInsightsSnapshotRecord,
  targetLevel: DashboardInsightLevel | null
): DashboardTargetPracticeCandidate[] => {
  const candidates: DashboardTargetPracticeCandidate[] = []
  const keys = new Set<string>()
  for (const row of snapshot.targetRows) {
    const level = toLevel(row.level, 'target.level')
    const subject = toSubject(row.subject, 'target.subject')
    const key = createLevelSubjectKey(level, subject)
    if (keys.has(key)) fail(`Duplicate target aggregate: ${key}.`)
    if (targetLevel === null || level !== targetLevel) {
      fail(`Target aggregate does not match the user target level: ${key}.`)
    }
    if (row.lastStudiedAt !== null) {
      assertValidDate(row.lastStudiedAt, `${key}.lastStudiedAt`)
      if (row.lastStudiedAt.getTime() > snapshot.clock.observedAt.getTime()) {
        fail(`Target aggregate is later than observedAt: ${key}.`)
      }
    }
    keys.add(key)
    const catalogCount = toSafeCount(row.catalogCount, `${key}.catalogCount`)
    if (catalogCount === 0) {
      fail(`Target catalog count must be positive: ${key}.`)
    }
    candidates.push({
      level,
      subject,
      catalogCount,
      nonRecentCount: toSafeCount(row.nonRecentCount, `${key}.nonRecentCount`),
      lastStudiedAt: row.lastStudiedAt
    })
  }
  return candidates
}

const toWireWeakness = (
  weakness: DashboardScoredWeakness
): DashboardWeakness => {
  const common = {
    key: weakness.key,
    level: weakness.level,
    subject: weakness.subject,
    attemptedCount: weakness.attemptedCount,
    incorrectCount: weakness.incorrectCount,
    repeatExtra: weakness.repeatExtra,
    lastAnsweredAt: weakness.lastAnsweredAt.toISOString(),
    ageDays: weakness.ageDays,
    errorRateBasisPoints: weakness.errorRateBasisPoints,
    recencyWeightBasisPoints: weakness.recencyWeightBasisPoints,
    repeatWeightBasisPoints: weakness.repeatWeightBasisPoints,
    sampleConfidenceBasisPoints: weakness.sampleConfidenceBasisPoints,
    scoreBasisPoints: weakness.scoreBasisPoints
  }
  switch (weakness.dimension) {
    case 'SUBJECT':
      return { dimension: 'SUBJECT', ...common }
    case 'QUESTION_TYPE':
      return {
        dimension: 'QUESTION_TYPE',
        questionType: weakness.questionType,
        ...common
      }
    case 'TAG':
      return {
        dimension: 'TAG',
        tagId: weakness.tagId,
        tagLabel: weakness.tagLabel,
        ...common
      }
  }
}

const toWireRecommendation = (
  recommendation: DomainDashboardRecommendation
): DashboardRecommendation => {
  switch (recommendation.kind) {
    case 'DUE_REVIEW':
      return {
        ...recommendation,
        reason: {
          ...recommendation.reason,
          earliestDueAt: recommendation.reason.earliestDueAt.toISOString()
        }
      }
    case 'REPEATED_WRONG':
      return {
        ...recommendation,
        reason: {
          ...recommendation.reason,
          lastWrongAt: recommendation.reason.lastWrongAt.toISOString()
        }
      }
    case 'TARGET_LEVEL_PRACTICE':
      return {
        ...recommendation,
        reason: {
          ...recommendation.reason,
          lastStudiedAt:
            recommendation.reason.lastStudiedAt?.toISOString() ?? null
        }
      }
    case 'RECENT_LOW_ACCURACY_TYPE':
    case 'STALE_WEAK_SUBJECT':
    case 'PRACTICE_SETUP':
      return recommendation
  }
}

const selectResponseWeaknesses = (
  globalTop: readonly DashboardScoredWeakness[],
  nonTagWeaknesses: readonly DashboardScoredWeakness[],
  recommendations: readonly DomainDashboardRecommendation[]
): DashboardScoredWeakness[] => {
  const selected = new Map<string, DashboardScoredWeakness>()
  for (const recommendation of recommendations) {
    const key =
      recommendation.kind === 'RECENT_LOW_ACCURACY_TYPE'
        ? `QUESTION_TYPE|${recommendation.action.level}|${recommendation.action.subject}|${recommendation.reason.questionType}`
        : recommendation.kind === 'STALE_WEAK_SUBJECT'
          ? `SUBJECT|${recommendation.action.level}|${recommendation.action.subject}`
          : null
    if (key === null) continue
    const evidence = requireValue(
      nonTagWeaknesses.find((item) => item.key === key),
      `Recommendation evidence is missing: ${key}.`
    )
    selected.set(key, evidence)
  }
  for (const weakness of globalTop) {
    if (selected.size === 10) break
    selected.set(weakness.key, weakness)
  }
  return [...selected.values()].toSorted(compareDashboardWeaknesses)
}

const selectTagPage = (
  metrics: ReadonlyMap<string, DashboardInsightTagStat>,
  weaknesses: readonly DashboardScoredWeakness[]
): DashboardInsightTagStat[] => {
  const selected = new Map<string, DashboardInsightTagStat>()
  for (const weakness of weaknesses) {
    if (weakness.dimension !== 'TAG') continue
    const metric = requireValue(
      metrics.get(weakness.tagId),
      `TAG weakness is missing its aggregate metric: ${weakness.tagId}.`
    )
    selected.set(weakness.tagId, metric)
  }
  const rankedMetrics = [...metrics.values()].toSorted((left, right) => {
    if (left.attemptedCount !== right.attemptedCount) {
      return right.attemptedCount - left.attemptedCount
    }
    const timeOrder =
      new Date(right.lastAnsweredAt!).getTime() -
      new Date(left.lastAnsweredAt!).getTime()
    if (timeOrder !== 0) return timeOrder
    return left.tagId === right.tagId ? 0 : left.tagId < right.tagId ? -1 : 1
  })
  for (const metric of rankedMetrics) {
    if (selected.size === dashboardInsightTagLimit) break
    selected.set(metric.tagId, metric)
  }
  return [...selected.values()].toSorted((left, right) =>
    left.tagId === right.tagId ? 0 : left.tagId < right.tagId ? -1 : 1
  )
}

export const toDashboardInsights = (
  snapshot: DashboardInsightsSnapshotRecord
): GetDashboardInsightsResponse => {
  try {
    const { clock } = snapshot
    assertValidDate(clock.observedAt, 'observedAt')
    if (clock.futureAnswerCount !== 0n) {
      fail('Dashboard insights snapshot contains future answers.')
    }
    const targetLevel =
      clock.targetLevel === null
        ? null
        : toLevel(clock.targetLevel, 'targetLevel')
    const nonTag = parseNonTagRows(snapshot.nonTagRows)
    const tags = parseTagRows(snapshot.tagRows)
    const overallMetric = toMetric(nonTag.overall, 'overall')
    const fromTime =
      clock.observedAt.getTime() -
      dashboardInsightsWindowDays * DAY_MILLISECONDS
    for (const metric of tags.metrics.values()) {
      const lastAnsweredAt = requireValue(
        metric.lastAnsweredAt,
        `TAG metric requires lastAnsweredAt: ${metric.tagId}.`
      )
      const lastTime = new Date(lastAnsweredAt).getTime()
      if (
        metric.attemptedCount > overallMetric.attemptedCount ||
        metric.correctCount > overallMetric.correctCount ||
        lastTime < fromTime ||
        lastTime > clock.observedAt.getTime()
      ) {
        fail(`TAG metric is outside the snapshot envelope: ${metric.tagId}.`)
      }
    }
    for (const candidate of tags.weaknessCandidates) {
      if (candidate.dimension === 'TAG' && !tags.metrics.has(candidate.tagId)) {
        fail(
          `TAG weakness is missing its aggregate metric: ${candidate.tagId}.`
        )
      }
    }
    const review = parseReviewRows(snapshot.reviewRows, clock.observedAt)
    const targetPracticeCandidates = parseTargetRows(snapshot, targetLevel)

    const nonTagWeaknesses = selectTopDashboardWeaknesses(
      nonTag.weaknessCandidates,
      clock.observedAt,
      100
    )
    const tagWeaknesses = selectTopDashboardWeaknesses(
      tags.weaknessCandidates,
      clock.observedAt,
      10
    )
    const globalTop = [...nonTagWeaknesses, ...tagWeaknesses]
      .toSorted(compareDashboardWeaknesses)
      .slice(0, 10)
    const recommendationResult = buildDashboardRecommendations({
      actionableWeaknessCandidateCountByLevelSubject: review.actionableCounts,
      dueGroups: review.dueGroups,
      repeatedWrongCandidates: review.repeatedWrongCandidates,
      targetLevel,
      targetPracticeCandidates,
      weaknesses: nonTagWeaknesses
    })
    const responseWeaknesses = selectResponseWeaknesses(
      globalTop,
      nonTagWeaknesses,
      recommendationResult.recommendations
    )
    const byTag = selectTagPage(tags.metrics, responseWeaknesses)
    const observedAt = clock.observedAt.toISOString()
    const fromInclusive = new Date(
      clock.observedAt.getTime() -
        dashboardInsightsWindowDays * DAY_MILLISECONDS
    ).toISOString()

    return getDashboardInsightsResponseSchema.parse({
      algorithm: {
        weakness: 'weakness-v1',
        recommendation: 'recommendation-v1'
      },
      observedAt,
      window: {
        fromInclusive,
        toInclusive: observedAt,
        durationDays: dashboardInsightsWindowDays,
        minAttempts: dashboardWeaknessMinAttempts,
        fullConfidenceAt: dashboardWeaknessFullConfidenceAttempts
      },
      stats: {
        overall: overallMetric,
        byLevel: LEVELS.map((level) => ({
          level,
          ...toMetric(nonTag.byLevel.get(level), `byLevel.${level}`)
        })),
        bySubject: SUBJECTS.map((subject) => ({
          subject,
          ...toMetric(nonTag.bySubject.get(subject), `bySubject.${subject}`)
        })),
        byQuestionType: QUESTION_TYPES.map((questionType) => ({
          questionType,
          ...toMetric(
            nonTag.byQuestionType.get(questionType),
            `byQuestionType.${questionType}`
          )
        })),
        byTag,
        byTagTotal: tags.metrics.size,
        byTagTruncated: tags.metrics.size > dashboardInsightTagLimit
      },
      reviewQueueCounts: {
        due: review.dueCount,
        repeated: review.repeatedCount
      },
      weaknesses: responseWeaknesses.map(toWireWeakness),
      recommendations:
        recommendationResult.recommendations.map(toWireRecommendation),
      personalizationFallbackReason:
        recommendationResult.personalizationFallbackReason
    })
  } catch (error: unknown) {
    if (error instanceof DashboardInsightsMapperIntegrityError) throw error
    throw new DashboardInsightsMapperIntegrityError(
      'Dashboard insights snapshot failed integrity validation.',
      { cause: error }
    )
  }
}
