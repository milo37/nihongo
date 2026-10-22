import {
  dashboardInsightTagLimit,
  dashboardInsightsWindowDays,
  dashboardWeaknessFullConfidenceAttempts,
  dashboardWeaknessMinAttempts,
  getDashboardInsightsResponseSchema
} from '@nihongo/contracts/dashboard/get-dashboard-insights'
import type {
  DashboardInsightMetric,
  DashboardInsightTagStat,
  DashboardRecommendation,
  DashboardWeakness,
  GetDashboardInsightsResponse
} from '@nihongo/contracts/dashboard/get-dashboard-insights'
import {
  LEVELS,
  QUESTION_TYPES,
  SUBJECTS,
  type JlptLevel,
  type QuestionSubject,
  type QuestionType
} from '@common/types/domain'
import type {
  MockCanonicalDashboardInsightAnswerRecord,
  MockCanonicalDashboardInsightsRecord
} from '@mocks/repository/mockDatabase'

const DAY_MILLISECONDS = 86_400_000
const BASIS_POINTS = 10_000n
const SCORE_DENOMINATOR = 1_000_000_000_000n

export class MockDashboardInsightsIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MockDashboardInsightsIntegrityError'
  }
}

const fail = (message: string): never => {
  throw new MockDashboardInsightsIntegrityError(message)
}

const requireMapValue = <Key, Value>(
  values: ReadonlyMap<Key, Value>,
  key: Key,
  message: string
): Value => {
  const value = values.get(key)
  return value === undefined ? fail(message) : value
}

const parseTime = (value: string, field: string): number => {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) fail(`${field} 시각이 올바르지 않습니다.`)
  return time
}

const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1

const divideRoundHalfUp = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator / 2n) / denominator

const toSetupCount = (count: number): 5 | 10 | 20 =>
  count >= 20 ? 20 : count >= 10 ? 10 : 5

interface MetricAccumulator {
  attemptedCount: number
  correctCount: number
  elapsedTotal: number
  lastAnsweredAt: string | null
}

interface TagAccumulator extends MetricAccumulator {
  labelAnswerId: string
  labelAnsweredAt: string
  labelQuestionVersionId: string
  tagId: string
  tagLabel: string
}

type WeaknessIdentity =
  | {
      readonly dimension: 'SUBJECT'
      readonly key: string
      readonly level: JlptLevel
      readonly subject: QuestionSubject
    }
  | {
      readonly dimension: 'QUESTION_TYPE'
      readonly key: string
      readonly level: JlptLevel
      readonly questionType: QuestionType
      readonly subject: QuestionSubject
    }
  | {
      readonly dimension: 'TAG'
      readonly key: string
      readonly level: JlptLevel
      readonly subject: QuestionSubject
      readonly tagId: string
      readonly tagLabel: string
    }

type WeaknessBucket = WeaknessIdentity & {
  attemptedCount: number
  incorrectCount: number
  labelAnswerId?: string
  labelAnsweredAt?: string
  labelQuestionVersionId?: string
  lastAnsweredAt: string
  wrongCountByQuestionId: Map<string, number>
}

const createMetricAccumulator = (): MetricAccumulator => ({
  attemptedCount: 0,
  correctCount: 0,
  elapsedTotal: 0,
  lastAnsweredAt: null
})

const addMetric = (
  accumulator: MetricAccumulator,
  answer: MockCanonicalDashboardInsightAnswerRecord
): void => {
  accumulator.attemptedCount += 1
  accumulator.correctCount += answer.isCorrect ? 1 : 0
  accumulator.elapsedTotal += answer.elapsedSec
  if (
    accumulator.lastAnsweredAt === null ||
    answer.answeredAt > accumulator.lastAnsweredAt
  ) {
    accumulator.lastAnsweredAt = answer.answeredAt
  }
}

const toMetric = (accumulator: MetricAccumulator): DashboardInsightMetric => {
  if (accumulator.attemptedCount === 0) {
    return {
      attemptedCount: 0,
      correctCount: 0,
      correctRateBasisPoints: null,
      averageElapsedSec: null,
      lastAnsweredAt: null
    }
  }
  return {
    attemptedCount: accumulator.attemptedCount,
    correctCount: accumulator.correctCount,
    correctRateBasisPoints: Number(
      divideRoundHalfUp(
        BigInt(accumulator.correctCount) * BASIS_POINTS,
        BigInt(accumulator.attemptedCount)
      )
    ),
    averageElapsedSec: Number(
      divideRoundHalfUp(
        BigInt(accumulator.elapsedTotal),
        BigInt(accumulator.attemptedCount)
      )
    ),
    lastAnsweredAt: accumulator.lastAnsweredAt
  }
}

const updateWeaknessBucket = (
  buckets: Map<string, WeaknessBucket>,
  identity: WeaknessIdentity,
  answer: MockCanonicalDashboardInsightAnswerRecord
): void => {
  let bucket = buckets.get(identity.key) ?? {
    ...identity,
    attemptedCount: 0,
    incorrectCount: 0,
    ...(identity.dimension === 'TAG'
      ? {
          labelAnswerId: answer.answerId,
          labelAnsweredAt: answer.answeredAt,
          labelQuestionVersionId: answer.questionVersionId
        }
      : {}),
    lastAnsweredAt: answer.answeredAt,
    wrongCountByQuestionId: new Map<string, number>()
  }
  bucket.attemptedCount += 1
  if (!answer.isCorrect) {
    bucket.incorrectCount += 1
    bucket.wrongCountByQuestionId.set(
      answer.questionId,
      (bucket.wrongCountByQuestionId.get(answer.questionId) ?? 0) + 1
    )
  }
  if (answer.answeredAt > bucket.lastAnsweredAt) {
    bucket.lastAnsweredAt = answer.answeredAt
  }
  if (bucket.dimension === 'TAG' && identity.dimension === 'TAG') {
    const shouldReplaceLabel =
      bucket.labelAnsweredAt === undefined ||
      bucket.labelQuestionVersionId === undefined ||
      bucket.labelAnswerId === undefined ||
      answer.answeredAt > bucket.labelAnsweredAt ||
      (answer.answeredAt === bucket.labelAnsweredAt &&
        (answer.questionVersionId < bucket.labelQuestionVersionId ||
          (answer.questionVersionId === bucket.labelQuestionVersionId &&
            answer.answerId < bucket.labelAnswerId)))
    if (shouldReplaceLabel) {
      bucket = {
        ...bucket,
        tagLabel: identity.tagLabel,
        labelAnswerId: answer.answerId,
        labelAnsweredAt: answer.answeredAt,
        labelQuestionVersionId: answer.questionVersionId
      }
    }
  }
  buckets.set(identity.key, bucket)
}

const toRecencyWeight = (
  ageDays: number
): DashboardWeakness['recencyWeightBasisPoints'] =>
  ageDays <= 6 ? 10_000 : ageDays <= 29 ? 8_500 : ageDays <= 59 ? 7_000 : 5_500

const scoreWeaknessBucket = (
  bucket: WeaknessBucket,
  observedAtMs: number
): DashboardWeakness | null => {
  if (
    bucket.attemptedCount < dashboardWeaknessMinAttempts ||
    bucket.incorrectCount === 0
  ) {
    return null
  }
  const repeatExtra = [...bucket.wrongCountByQuestionId.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0
  )
  const ageMilliseconds =
    observedAtMs - parseTime(bucket.lastAnsweredAt, 'weakness.lastAnsweredAt')
  if (
    ageMilliseconds < 0 ||
    ageMilliseconds > dashboardInsightsWindowDays * DAY_MILLISECONDS
  ) {
    return fail('weakness 시각이 분석 window 밖입니다.')
  }
  const ageDays = Math.floor(ageMilliseconds / DAY_MILLISECONDS)
  const errorRateBasisPoints = Number(
    divideRoundHalfUp(
      BigInt(bucket.incorrectCount) * BASIS_POINTS,
      BigInt(bucket.attemptedCount)
    )
  )
  const repeatWeightBasisPoints = Number(
    BASIS_POINTS +
      divideRoundHalfUp(
        BigInt(repeatExtra) * 5_000n,
        BigInt(bucket.incorrectCount)
      )
  )
  const sampleConfidenceBasisPoints =
    bucket.attemptedCount >= dashboardWeaknessFullConfidenceAttempts
      ? 10_000
      : bucket.attemptedCount * 500
  const recencyWeightBasisPoints = toRecencyWeight(ageDays)
  const scoreBasisPoints = Number(
    divideRoundHalfUp(
      BigInt(errorRateBasisPoints) *
        BigInt(recencyWeightBasisPoints) *
        BigInt(repeatWeightBasisPoints) *
        BigInt(sampleConfidenceBasisPoints),
      SCORE_DENOMINATOR
    )
  )
  const evidence = {
    key: bucket.key,
    level: bucket.level,
    subject: bucket.subject,
    attemptedCount: bucket.attemptedCount,
    incorrectCount: bucket.incorrectCount,
    repeatExtra,
    lastAnsweredAt: bucket.lastAnsweredAt,
    ageDays,
    errorRateBasisPoints,
    recencyWeightBasisPoints,
    repeatWeightBasisPoints,
    sampleConfidenceBasisPoints,
    scoreBasisPoints
  }

  switch (bucket.dimension) {
    case 'SUBJECT':
      return { dimension: 'SUBJECT', ...evidence }
    case 'QUESTION_TYPE':
      return {
        dimension: 'QUESTION_TYPE',
        questionType: bucket.questionType,
        ...evidence
      }
    case 'TAG':
      return {
        dimension: 'TAG',
        tagId: bucket.tagId,
        tagLabel: bucket.tagLabel,
        ...evidence
      }
  }
}

const compareWeaknesses = (
  left: DashboardWeakness,
  right: DashboardWeakness
): number => {
  if (left.scoreBasisPoints !== right.scoreBasisPoints) {
    return right.scoreBasisPoints - left.scoreBasisPoints
  }
  const leftRatio = BigInt(left.incorrectCount) * BigInt(right.attemptedCount)
  const rightRatio = BigInt(right.incorrectCount) * BigInt(left.attemptedCount)
  if (leftRatio !== rightRatio) return leftRatio > rightRatio ? -1 : 1
  if (left.repeatExtra !== right.repeatExtra) {
    return right.repeatExtra - left.repeatExtra
  }
  if (left.attemptedCount !== right.attemptedCount) {
    return right.attemptedCount - left.attemptedCount
  }
  if (left.lastAnsweredAt !== right.lastAnsweredAt) {
    return left.lastAnsweredAt > right.lastAnsweredAt ? -1 : 1
  }
  const dimensionOrder =
    ['SUBJECT', 'QUESTION_TYPE', 'TAG'].indexOf(left.dimension) -
    ['SUBJECT', 'QUESTION_TYPE', 'TAG'].indexOf(right.dimension)
  if (dimensionOrder !== 0) return dimensionOrder
  const levelOrder = LEVELS.indexOf(left.level) - LEVELS.indexOf(right.level)
  if (levelOrder !== 0) return levelOrder
  const subjectOrder =
    SUBJECTS.indexOf(left.subject) - SUBJECTS.indexOf(right.subject)
  if (subjectOrder !== 0) return subjectOrder
  if (
    left.dimension === 'QUESTION_TYPE' &&
    right.dimension === 'QUESTION_TYPE'
  ) {
    const questionTypeOrder =
      QUESTION_TYPES.indexOf(left.questionType) -
      QUESTION_TYPES.indexOf(right.questionType)
    if (questionTypeOrder !== 0) return questionTypeOrder
  }
  return compareText(left.key, right.key)
}

const selectTopWeaknesses = (
  buckets: Iterable<WeaknessBucket>,
  observedAtMs: number,
  limit: number
): DashboardWeakness[] => {
  const selected: DashboardWeakness[] = []
  for (const bucket of buckets) {
    const weakness = scoreWeaknessBucket(bucket, observedAtMs)
    if (!weakness) continue
    let insertAt = selected.findIndex(
      (current) => compareWeaknesses(weakness, current) < 0
    )
    if (insertAt === -1) insertAt = selected.length
    if (insertAt < limit) {
      selected.splice(insertAt, 0, weakness)
      if (selected.length > limit) selected.pop()
    }
  }
  return selected
}

const selectResponseWeaknesses = (
  globalTop: readonly DashboardWeakness[],
  nonTagWeaknesses: readonly DashboardWeakness[],
  recommendations: readonly DashboardRecommendation[]
): DashboardWeakness[] => {
  const selected = new Map<string, DashboardWeakness>()
  for (const recommendation of recommendations) {
    const key =
      recommendation.kind === 'RECENT_LOW_ACCURACY_TYPE'
        ? `QUESTION_TYPE|${recommendation.action.level}|${recommendation.action.subject}|${recommendation.reason.questionType}`
        : recommendation.kind === 'STALE_WEAK_SUBJECT'
          ? `SUBJECT|${recommendation.action.level}|${recommendation.action.subject}`
          : null
    if (key === null) continue
    const evidence = nonTagWeaknesses.find((weakness) => weakness.key === key)
    if (!evidence) return fail(`추천 약점 근거가 없습니다: ${key}`)
    selected.set(key, evidence)
  }
  for (const weakness of globalTop) {
    if (selected.size === 10) break
    selected.set(weakness.key, weakness)
  }
  return [...selected.values()].toSorted(compareWeaknesses)
}

const toQuestionPreview = (value: string): string => {
  const characters = [...value]
  return characters.length <= 160
    ? value
    : `${characters.slice(0, 157).join('')}...`
}

const createRecommendations = (
  record: MockCanonicalDashboardInsightsRecord,
  weaknesses: readonly DashboardWeakness[],
  observedAtMs: number
): {
  personalizationFallbackReason: GetDashboardInsightsResponse['personalizationFallbackReason']
  recommendations: DashboardRecommendation[]
} => {
  const recommendations: DashboardRecommendation[] = []
  const actionKeys = new Set<string>()
  const catalogByQuestionId = new Map(
    record.currentCatalog.map((question) => [question.questionId, question])
  )
  const availableNotes = record.wrongNotes.filter(
    (note) => note.isAvailable && catalogByQuestionId.has(note.questionId)
  )
  const dueNotes = availableNotes.filter(
    (note) => parseTime(note.nextReviewAt, 'nextReviewAt') <= observedAtMs
  )
  const dueGroupByKey = new Map<
    string,
    {
      dueCount: number
      earliestDueAt: string
      level: JlptLevel
      subject: QuestionSubject
    }
  >()
  for (const note of dueNotes) {
    const key = `${note.level}|${note.subject}`
    const group = dueGroupByKey.get(key) ?? {
      dueCount: 0,
      earliestDueAt: note.nextReviewAt,
      level: note.level,
      subject: note.subject
    }
    group.dueCount += 1
    if (note.nextReviewAt < group.earliestDueAt) {
      group.earliestDueAt = note.nextReviewAt
    }
    dueGroupByKey.set(key, group)
  }
  const due = [...dueGroupByKey.values()].toSorted((left, right) => {
    const timeOrder = left.earliestDueAt.localeCompare(right.earliestDueAt)
    if (timeOrder !== 0) return timeOrder
    if (left.dueCount !== right.dueCount) return right.dueCount - left.dueCount
    const targetOrder =
      Number(right.level === record.targetLevel) -
      Number(left.level === record.targetLevel)
    if (targetOrder !== 0) return targetOrder
    const levelOrder = LEVELS.indexOf(left.level) - LEVELS.indexOf(right.level)
    return levelOrder !== 0
      ? levelOrder
      : SUBJECTS.indexOf(left.subject) - SUBJECTS.indexOf(right.subject)
  })[0]
  if (due) {
    const action = {
      kind: 'START_SESSION' as const,
      mode: 'DAILY_REVIEW' as const,
      level: due.level,
      subject: due.subject,
      count: toSetupCount(due.dueCount)
    }
    actionKeys.add(
      `SESSION|${action.mode}|${action.level}|${action.subject}|${action.count}`
    )
    recommendations.push({
      rank: recommendations.length + 1,
      kind: 'DUE_REVIEW',
      reason: {
        code: 'DUE_REVIEW_COUNT',
        dueCount: due.dueCount,
        earliestDueAt: due.earliestDueAt,
        level: due.level,
        subject: due.subject
      },
      action
    })
  }

  const repeated = availableNotes
    .filter(
      (note) =>
        note.wrongCount >= 2 &&
        note.status !== 'SOLVED' &&
        parseTime(note.nextReviewAt, 'nextReviewAt') > observedAtMs
    )
    .toSorted(
      (left, right) =>
        right.wrongCount - left.wrongCount ||
        right.lastWrongAt.localeCompare(left.lastWrongAt) ||
        left.questionId.localeCompare(right.questionId)
    )[0]
  if (repeated) {
    const actionKey = `TARGETED|${repeated.questionId}`
    if (!actionKeys.has(actionKey)) {
      actionKeys.add(actionKey)
      recommendations.push({
        rank: recommendations.length + 1,
        kind: 'REPEATED_WRONG',
        reason: {
          code: 'REPEATED_WRONG_COUNT',
          level: repeated.level,
          subject: repeated.subject,
          questionId: repeated.questionId,
          questionPreview: toQuestionPreview(repeated.questionText),
          wrongCount: repeated.wrongCount,
          lastWrongAt: repeated.lastWrongAt
        },
        action: {
          kind: 'START_TARGETED_REVIEW',
          questionId: repeated.questionId
        }
      })
    }
  }

  const answerBySessionQuestion = new Map(
    record.answers.map((answer) => [
      `${answer.sessionId}|${answer.questionId}`,
      answer
    ])
  )
  const sessionsByLevelSubject = new Map<
    string,
    Array<(typeof record.sessions)[number]>
  >()
  for (const session of record.sessions) {
    const key = `${session.level}|${session.subject}`
    const sessions = sessionsByLevelSubject.get(key) ?? []
    sessions.push(session)
    sessionsByLevelSubject.set(key, sessions)
  }
  const actionableCounts = new Map<string, number>()
  for (const [key, sessions] of sessionsByLevelSubject) {
    const questionCounts = new Map<
      string,
      { attemptedCount: number; incorrectCount: number }
    >()
    for (const session of sessions
      .toSorted(
        (left, right) =>
          right.submittedAt.localeCompare(left.submittedAt) ||
          left.id.localeCompare(right.id)
      )
      .slice(0, 10)) {
      for (const questionId of session.questionIds) {
        const answer = answerBySessionQuestion.get(
          `${session.id}|${questionId}`
        )
        if (!answer) return fail('session answer evidence가 완전하지 않습니다.')
        const currentQuestion = catalogByQuestionId.get(questionId)
        if (
          !currentQuestion ||
          currentQuestion.level !== session.level ||
          currentQuestion.subject !== session.subject
        ) {
          continue
        }
        const counts = questionCounts.get(questionId) ?? {
          attemptedCount: 0,
          incorrectCount: 0
        }
        counts.attemptedCount += 1
        counts.incorrectCount += answer.isCorrect ? 0 : 1
        questionCounts.set(questionId, counts)
      }
    }
    actionableCounts.set(
      key,
      [...questionCounts.values()].filter(
        (counts) => counts.attemptedCount >= 3 && counts.incorrectCount >= 1
      ).length
    )
  }

  const isLowAccuracy = (weakness: DashboardWeakness): boolean =>
    BigInt(weakness.incorrectCount) * 10_000n >=
    BigInt(weakness.attemptedCount) * 4_000n
  const recentType = weaknesses.find(
    (weakness) =>
      weakness.dimension === 'QUESTION_TYPE' &&
      weakness.ageDays <= 29 &&
      isLowAccuracy(weakness) &&
      (actionableCounts.get(`${weakness.level}|${weakness.subject}`) ?? 0) > 0
  )
  if (recentType?.dimension === 'QUESTION_TYPE') {
    const actionableCandidateCount =
      actionableCounts.get(`${recentType.level}|${recentType.subject}`) ?? 0
    const action = {
      kind: 'START_SESSION' as const,
      mode: 'WEAKNESS' as const,
      level: recentType.level,
      subject: recentType.subject,
      count: toSetupCount(actionableCandidateCount)
    }
    const actionKey = `SESSION|${action.mode}|${action.level}|${action.subject}|${action.count}`
    if (!actionKeys.has(actionKey)) {
      actionKeys.add(actionKey)
      recommendations.push({
        rank: recommendations.length + 1,
        kind: 'RECENT_LOW_ACCURACY_TYPE',
        reason: {
          code: 'RECENT_LOW_ACCURACY_TYPE',
          questionType: recentType.questionType,
          attemptedCount: recentType.attemptedCount,
          incorrectCount: recentType.incorrectCount,
          errorRateBasisPoints: recentType.errorRateBasisPoints,
          scoreBasisPoints: recentType.scoreBasisPoints,
          actionableCandidateCount
        },
        action
      })
    }
  }

  const staleSubject = weaknesses.find(
    (weakness) =>
      weakness.dimension === 'SUBJECT' &&
      weakness.ageDays >= 30 &&
      isLowAccuracy(weakness) &&
      (actionableCounts.get(`${weakness.level}|${weakness.subject}`) ?? 0) >
        0 &&
      (recentType === undefined ||
        recentType.level !== weakness.level ||
        recentType.subject !== weakness.subject)
  )
  if (staleSubject?.dimension === 'SUBJECT') {
    const actionableCandidateCount =
      actionableCounts.get(`${staleSubject.level}|${staleSubject.subject}`) ?? 0
    const action = {
      kind: 'START_SESSION' as const,
      mode: 'WEAKNESS' as const,
      level: staleSubject.level,
      subject: staleSubject.subject,
      count: toSetupCount(actionableCandidateCount)
    }
    const actionKey = `SESSION|${action.mode}|${action.level}|${action.subject}|${action.count}`
    if (!actionKeys.has(actionKey)) {
      actionKeys.add(actionKey)
      recommendations.push({
        rank: recommendations.length + 1,
        kind: 'STALE_WEAK_SUBJECT',
        reason: {
          code: 'STALE_WEAK_SUBJECT',
          attemptedCount: staleSubject.attemptedCount,
          incorrectCount: staleSubject.incorrectCount,
          errorRateBasisPoints: staleSubject.errorRateBasisPoints,
          scoreBasisPoints: staleSubject.scoreBasisPoints,
          ageDays: staleSubject.ageDays,
          actionableCandidateCount
        },
        action
      })
    }
  }

  const personalizedCount = recommendations.length
  let target:
    | {
        catalogCount: number
        lastStudiedAt: string | null
        level: JlptLevel
        nonRecentCount: number
        subject: QuestionSubject
      }
    | undefined
  const targetLevel = record.targetLevel
  if (targetLevel) {
    const recentSinceMs = observedAtMs - 7 * DAY_MILLISECONDS
    const recentQuestionIds = new Set(
      record.sessions
        .filter((session) => {
          const submittedAtMs = parseTime(session.submittedAt, 'submittedAt')
          return submittedAtMs >= recentSinceMs && submittedAtMs <= observedAtMs
        })
        .toSorted(
          (left, right) =>
            right.submittedAt.localeCompare(left.submittedAt) ||
            left.id.localeCompare(right.id)
        )
        .slice(0, 3)
        .flatMap((session) => session.questionIds)
    )
    const targetCandidates = SUBJECTS.flatMap((subject) => {
      const questions = record.currentCatalog.filter(
        (question) =>
          question.level === targetLevel && question.subject === subject
      )
      if (questions.length === 0) return []
      let lastStudiedAt: string | null = null
      for (const session of record.sessions) {
        const submittedAtMs = parseTime(session.submittedAt, 'submittedAt')
        if (
          submittedAtMs <= observedAtMs &&
          session.level === targetLevel &&
          session.subject === subject &&
          (lastStudiedAt === null || session.submittedAt > lastStudiedAt)
        ) {
          lastStudiedAt = session.submittedAt
        }
      }
      return [
        {
          catalogCount: questions.length,
          lastStudiedAt,
          level: targetLevel,
          nonRecentCount: questions.filter(
            (question) => !recentQuestionIds.has(question.questionId)
          ).length,
          subject
        }
      ]
    })
    target = targetCandidates.toSorted((left, right) => {
      const availabilityOrder =
        Number(right.nonRecentCount > 0) - Number(left.nonRecentCount > 0)
      if (availabilityOrder !== 0) return availabilityOrder
      if (left.lastStudiedAt === null && right.lastStudiedAt !== null) return -1
      if (left.lastStudiedAt !== null && right.lastStudiedAt === null) return 1
      if (left.lastStudiedAt !== right.lastStudiedAt) {
        return (left.lastStudiedAt ?? '').localeCompare(
          right.lastStudiedAt ?? ''
        )
      }
      if (left.nonRecentCount !== right.nonRecentCount) {
        return right.nonRecentCount - left.nonRecentCount
      }
      if (left.catalogCount !== right.catalogCount) {
        return right.catalogCount - left.catalogCount
      }
      return SUBJECTS.indexOf(left.subject) - SUBJECTS.indexOf(right.subject)
    })[0]
  }

  if (target) {
    const action = {
      kind: 'START_SESSION' as const,
      mode: 'RANDOM' as const,
      level: target.level,
      subject: target.subject,
      count: toSetupCount(target.catalogCount)
    }
    const actionKey = `SESSION|${action.mode}|${action.level}|${action.subject}|${action.count}`
    if (!actionKeys.has(actionKey)) {
      actionKeys.add(actionKey)
      recommendations.push({
        rank: recommendations.length + 1,
        kind: 'TARGET_LEVEL_PRACTICE',
        reason: {
          code: 'TARGET_LEVEL_RECENT_GAP',
          catalogCount: target.catalogCount,
          nonRecentCount: target.nonRecentCount,
          lastStudiedAt: target.lastStudiedAt,
          level: target.level,
          subject: target.subject
        },
        action
      })
    }
  }

  let personalizationFallbackReason: GetDashboardInsightsResponse['personalizationFallbackReason'] =
    null
  if (personalizedCount === 0) {
    if (target) {
      personalizationFallbackReason = 'NO_PERSONALIZED_EVIDENCE'
    } else {
      const code = record.targetLevel
        ? ('NO_TARGET_CATALOG' as const)
        : ('TARGET_LEVEL_NOT_SET' as const)
      personalizationFallbackReason = code
      recommendations.push({
        rank: recommendations.length + 1,
        kind: 'PRACTICE_SETUP',
        reason: { code },
        action: { kind: 'OPEN_PRACTICE_SETUP' }
      })
    }
  }

  return { personalizationFallbackReason, recommendations }
}

export const toContractDashboardInsights = (
  record: MockCanonicalDashboardInsightsRecord
): GetDashboardInsightsResponse => {
  const observedAtMs = parseTime(record.observedAt, 'observedAt')
  const fromInclusiveMs =
    observedAtMs - dashboardInsightsWindowDays * DAY_MILLISECONDS
  const answerIds = new Set<string>()
  const overall = createMetricAccumulator()
  const byLevel = new Map(
    LEVELS.map((level) => [level, createMetricAccumulator()])
  )
  const bySubject = new Map(
    SUBJECTS.map((subject) => [subject, createMetricAccumulator()])
  )
  const byQuestionType = new Map(
    QUESTION_TYPES.map((questionType) => [
      questionType,
      createMetricAccumulator()
    ])
  )
  const byTag = new Map<string, TagAccumulator>()
  const weaknessBuckets = new Map<string, WeaknessBucket>()

  for (const answer of record.answers) {
    if (answerIds.has(answer.answerId)) {
      return fail('dashboard insights answer ID가 중복됐습니다.')
    }
    answerIds.add(answer.answerId)
    const answeredAtMs = parseTime(answer.answeredAt, 'answeredAt')
    if (answeredAtMs > observedAtMs) {
      return fail('dashboard insights에 미래 answer가 있습니다.')
    }
    if (answeredAtMs < fromInclusiveMs) continue
    if (!Number.isSafeInteger(answer.elapsedSec) || answer.elapsedSec < 0) {
      return fail('dashboard insights elapsedSec가 올바르지 않습니다.')
    }

    addMetric(overall, answer)
    addMetric(
      requireMapValue(
        byLevel,
        answer.level,
        `알 수 없는 level입니다: ${answer.level}`
      ),
      answer
    )
    addMetric(
      requireMapValue(
        bySubject,
        answer.subject,
        `알 수 없는 subject입니다: ${answer.subject}`
      ),
      answer
    )
    addMetric(
      requireMapValue(
        byQuestionType,
        answer.questionType,
        `알 수 없는 questionType입니다: ${answer.questionType}`
      ),
      answer
    )
    updateWeaknessBucket(
      weaknessBuckets,
      {
        dimension: 'SUBJECT',
        key: `SUBJECT|${answer.level}|${answer.subject}`,
        level: answer.level,
        subject: answer.subject
      },
      answer
    )
    updateWeaknessBucket(
      weaknessBuckets,
      {
        dimension: 'QUESTION_TYPE',
        key: `QUESTION_TYPE|${answer.level}|${answer.subject}|${answer.questionType}`,
        level: answer.level,
        subject: answer.subject,
        questionType: answer.questionType
      },
      answer
    )

    const seenTagIds = new Set<string>()
    for (const tag of answer.tags) {
      if (seenTagIds.has(tag.tagId)) {
        return fail('pinned question version에 tag ID가 중복됐습니다.')
      }
      seenTagIds.add(tag.tagId)
      const existing = byTag.get(tag.tagId)
      const shouldReplaceLabel =
        !existing ||
        answer.answeredAt > existing.labelAnsweredAt ||
        (answer.answeredAt === existing.labelAnsweredAt &&
          (answer.questionVersionId < existing.labelQuestionVersionId ||
            (answer.questionVersionId === existing.labelQuestionVersionId &&
              answer.answerId < existing.labelAnswerId)))
      const accumulator = existing ?? {
        ...createMetricAccumulator(),
        labelAnswerId: answer.answerId,
        labelAnsweredAt: answer.answeredAt,
        labelQuestionVersionId: answer.questionVersionId,
        tagId: tag.tagId,
        tagLabel: tag.tagLabel
      }
      addMetric(accumulator, answer)
      if (shouldReplaceLabel) {
        accumulator.labelAnswerId = answer.answerId
        accumulator.labelAnsweredAt = answer.answeredAt
        accumulator.labelQuestionVersionId = answer.questionVersionId
        accumulator.tagLabel = tag.tagLabel
      }
      byTag.set(tag.tagId, accumulator)
      updateWeaknessBucket(
        weaknessBuckets,
        {
          dimension: 'TAG',
          key: `TAG|${answer.level}|${answer.subject}|${tag.tagId}`,
          level: answer.level,
          subject: answer.subject,
          tagId: tag.tagId,
          tagLabel: tag.tagLabel
        },
        answer
      )
    }
  }

  const allWeaknessBuckets = [...weaknessBuckets.values()]
  const nonTagWeaknesses = selectTopWeaknesses(
    allWeaknessBuckets.filter((bucket) => bucket.dimension !== 'TAG'),
    observedAtMs,
    100
  )
  const tagWeaknesses = selectTopWeaknesses(
    allWeaknessBuckets.filter((bucket) => bucket.dimension === 'TAG'),
    observedAtMs,
    10
  )
  const globalTop = [...nonTagWeaknesses, ...tagWeaknesses]
    .toSorted(compareWeaknesses)
    .slice(0, 10)
  const tagStats = [...byTag.values()].map(
    (tag): DashboardInsightTagStat => ({
      tagId: tag.tagId,
      tagLabel: tag.tagLabel,
      ...toMetric(tag)
    })
  )
  const { personalizationFallbackReason, recommendations } =
    createRecommendations(record, nonTagWeaknesses, observedAtMs)
  const weaknesses = selectResponseWeaknesses(
    globalTop,
    nonTagWeaknesses,
    recommendations
  )
  const requiredTagIds = new Set(
    weaknesses.flatMap((weakness) =>
      weakness.dimension === 'TAG' ? [weakness.tagId] : []
    )
  )
  const selectedTagStats = [
    ...tagStats.filter((tag) => requiredTagIds.has(tag.tagId)),
    ...tagStats
      .filter((tag) => !requiredTagIds.has(tag.tagId))
      .toSorted(
        (left, right) =>
          right.attemptedCount - left.attemptedCount ||
          (right.lastAnsweredAt ?? '').localeCompare(
            left.lastAnsweredAt ?? ''
          ) ||
          left.tagId.localeCompare(right.tagId)
      )
  ]
    .slice(0, dashboardInsightTagLimit)
    .toSorted((left, right) => left.tagId.localeCompare(right.tagId))
  const currentQuestionIds = new Set(
    record.currentCatalog.map((question) => question.questionId)
  )
  const availableNotes = record.wrongNotes.filter(
    (note) => note.isAvailable && currentQuestionIds.has(note.questionId)
  )

  return getDashboardInsightsResponseSchema.parse({
    algorithm: {
      weakness: 'weakness-v1',
      recommendation: 'recommendation-v1'
    },
    observedAt: record.observedAt,
    window: {
      fromInclusive: new Date(fromInclusiveMs).toISOString(),
      toInclusive: record.observedAt,
      durationDays: dashboardInsightsWindowDays,
      minAttempts: dashboardWeaknessMinAttempts,
      fullConfidenceAt: dashboardWeaknessFullConfidenceAttempts
    },
    stats: {
      overall: toMetric(overall),
      byLevel: LEVELS.map((level) => ({
        level,
        ...toMetric(
          requireMapValue(byLevel, level, `level metric이 없습니다: ${level}`)
        )
      })),
      bySubject: SUBJECTS.map((subject) => ({
        subject,
        ...toMetric(
          requireMapValue(
            bySubject,
            subject,
            `subject metric이 없습니다: ${subject}`
          )
        )
      })),
      byQuestionType: QUESTION_TYPES.map((questionType) => ({
        questionType,
        ...toMetric(
          requireMapValue(
            byQuestionType,
            questionType,
            `questionType metric이 없습니다: ${questionType}`
          )
        )
      })),
      byTag: selectedTagStats,
      byTagTotal: tagStats.length,
      byTagTruncated: tagStats.length > dashboardInsightTagLimit
    },
    reviewQueueCounts: {
      due: availableNotes.filter(
        (note) => parseTime(note.nextReviewAt, 'nextReviewAt') <= observedAtMs
      ).length,
      repeated: availableNotes.filter((note) => note.wrongCount >= 2).length
    },
    weaknesses,
    recommendations,
    personalizationFallbackReason
  })
}
