import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  questionSubjectSchema,
  questionTypeSchema
} from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  wrongNoteQuestionPreviewSchema,
  wrongNoteTagLabelSchema
} from '../wrong-note/list-wrong-notes.js'

export const dashboardInsightsWindowDays = 90 as const
export const dashboardWeaknessMinAttempts = 5 as const
export const dashboardWeaknessFullConfidenceAttempts = 20 as const
export const dashboardRecommendationLimit = 5 as const
export const dashboardInsightTagLimit = 100 as const

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000
const SCORE_DENOMINATOR = 1_000_000_000_000n
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
const VOCABULARY_QUESTION_TYPES = QUESTION_TYPES.slice(0, 5)
const GRAMMAR_QUESTION_TYPES = QUESTION_TYPES.slice(5, 8)
const READING_QUESTION_TYPES_BY_LEVEL = {
  N5: ['SHORT_READING', 'INFO_RETRIEVAL'],
  N4: ['SHORT_READING', 'INFO_RETRIEVAL'],
  N3: ['SHORT_READING', 'MEDIUM_READING', 'INFO_RETRIEVAL'],
  N2: ['MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL'],
  N1: ['MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL']
} as const satisfies Record<
  (typeof LEVELS)[number],
  readonly (typeof QUESTION_TYPES)[number][]
>

const safeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
const positiveSafeCountSchema = safeCountSchema.min(1)
const basisPointsSchema = z.number().int().min(0).max(10_000)
const averageElapsedSecSchema = z.number().int().min(0).max(86_400)
const setupCountSchema = z.union([z.literal(5), z.literal(10), z.literal(20)])
const dashboardInsightTagLabelSchema = wrongNoteTagLabelSchema.refine(
  (value) => [...value].length <= 100,
  '태그 label은 Unicode code point 기준 100자 이하여야 합니다.'
)

const divideRoundHalfUp = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator / 2n) / denominator

const calculateRateBasisPoints = (
  correctCount: number,
  attemptedCount: number
): number =>
  attemptedCount === 0
    ? 0
    : Number(
        divideRoundHalfUp(
          BigInt(correctCount) * 10_000n,
          BigInt(attemptedCount)
        )
      )

const toSetupCount = (count: number): 5 | 10 | 20 =>
  count >= 20 ? 20 : count >= 10 ? 10 : 5

const isApplicableQuestionType = (
  level: (typeof LEVELS)[number],
  subject: (typeof SUBJECTS)[number],
  questionType: (typeof QUESTION_TYPES)[number]
): boolean => {
  if (subject === 'VOCABULARY') {
    return VOCABULARY_QUESTION_TYPES.includes(questionType)
  }
  if (subject === 'GRAMMAR') {
    return GRAMMAR_QUESTION_TYPES.includes(questionType)
  }
  return READING_QUESTION_TYPES_BY_LEVEL[level].includes(questionType as never)
}

export const getDashboardInsightsOperationId =
  'dashboard.getDashboardInsights' as const

export const getDashboardInsightsQuerySchema = z.object({}).strict()

export const dashboardInsightMetricSchema = z
  .object({
    attemptedCount: safeCountSchema,
    correctCount: safeCountSchema,
    correctRateBasisPoints: basisPointsSchema.nullable(),
    averageElapsedSec: averageElapsedSecSchema.nullable(),
    lastAnsweredAt: isoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((metric, context) => {
    if (metric.correctCount > metric.attemptedCount) {
      context.addIssue({
        code: 'custom',
        path: ['correctCount'],
        message: 'correctCount는 attemptedCount보다 클 수 없습니다.'
      })
      return
    }
    if (metric.attemptedCount === 0) {
      if (
        metric.correctCount !== 0 ||
        metric.correctRateBasisPoints !== null ||
        metric.averageElapsedSec !== null ||
        metric.lastAnsweredAt !== null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['attemptedCount'],
          message:
            '표본 0 metric의 rate·average·lastAnsweredAt은 null이어야 합니다.'
        })
      }
      return
    }
    if (
      metric.correctRateBasisPoints !==
        calculateRateBasisPoints(metric.correctCount, metric.attemptedCount) ||
      metric.averageElapsedSec === null ||
      metric.lastAnsweredAt === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['correctRateBasisPoints'],
        message:
          '표본이 있는 metric은 count와 일치하는 rate와 average·lastAnsweredAt을 가져야 합니다.'
      })
    }
  })

export const dashboardInsightLevelStatSchema = dashboardInsightMetricSchema
  .safeExtend({ level: jlptLevelSchema })
  .strict()

export const dashboardInsightSubjectStatSchema = dashboardInsightMetricSchema
  .safeExtend({ subject: questionSubjectSchema })
  .strict()

export const dashboardInsightQuestionTypeStatSchema =
  dashboardInsightMetricSchema
    .safeExtend({ questionType: questionTypeSchema })
    .strict()

export const dashboardInsightTagStatSchema = dashboardInsightMetricSchema
  .safeExtend({
    tagId: opaqueIdSchema,
    tagLabel: dashboardInsightTagLabelSchema
  })
  .strict()
  .superRefine((stat, context) => {
    if (stat.attemptedCount === 0) {
      context.addIssue({
        code: 'custom',
        path: ['attemptedCount'],
        message: 'byTag에는 실제로 관측된 tag만 포함해야 합니다.'
      })
    }
  })

const weaknessEvidenceShape = {
  key: z.string().min(1).max(180),
  level: jlptLevelSchema,
  subject: questionSubjectSchema,
  attemptedCount: safeCountSchema.min(dashboardWeaknessMinAttempts),
  incorrectCount: positiveSafeCountSchema,
  repeatExtra: safeCountSchema,
  lastAnsweredAt: isoDateTimeSchema,
  ageDays: z.number().int().min(0).max(dashboardInsightsWindowDays),
  errorRateBasisPoints: basisPointsSchema,
  recencyWeightBasisPoints: z.union([
    z.literal(5_500),
    z.literal(7_000),
    z.literal(8_500),
    z.literal(10_000)
  ]),
  repeatWeightBasisPoints: z.number().int().min(10_000).max(15_000),
  sampleConfidenceBasisPoints: basisPointsSchema.min(1),
  scoreBasisPoints: z.number().int().min(0).max(15_000)
} as const

const dashboardSubjectWeaknessSchema = z
  .object({
    dimension: z.literal('SUBJECT'),
    ...weaknessEvidenceShape
  })
  .strict()

const dashboardQuestionTypeWeaknessSchema = z
  .object({
    dimension: z.literal('QUESTION_TYPE'),
    questionType: questionTypeSchema,
    ...weaknessEvidenceShape
  })
  .strict()

const dashboardTagWeaknessSchema = z
  .object({
    dimension: z.literal('TAG'),
    tagId: opaqueIdSchema,
    tagLabel: dashboardInsightTagLabelSchema,
    ...weaknessEvidenceShape
  })
  .strict()

export const dashboardWeaknessSchema = z
  .discriminatedUnion('dimension', [
    dashboardSubjectWeaknessSchema,
    dashboardQuestionTypeWeaknessSchema,
    dashboardTagWeaknessSchema
  ])
  .superRefine((weakness, context) => {
    if (
      weakness.incorrectCount > weakness.attemptedCount ||
      weakness.repeatExtra > weakness.incorrectCount - 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['repeatExtra'],
        message: 'weakness count 불변식이 올바르지 않습니다.'
      })
      return
    }
    const errorRateBasisPoints = Number(
      divideRoundHalfUp(
        BigInt(weakness.incorrectCount) * 10_000n,
        BigInt(weakness.attemptedCount)
      )
    )
    const repeatWeightBasisPoints = Number(
      10_000n +
        divideRoundHalfUp(
          BigInt(weakness.repeatExtra) * 5_000n,
          BigInt(weakness.incorrectCount)
        )
    )
    const sampleConfidenceBasisPoints =
      weakness.attemptedCount >= dashboardWeaknessFullConfidenceAttempts
        ? 10_000
        : Number(BigInt(weakness.attemptedCount) * 500n)
    const scoreBasisPoints = Number(
      divideRoundHalfUp(
        BigInt(errorRateBasisPoints) *
          BigInt(weakness.recencyWeightBasisPoints) *
          BigInt(repeatWeightBasisPoints) *
          BigInt(sampleConfidenceBasisPoints),
        SCORE_DENOMINATOR
      )
    )
    const expectedRecency =
      weakness.ageDays <= 6
        ? 10_000
        : weakness.ageDays <= 29
          ? 8_500
          : weakness.ageDays <= 59
            ? 7_000
            : 5_500

    if (
      weakness.errorRateBasisPoints !== errorRateBasisPoints ||
      weakness.repeatWeightBasisPoints !== repeatWeightBasisPoints ||
      weakness.sampleConfidenceBasisPoints !== sampleConfidenceBasisPoints ||
      weakness.recencyWeightBasisPoints !== expectedRecency ||
      weakness.scoreBasisPoints !== scoreBasisPoints
    ) {
      context.addIssue({
        code: 'custom',
        path: ['scoreBasisPoints'],
        message: 'weakness-v1 component와 score가 일치해야 합니다.'
      })
    }

    const expectedKey =
      weakness.dimension === 'SUBJECT'
        ? `SUBJECT|${weakness.level}|${weakness.subject}`
        : weakness.dimension === 'QUESTION_TYPE'
          ? `QUESTION_TYPE|${weakness.level}|${weakness.subject}|${weakness.questionType}`
          : `TAG|${weakness.level}|${weakness.subject}|${weakness.tagId}`
    if (weakness.key !== expectedKey) {
      context.addIssue({
        code: 'custom',
        path: ['key'],
        message: 'weakness key는 dimension identity에서 결정돼야 합니다.'
      })
    }

    if (
      weakness.dimension === 'QUESTION_TYPE' &&
      !isApplicableQuestionType(
        weakness.level,
        weakness.subject,
        weakness.questionType
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['questionType'],
        message: 'questionType은 subject taxonomy와 일치해야 합니다.'
      })
    }
  })

const startSessionActionSchema = z
  .object({
    kind: z.literal('START_SESSION'),
    mode: z.enum(['DAILY_REVIEW', 'WEAKNESS', 'RANDOM']),
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    count: setupCountSchema
  })
  .strict()

const startTargetedReviewActionSchema = z
  .object({
    kind: z.literal('START_TARGETED_REVIEW'),
    questionId: opaqueIdSchema
  })
  .strict()

const openPracticeSetupActionSchema = z
  .object({ kind: z.literal('OPEN_PRACTICE_SETUP') })
  .strict()

export const dashboardRecommendationActionSchema = z.discriminatedUnion(
  'kind',
  [
    startSessionActionSchema,
    startTargetedReviewActionSchema,
    openPracticeSetupActionSchema
  ]
)

const dueRecommendationSchema = z
  .object({
    rank: z.number().int().min(1).max(dashboardRecommendationLimit),
    kind: z.literal('DUE_REVIEW'),
    reason: z
      .object({
        code: z.literal('DUE_REVIEW_COUNT'),
        dueCount: positiveSafeCountSchema,
        earliestDueAt: isoDateTimeSchema,
        level: jlptLevelSchema,
        subject: questionSubjectSchema
      })
      .strict(),
    action: startSessionActionSchema.extend({
      mode: z.literal('DAILY_REVIEW')
    })
  })
  .strict()
  .superRefine((recommendation, context) => {
    if (
      recommendation.action.count !==
        toSetupCount(recommendation.reason.dueCount) ||
      recommendation.action.level !== recommendation.reason.level ||
      recommendation.action.subject !== recommendation.reason.subject
    ) {
      context.addIssue({
        code: 'custom',
        path: ['action', 'count'],
        message: 'DAILY_REVIEW count는 dueCount의 5/10/20 bucket이어야 합니다.'
      })
    }
  })

const repeatedWrongRecommendationSchema = z
  .object({
    rank: z.number().int().min(1).max(dashboardRecommendationLimit),
    kind: z.literal('REPEATED_WRONG'),
    reason: z
      .object({
        code: z.literal('REPEATED_WRONG_COUNT'),
        level: jlptLevelSchema,
        subject: questionSubjectSchema,
        questionId: opaqueIdSchema,
        questionPreview: wrongNoteQuestionPreviewSchema,
        wrongCount: safeCountSchema.min(2),
        lastWrongAt: isoDateTimeSchema
      })
      .strict(),
    action: startTargetedReviewActionSchema
  })
  .strict()
  .superRefine((recommendation, context) => {
    if (recommendation.action.questionId !== recommendation.reason.questionId) {
      context.addIssue({
        code: 'custom',
        path: ['action', 'questionId'],
        message: 'targeted review action은 repeated evidence와 일치해야 합니다.'
      })
    }
  })

const recentTypeRecommendationSchema = z
  .object({
    rank: z.number().int().min(1).max(dashboardRecommendationLimit),
    kind: z.literal('RECENT_LOW_ACCURACY_TYPE'),
    reason: z
      .object({
        code: z.literal('RECENT_LOW_ACCURACY_TYPE'),
        questionType: questionTypeSchema,
        attemptedCount: safeCountSchema.min(dashboardWeaknessMinAttempts),
        incorrectCount: positiveSafeCountSchema,
        errorRateBasisPoints: basisPointsSchema.min(4_000),
        scoreBasisPoints: z.number().int().min(0).max(15_000),
        actionableCandidateCount: positiveSafeCountSchema
      })
      .strict(),
    action: startSessionActionSchema.extend({ mode: z.literal('WEAKNESS') })
  })
  .strict()
  .superRefine((recommendation, context) => {
    const exactLowAccuracy =
      BigInt(recommendation.reason.incorrectCount) * 10_000n >=
      BigInt(recommendation.reason.attemptedCount) * 4_000n
    if (
      recommendation.reason.incorrectCount >
        recommendation.reason.attemptedCount ||
      !exactLowAccuracy ||
      recommendation.reason.errorRateBasisPoints !==
        Number(
          divideRoundHalfUp(
            BigInt(recommendation.reason.incorrectCount) * 10_000n,
            BigInt(recommendation.reason.attemptedCount)
          )
        ) ||
      recommendation.action.count !==
        toSetupCount(recommendation.reason.actionableCandidateCount)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message:
          'recent type recommendation evidence와 action이 일치해야 합니다.'
      })
    }
  })

const staleSubjectRecommendationSchema = z
  .object({
    rank: z.number().int().min(1).max(dashboardRecommendationLimit),
    kind: z.literal('STALE_WEAK_SUBJECT'),
    reason: z
      .object({
        code: z.literal('STALE_WEAK_SUBJECT'),
        attemptedCount: safeCountSchema.min(dashboardWeaknessMinAttempts),
        incorrectCount: positiveSafeCountSchema,
        errorRateBasisPoints: basisPointsSchema.min(4_000),
        scoreBasisPoints: z.number().int().min(0).max(15_000),
        ageDays: z.number().int().min(30).max(dashboardInsightsWindowDays),
        actionableCandidateCount: positiveSafeCountSchema
      })
      .strict(),
    action: startSessionActionSchema.extend({ mode: z.literal('WEAKNESS') })
  })
  .strict()
  .superRefine((recommendation, context) => {
    const exactLowAccuracy =
      BigInt(recommendation.reason.incorrectCount) * 10_000n >=
      BigInt(recommendation.reason.attemptedCount) * 4_000n
    if (
      recommendation.reason.incorrectCount >
        recommendation.reason.attemptedCount ||
      !exactLowAccuracy ||
      recommendation.reason.errorRateBasisPoints !==
        Number(
          divideRoundHalfUp(
            BigInt(recommendation.reason.incorrectCount) * 10_000n,
            BigInt(recommendation.reason.attemptedCount)
          )
        ) ||
      recommendation.action.count !==
        toSetupCount(recommendation.reason.actionableCandidateCount)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message:
          'stale subject recommendation evidence와 action이 일치해야 합니다.'
      })
    }
  })

const targetLevelRecommendationSchema = z
  .object({
    rank: z.number().int().min(1).max(dashboardRecommendationLimit),
    kind: z.literal('TARGET_LEVEL_PRACTICE'),
    reason: z
      .object({
        code: z.literal('TARGET_LEVEL_RECENT_GAP'),
        catalogCount: positiveSafeCountSchema,
        nonRecentCount: safeCountSchema,
        lastStudiedAt: isoDateTimeSchema.nullable(),
        level: jlptLevelSchema,
        subject: questionSubjectSchema
      })
      .strict(),
    action: startSessionActionSchema.extend({ mode: z.literal('RANDOM') })
  })
  .strict()
  .superRefine((recommendation, context) => {
    if (
      recommendation.reason.nonRecentCount >
        recommendation.reason.catalogCount ||
      recommendation.action.count !==
        toSetupCount(recommendation.reason.catalogCount) ||
      recommendation.action.level !== recommendation.reason.level ||
      recommendation.action.subject !== recommendation.reason.subject
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message:
          'target-level recommendation evidence와 action이 일치해야 합니다.'
      })
    }
  })

const practiceSetupRecommendationSchema = z
  .object({
    rank: z.number().int().min(1).max(dashboardRecommendationLimit),
    kind: z.literal('PRACTICE_SETUP'),
    reason: z
      .object({
        code: z.enum(['TARGET_LEVEL_NOT_SET', 'NO_TARGET_CATALOG'])
      })
      .strict(),
    action: openPracticeSetupActionSchema
  })
  .strict()

export const dashboardRecommendationSchema = z.discriminatedUnion('kind', [
  dueRecommendationSchema,
  repeatedWrongRecommendationSchema,
  recentTypeRecommendationSchema,
  staleSubjectRecommendationSchema,
  targetLevelRecommendationSchema,
  practiceSetupRecommendationSchema
])

const personalizationFallbackReasonSchema = z
  .enum([
    'NO_PERSONALIZED_EVIDENCE',
    'TARGET_LEVEL_NOT_SET',
    'NO_TARGET_CATALOG'
  ])
  .nullable()

const getActionKey = (
  action: z.output<typeof dashboardRecommendationActionSchema>
): string =>
  action.kind === 'START_SESSION'
    ? `SESSION|${action.mode}|${action.level}|${action.subject}|${action.count}`
    : action.kind === 'START_TARGETED_REVIEW'
      ? `TARGETED|${action.questionId}`
      : 'SETUP'

const recommendationPriority = {
  DUE_REVIEW: 0,
  REPEATED_WRONG: 1,
  RECENT_LOW_ACCURACY_TYPE: 2,
  STALE_WEAK_SUBJECT: 3,
  TARGET_LEVEL_PRACTICE: 4,
  PRACTICE_SETUP: 4
} as const

const dimensionPriority = {
  SUBJECT: 0,
  QUESTION_TYPE: 1,
  TAG: 2
} as const

const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1

const compareWeaknesses = (
  left: z.output<typeof dashboardWeaknessSchema>,
  right: z.output<typeof dashboardWeaknessSchema>
): number => {
  if (left.scoreBasisPoints !== right.scoreBasisPoints) {
    return right.scoreBasisPoints - left.scoreBasisPoints
  }
  const leftRatio = BigInt(left.incorrectCount) * BigInt(right.attemptedCount)
  const rightRatio = BigInt(right.incorrectCount) * BigInt(left.attemptedCount)
  if (leftRatio !== rightRatio) {
    return leftRatio > rightRatio ? -1 : 1
  }
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
    dimensionPriority[left.dimension] - dimensionPriority[right.dimension]
  if (dimensionOrder !== 0) {
    return dimensionOrder
  }
  const levelOrder = LEVELS.indexOf(left.level) - LEVELS.indexOf(right.level)
  if (levelOrder !== 0) {
    return levelOrder
  }
  const subjectOrder =
    SUBJECTS.indexOf(left.subject) - SUBJECTS.indexOf(right.subject)
  if (subjectOrder !== 0) {
    return subjectOrder
  }
  if (
    left.dimension === 'QUESTION_TYPE' &&
    right.dimension === 'QUESTION_TYPE'
  ) {
    const typeOrder =
      QUESTION_TYPES.indexOf(left.questionType) -
      QUESTION_TYPES.indexOf(right.questionType)
    if (typeOrder !== 0) {
      return typeOrder
    }
  }
  return compareText(left.key, right.key)
}

export const getDashboardInsightsResponseSchema = z
  .object({
    algorithm: z
      .object({
        weakness: z.literal('weakness-v1'),
        recommendation: z.literal('recommendation-v1')
      })
      .strict(),
    observedAt: isoDateTimeSchema,
    window: z
      .object({
        fromInclusive: isoDateTimeSchema,
        toInclusive: isoDateTimeSchema,
        durationDays: z.literal(dashboardInsightsWindowDays),
        minAttempts: z.literal(dashboardWeaknessMinAttempts),
        fullConfidenceAt: z.literal(dashboardWeaknessFullConfidenceAttempts)
      })
      .strict(),
    stats: z
      .object({
        overall: dashboardInsightMetricSchema,
        byLevel: z.array(dashboardInsightLevelStatSchema).length(LEVELS.length),
        bySubject: z
          .array(dashboardInsightSubjectStatSchema)
          .length(SUBJECTS.length),
        byQuestionType: z
          .array(dashboardInsightQuestionTypeStatSchema)
          .length(QUESTION_TYPES.length),
        byTag: z
          .array(dashboardInsightTagStatSchema)
          .max(dashboardInsightTagLimit),
        byTagTotal: safeCountSchema,
        byTagTruncated: z.boolean()
      })
      .strict(),
    reviewQueueCounts: z
      .object({
        due: safeCountSchema,
        repeated: safeCountSchema
      })
      .strict(),
    weaknesses: z.array(dashboardWeaknessSchema).max(10),
    recommendations: z
      .array(dashboardRecommendationSchema)
      .min(1)
      .max(dashboardRecommendationLimit),
    personalizationFallbackReason: personalizationFallbackReasonSchema
  })
  .strict()
  .superRefine((response, context) => {
    const observedTime = new Date(response.observedAt).getTime()
    const fromTime = new Date(response.window.fromInclusive).getTime()
    const toTime = new Date(response.window.toInclusive).getTime()
    if (
      toTime !== observedTime ||
      toTime - fromTime !== dashboardInsightsWindowDays * DAY_MILLISECONDS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['window'],
        message: 'insights window는 observedAt까지 정확히 90일이어야 합니다.'
      })
    }

    response.stats.byLevel.forEach((stat, index) => {
      if (stat.level !== LEVELS[index]) {
        context.addIssue({
          code: 'custom',
          path: ['stats', 'byLevel', index, 'level'],
          message: 'level 통계는 canonical enum 순서여야 합니다.'
        })
      }
    })
    response.stats.bySubject.forEach((stat, index) => {
      if (stat.subject !== SUBJECTS[index]) {
        context.addIssue({
          code: 'custom',
          path: ['stats', 'bySubject', index, 'subject'],
          message: 'subject 통계는 canonical enum 순서여야 합니다.'
        })
      }
    })
    response.stats.byQuestionType.forEach((stat, index) => {
      if (stat.questionType !== QUESTION_TYPES[index]) {
        context.addIssue({
          code: 'custom',
          path: ['stats', 'byQuestionType', index, 'questionType'],
          message: 'questionType 통계는 canonical enum 순서여야 합니다.'
        })
      }
    })
    const fixedDimensions = [
      ['byLevel', response.stats.byLevel],
      ['bySubject', response.stats.bySubject],
      ['byQuestionType', response.stats.byQuestionType]
    ] as const
    for (const [field, stats] of fixedDimensions) {
      const attempted = stats.reduce(
        (sum, stat) => sum + BigInt(stat.attemptedCount),
        0n
      )
      const correct = stats.reduce(
        (sum, stat) => sum + BigInt(stat.correctCount),
        0n
      )
      if (
        attempted !== BigInt(response.stats.overall.attemptedCount) ||
        correct !== BigInt(response.stats.overall.correctCount)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['stats', field],
          message: `${field} 통계 합은 overall과 일치해야 합니다.`
        })
      }
      const latestTimestamp = stats.reduce<number | null>((latest, stat) => {
        if (stat.lastAnsweredAt === null) {
          return latest
        }
        const timestamp = new Date(stat.lastAnsweredAt).getTime()
        return latest === null || timestamp > latest ? timestamp : latest
      }, null)
      const overallTimestamp =
        response.stats.overall.lastAnsweredAt === null
          ? null
          : new Date(response.stats.overall.lastAnsweredAt).getTime()
      if (latestTimestamp !== overallTimestamp) {
        context.addIssue({
          code: 'custom',
          path: ['stats', field],
          message: `${field}의 최신 answer 시각은 overall과 일치해야 합니다.`
        })
      }
    }

    const metricEntries = [
      { metric: response.stats.overall, path: ['stats', 'overall'] },
      ...response.stats.byLevel.map((metric, index) => ({
        metric,
        path: ['stats', 'byLevel', index]
      })),
      ...response.stats.bySubject.map((metric, index) => ({
        metric,
        path: ['stats', 'bySubject', index]
      })),
      ...response.stats.byQuestionType.map((metric, index) => ({
        metric,
        path: ['stats', 'byQuestionType', index]
      })),
      ...response.stats.byTag.map((metric, index) => ({
        metric,
        path: ['stats', 'byTag', index]
      }))
    ]
    for (const { metric, path } of metricEntries) {
      if (metric.lastAnsweredAt === null) {
        continue
      }
      const lastAnsweredTime = new Date(metric.lastAnsweredAt).getTime()
      if (lastAnsweredTime < fromTime || lastAnsweredTime > observedTime) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'lastAnsweredAt'],
          message:
            'metric lastAnsweredAt은 response 분석 window 안이어야 합니다.'
        })
      }
    }

    const tagIds = new Set<string>()
    if (
      response.stats.byTag.length !==
        Math.min(response.stats.byTagTotal, dashboardInsightTagLimit) ||
      response.stats.byTagTruncated !==
        response.stats.byTagTotal > dashboardInsightTagLimit
    ) {
      context.addIssue({
        code: 'custom',
        path: ['stats', 'byTag'],
        message:
          'tag facet은 total과 고정 limit에 맞는 bounded page여야 합니다.'
      })
    }
    response.stats.byTag.forEach((stat, index) => {
      const previous = response.stats.byTag[index - 1]
      if (
        tagIds.has(stat.tagId) ||
        (previous && compareText(previous.tagId, stat.tagId) >= 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['stats', 'byTag', index, 'tagId'],
          message: 'tag 통계는 unique tagId 오름차순이어야 합니다.'
        })
      }
      if (
        stat.attemptedCount > response.stats.overall.attemptedCount ||
        stat.correctCount > response.stats.overall.correctCount
      ) {
        context.addIssue({
          code: 'custom',
          path: ['stats', 'byTag', index],
          message: '개별 tag metric은 overall count를 초과할 수 없습니다.'
        })
      }
      tagIds.add(stat.tagId)
    })

    const weaknessKeys = new Set<string>()
    response.weaknesses.forEach((weakness, index) => {
      const previous = response.weaknesses[index - 1]
      if (
        weaknessKeys.has(weakness.key) ||
        (previous && compareWeaknesses(previous, weakness) > 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['weaknesses', index],
          message: 'weakness는 unique key와 weakness-v1 순위를 따라야 합니다.'
        })
      }
      weaknessKeys.add(weakness.key)
      const lastTime = new Date(weakness.lastAnsweredAt).getTime()
      const ageMilliseconds = observedTime - lastTime
      if (
        ageMilliseconds < 0 ||
        ageMilliseconds > dashboardInsightsWindowDays * DAY_MILLISECONDS ||
        Math.floor(ageMilliseconds / DAY_MILLISECONDS) !== weakness.ageDays
      ) {
        context.addIssue({
          code: 'custom',
          path: ['weaknesses', index, 'ageDays'],
          message: 'weakness ageDays는 response snapshot과 일치해야 합니다.'
        })
      }

      const matchingMetrics = [
        response.stats.overall,
        response.stats.byLevel.find((stat) => stat.level === weakness.level),
        response.stats.bySubject.find(
          (stat) => stat.subject === weakness.subject
        ),
        weakness.dimension === 'QUESTION_TYPE'
          ? response.stats.byQuestionType.find(
              (stat) => stat.questionType === weakness.questionType
            )
          : null,
        weakness.dimension === 'TAG'
          ? response.stats.byTag.find((stat) => stat.tagId === weakness.tagId)
          : null
      ].filter((metric) => metric !== null && metric !== undefined)
      const requiredMetricCount = weakness.dimension === 'SUBJECT' ? 3 : 4
      const weaknessLastTime = new Date(weakness.lastAnsweredAt).getTime()
      if (
        matchingMetrics.length !== requiredMetricCount ||
        matchingMetrics.some(
          (metric) =>
            metric.attemptedCount < weakness.attemptedCount ||
            metric.attemptedCount - metric.correctCount <
              weakness.incorrectCount ||
            metric.lastAnsweredAt === null ||
            new Date(metric.lastAnsweredAt).getTime() < weaknessLastTime
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['weaknesses', index],
          message:
            'weakness evidence는 같은 snapshot의 aggregate metric 안에 있어야 합니다.'
        })
      }
    })

    const kinds = new Set<string>()
    const actionKeys = new Set<string>()
    response.recommendations.forEach((recommendation, index) => {
      const previous = response.recommendations[index - 1]
      const actionKey = getActionKey(recommendation.action)
      if (
        recommendation.rank !== index + 1 ||
        kinds.has(recommendation.kind) ||
        actionKeys.has(actionKey) ||
        (previous &&
          recommendationPriority[previous.kind] >
            recommendationPriority[recommendation.kind])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['recommendations', index],
          message:
            'recommendation은 연속 rank, priority 순서, unique kind/action을 따라야 합니다.'
        })
      }
      kinds.add(recommendation.kind)
      actionKeys.add(actionKey)

      switch (recommendation.kind) {
        case 'DUE_REVIEW': {
          if (
            new Date(recommendation.reason.earliestDueAt).getTime() >
              observedTime ||
            recommendation.reason.dueCount > response.reviewQueueCounts.due
          ) {
            context.addIssue({
              code: 'custom',
              path: ['recommendations', index, 'reason'],
              message:
                'due recommendation은 snapshot의 due count/시각 안이어야 합니다.'
            })
          }
          break
        }
        case 'REPEATED_WRONG': {
          if (
            new Date(recommendation.reason.lastWrongAt).getTime() >
              observedTime ||
            response.reviewQueueCounts.repeated === 0
          ) {
            context.addIssue({
              code: 'custom',
              path: ['recommendations', index, 'reason'],
              message:
                'repeated recommendation은 snapshot의 repeated evidence 안이어야 합니다.'
            })
          }
          break
        }
        case 'RECENT_LOW_ACCURACY_TYPE': {
          const exactLowAccuracy =
            BigInt(recommendation.reason.incorrectCount) * 10_000n >=
            BigInt(recommendation.reason.attemptedCount) * 4_000n
          const matchingWeakness = response.weaknesses.find(
            (weakness) =>
              weakness.dimension === 'QUESTION_TYPE' &&
              weakness.level === recommendation.action.level &&
              weakness.subject === recommendation.action.subject &&
              weakness.questionType === recommendation.reason.questionType &&
              weakness.attemptedCount ===
                recommendation.reason.attemptedCount &&
              weakness.incorrectCount ===
                recommendation.reason.incorrectCount &&
              weakness.errorRateBasisPoints ===
                recommendation.reason.errorRateBasisPoints &&
              weakness.scoreBasisPoints ===
                recommendation.reason.scoreBasisPoints &&
              weakness.ageDays <= 29
          )
          const actionGroupRepresentative = response.weaknesses
            .filter(
              (weakness) =>
                weakness.dimension === 'QUESTION_TYPE' &&
                weakness.level === recommendation.action.level &&
                weakness.subject === recommendation.action.subject &&
                weakness.ageDays <= 29 &&
                BigInt(weakness.incorrectCount) * 10_000n >=
                  BigInt(weakness.attemptedCount) * 4_000n
            )
            .reduce<z.output<
              typeof dashboardWeaknessSchema
            > | null>((best, weakness) => (best === null || compareWeaknesses(weakness, best) < 0 ? weakness : best), null)
          if (
            !exactLowAccuracy ||
            !matchingWeakness ||
            actionGroupRepresentative?.key !== matchingWeakness.key
          ) {
            context.addIssue({
              code: 'custom',
              path: ['recommendations', index, 'reason'],
              message:
                'recent type recommendation은 matching low-accuracy weakness evidence가 필요합니다.'
            })
          }
          break
        }
        case 'STALE_WEAK_SUBJECT': {
          const exactLowAccuracy =
            BigInt(recommendation.reason.incorrectCount) * 10_000n >=
            BigInt(recommendation.reason.attemptedCount) * 4_000n
          const matchingWeakness = response.weaknesses.find(
            (weakness) =>
              weakness.dimension === 'SUBJECT' &&
              weakness.level === recommendation.action.level &&
              weakness.subject === recommendation.action.subject &&
              weakness.attemptedCount ===
                recommendation.reason.attemptedCount &&
              weakness.incorrectCount ===
                recommendation.reason.incorrectCount &&
              weakness.errorRateBasisPoints ===
                recommendation.reason.errorRateBasisPoints &&
              weakness.scoreBasisPoints ===
                recommendation.reason.scoreBasisPoints &&
              weakness.ageDays === recommendation.reason.ageDays
          )
          if (!exactLowAccuracy || !matchingWeakness) {
            context.addIssue({
              code: 'custom',
              path: ['recommendations', index, 'reason'],
              message:
                'stale subject recommendation은 matching low-accuracy weakness evidence가 필요합니다.'
            })
          }
          break
        }
        case 'TARGET_LEVEL_PRACTICE': {
          if (
            recommendation.reason.lastStudiedAt !== null &&
            new Date(recommendation.reason.lastStudiedAt).getTime() >
              observedTime
          ) {
            context.addIssue({
              code: 'custom',
              path: ['recommendations', index, 'reason', 'lastStudiedAt'],
              message:
                'target-level lastStudiedAt은 observedAt 이후일 수 없습니다.'
            })
          }
          break
        }
        case 'PRACTICE_SETUP':
          break
      }
    })

    const recentTypeRecommendation = response.recommendations.find(
      (item) => item.kind === 'RECENT_LOW_ACCURACY_TYPE'
    )
    const staleSubjectRecommendation = response.recommendations.find(
      (item) => item.kind === 'STALE_WEAK_SUBJECT'
    )
    if (
      recentTypeRecommendation?.kind === 'RECENT_LOW_ACCURACY_TYPE' &&
      staleSubjectRecommendation?.kind === 'STALE_WEAK_SUBJECT' &&
      recentTypeRecommendation.action.level ===
        staleSubjectRecommendation.action.level &&
      recentTypeRecommendation.action.subject ===
        staleSubjectRecommendation.action.subject
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recommendations'],
        message:
          '같은 level/subject의 WEAKNESS recommendation은 중복될 수 없습니다.'
      })
    }

    const dueRecommendation = response.recommendations.find(
      (item) => item.kind === 'DUE_REVIEW'
    )
    if (response.reviewQueueCounts.due > 0 !== Boolean(dueRecommendation)) {
      context.addIssue({
        code: 'custom',
        path: ['reviewQueueCounts', 'due'],
        message:
          'due count와 최우선 due recommendation 존재 여부가 일치해야 합니다.'
      })
    }

    const hasPersonalized = response.recommendations.some((item) =>
      [
        'DUE_REVIEW',
        'REPEATED_WRONG',
        'RECENT_LOW_ACCURACY_TYPE',
        'STALE_WEAK_SUBJECT'
      ].includes(item.kind)
    )
    const onlyTargetFallback =
      response.recommendations.length === 1 &&
      response.recommendations[0]?.kind === 'TARGET_LEVEL_PRACTICE'
    const setup = response.recommendations.find(
      (item) => item.kind === 'PRACTICE_SETUP'
    )
    if (setup && response.recommendations.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['recommendations'],
        message: 'practice setup fallback은 유일한 recommendation이어야 합니다.'
      })
    }
    const expectedFallback = hasPersonalized
      ? null
      : onlyTargetFallback
        ? 'NO_PERSONALIZED_EVIDENCE'
        : setup?.kind === 'PRACTICE_SETUP'
          ? setup.reason.code
          : null
    if (response.personalizationFallbackReason !== expectedFallback) {
      context.addIssue({
        code: 'custom',
        path: ['personalizationFallbackReason'],
        message:
          'personalization fallback reason이 recommendation과 일치해야 합니다.'
      })
    }
  })

export const getDashboardInsightsErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getDashboardInsightsErrorSchema = createApiFailureSchema(
  getDashboardInsightsErrorCodeSchema
)

export type GetDashboardInsightsQuery = z.input<
  typeof getDashboardInsightsQuerySchema
>
export type ParsedGetDashboardInsightsQuery = z.output<
  typeof getDashboardInsightsQuerySchema
>
export type DashboardInsightMetric = z.output<
  typeof dashboardInsightMetricSchema
>
export type DashboardInsightLevelStat = z.output<
  typeof dashboardInsightLevelStatSchema
>
export type DashboardInsightSubjectStat = z.output<
  typeof dashboardInsightSubjectStatSchema
>
export type DashboardInsightQuestionTypeStat = z.output<
  typeof dashboardInsightQuestionTypeStatSchema
>
export type DashboardInsightTagStat = z.output<
  typeof dashboardInsightTagStatSchema
>
export type DashboardWeakness = z.output<typeof dashboardWeaknessSchema>
export type DashboardRecommendationAction = z.output<
  typeof dashboardRecommendationActionSchema
>
export type DashboardRecommendation = z.output<
  typeof dashboardRecommendationSchema
>
export type GetDashboardInsightsResponse = z.output<
  typeof getDashboardInsightsResponseSchema
>
export type GetDashboardInsightsError = z.output<
  typeof getDashboardInsightsErrorSchema
>
