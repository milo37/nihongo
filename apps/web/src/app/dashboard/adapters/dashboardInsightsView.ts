import type { TFunction } from 'i18next'

import type {
  DashboardInsightMetric,
  DashboardRecommendation,
  DashboardRecommendationAction,
  DashboardWeakness,
  GetDashboardInsightsResponse
} from '@nihongo/contracts/dashboard/get-dashboard-insights'
import type { UiLocale } from '@/i18n/types'
import { formatDateTime, formatNumber } from '@libs/localeFormatters'

export interface DashboardViewLocalization {
  readonly locale: UiLocale
  readonly t: TFunction<'dashboard'>
  readonly commonT: TFunction<'common'>
}

const assertNever = (value: never): never => {
  throw new Error(`Unsupported dashboard insight value: ${String(value)}`)
}

export const formatDashboardBasisPoints = (
  basisPoints: number | null,
  localization: DashboardViewLocalization
): string => {
  if (basisPoints === null) {
    return localization.t('insights.projection.noSample')
  }

  return `${formatNumber(basisPoints / 100, localization.locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  })}%`
}

const formatDateTimeLabel = (
  value: string | null,
  localization: DashboardViewLocalization
): string =>
  value === null
    ? localization.t('insights.projection.noLearningRecord')
    : formatDateTime(value, localization.locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })

const formatCount = (
  value: number,
  localization: DashboardViewLocalization
): string => formatNumber(value, localization.locale)

export interface DashboardInsightMetricView extends DashboardInsightMetric {
  readonly averageElapsedLabel: string
  readonly correctRateLabel: string
  readonly lastAnsweredLabel: string
}

export interface DashboardInsightBreakdownView
  extends DashboardInsightMetricView {
  readonly id: string
  readonly label: string
}

export interface DashboardWeaknessView {
  readonly detail: string
  readonly key: string
  readonly scoreLabel: string
  readonly title: string
}

export interface DashboardRecommendationView {
  readonly action: DashboardRecommendationAction
  readonly actionLabel: string
  readonly actionSummary: string
  readonly kind: DashboardRecommendation['kind']
  readonly rank: number
  readonly reason: {
    readonly leading: string
    readonly japanesePreview: string | null
    readonly trailing: string
  }
  readonly title: string
}

const toPlainRecommendationReason = (
  value: string
): DashboardRecommendationView['reason'] => ({
  leading: value,
  japanesePreview: null,
  trailing: ''
})

export interface DashboardInsightsView {
  readonly observedAt: string
  readonly observedAtLabel: string
  readonly window: GetDashboardInsightsResponse['window']
  readonly stats: {
    readonly overall: DashboardInsightMetricView
    readonly byLevel: readonly DashboardInsightBreakdownView[]
    readonly bySubject: readonly DashboardInsightBreakdownView[]
    readonly byQuestionType: readonly DashboardInsightBreakdownView[]
    readonly byTag: readonly DashboardInsightBreakdownView[]
    readonly byTagTotal: number
    readonly byTagTruncated: boolean
  }
  readonly reviewQueueCounts: GetDashboardInsightsResponse['reviewQueueCounts']
  readonly weaknesses: readonly DashboardWeaknessView[]
  readonly recommendations: readonly DashboardRecommendationView[]
  readonly personalizationNotice: string | null
}

const toMetricView = (
  metric: DashboardInsightMetric,
  localization: DashboardViewLocalization
): DashboardInsightMetricView => ({
  ...metric,
  averageElapsedLabel:
    metric.averageElapsedSec === null
      ? localization.t('insights.projection.noSample')
      : localization.t('insights.projection.seconds', {
          value: formatCount(metric.averageElapsedSec, localization)
        }),
  correctRateLabel: formatDashboardBasisPoints(
    metric.correctRateBasisPoints,
    localization
  ),
  lastAnsweredLabel: formatDateTimeLabel(metric.lastAnsweredAt, localization)
})

const toWeaknessView = (
  weakness: DashboardWeakness,
  localization: DashboardViewLocalization
): DashboardWeaknessView => {
  const subject = localization.commonT(`taxonomy.subjects.${weakness.subject}`)
  const accuracy = formatDashboardBasisPoints(
    10_000 - weakness.errorRateBasisPoints,
    localization
  )
  const title = (() => {
    switch (weakness.dimension) {
      case 'SUBJECT':
        return `${weakness.level} ${subject}`
      case 'QUESTION_TYPE':
        return `${weakness.level} ${subject} · ${localization.commonT(
          `taxonomy.questionTypes.${weakness.questionType}`
        )}`
      case 'TAG':
        return `${weakness.level} ${subject} · #${weakness.tagLabel}`
      default:
        return assertNever(weakness)
    }
  })()

  return {
    detail: localization.t('insights.projection.weaknessDetail', {
      accuracy,
      attempted: formatCount(weakness.attemptedCount, localization),
      days: formatCount(weakness.ageDays, localization),
      incorrect: formatCount(weakness.incorrectCount, localization)
    }),
    key: weakness.key,
    scoreLabel: localization.t('insights.projection.weaknessScore', {
      score: formatCount(weakness.scoreBasisPoints, localization)
    }),
    title
  }
}

const toActionSummary = (
  action: DashboardRecommendationAction,
  localization: DashboardViewLocalization
): string => {
  switch (action.kind) {
    case 'START_SESSION':
      return localization.t('insights.projection.sessionSummary', {
        formattedCount: formatCount(action.count, localization),
        level: action.level,
        mode: localization.commonT(`taxonomy.studyModes.${action.mode}`),
        subject: localization.commonT(`taxonomy.subjects.${action.subject}`)
      })
    case 'START_TARGETED_REVIEW':
      return localization.t('insights.projection.targetedSummary')
    case 'OPEN_PRACTICE_SETUP':
      return localization.t('insights.projection.openSetupSummary')
    default:
      return assertNever(action)
  }
}

const toActionLabel = (
  action: DashboardRecommendationAction,
  localization: DashboardViewLocalization
): string => {
  switch (action.kind) {
    case 'START_SESSION':
      return localization.t('insights.projection.startMode', {
        mode: localization.commonT(`taxonomy.studyModes.${action.mode}`)
      })
    case 'START_TARGETED_REVIEW':
      return localization.t('insights.projection.startTargeted')
    case 'OPEN_PRACTICE_SETUP':
      return localization.t('insights.projection.openSetup')
    default:
      return assertNever(action)
  }
}

const toRecommendationView = (
  recommendation: DashboardRecommendation,
  localization: DashboardViewLocalization
): DashboardRecommendationView => {
  const content = (() => {
    switch (recommendation.kind) {
      case 'DUE_REVIEW':
        return {
          title: localization.t(
            'insights.projection.recommendation.DUE_REVIEW.title'
          ),
          reason: toPlainRecommendationReason(
            localization.t(
              'insights.projection.recommendation.DUE_REVIEW.reason',
              {
                formattedCount: formatCount(
                  recommendation.reason.dueCount,
                  localization
                ),
                date: formatDateTimeLabel(
                  recommendation.reason.earliestDueAt,
                  localization
                ),
                level: recommendation.reason.level,
                subject: localization.commonT(
                  `taxonomy.subjects.${recommendation.reason.subject}`
                )
              }
            )
          )
        }
      case 'REPEATED_WRONG':
        return {
          title: localization.t(
            'insights.projection.recommendation.REPEATED_WRONG.title'
          ),
          reason: {
            leading: localization.t(
              'insights.projection.recommendation.REPEATED_WRONG.reasonPrefix'
            ),
            japanesePreview: recommendation.reason.questionPreview,
            trailing: localization.t(
              'insights.projection.recommendation.REPEATED_WRONG.reasonSuffix',
              {
                formattedCount: formatCount(
                  recommendation.reason.wrongCount,
                  localization
                ),
                date: formatDateTimeLabel(
                  recommendation.reason.lastWrongAt,
                  localization
                )
              }
            )
          }
        }
      case 'RECENT_LOW_ACCURACY_TYPE':
        return {
          title: localization.t(
            'insights.projection.recommendation.RECENT_LOW_ACCURACY_TYPE.title'
          ),
          reason: toPlainRecommendationReason(
            localization.t(
              'insights.projection.recommendation.RECENT_LOW_ACCURACY_TYPE.reason',
              {
                accuracy: formatDashboardBasisPoints(
                  10_000 - recommendation.reason.errorRateBasisPoints,
                  localization
                ),
                attempted: formatCount(
                  recommendation.reason.attemptedCount,
                  localization
                ),
                incorrect: formatCount(
                  recommendation.reason.incorrectCount,
                  localization
                ),
                level: recommendation.action.level,
                questionType: localization.commonT(
                  `taxonomy.questionTypes.${recommendation.reason.questionType}`
                ),
                subject: localization.commonT(
                  `taxonomy.subjects.${recommendation.action.subject}`
                )
              }
            )
          )
        }
      case 'STALE_WEAK_SUBJECT':
        return {
          title: localization.t(
            'insights.projection.recommendation.STALE_WEAK_SUBJECT.title'
          ),
          reason: toPlainRecommendationReason(
            localization.t(
              'insights.projection.recommendation.STALE_WEAK_SUBJECT.reason',
              {
                attempted: formatCount(
                  recommendation.reason.attemptedCount,
                  localization
                ),
                days: formatCount(recommendation.reason.ageDays, localization),
                incorrect: formatCount(
                  recommendation.reason.incorrectCount,
                  localization
                ),
                level: recommendation.action.level,
                subject: localization.commonT(
                  `taxonomy.subjects.${recommendation.action.subject}`
                )
              }
            )
          )
        }
      case 'TARGET_LEVEL_PRACTICE':
        return {
          title: localization.t(
            'insights.projection.recommendation.TARGET_LEVEL_PRACTICE.title'
          ),
          reason: toPlainRecommendationReason(
            localization.t(
              'insights.projection.recommendation.TARGET_LEVEL_PRACTICE.reason',
              {
                catalogCount: formatCount(
                  recommendation.reason.catalogCount,
                  localization
                ),
                level: recommendation.reason.level,
                nonRecentCount: formatCount(
                  recommendation.reason.nonRecentCount,
                  localization
                ),
                subject: localization.commonT(
                  `taxonomy.subjects.${recommendation.reason.subject}`
                )
              }
            )
          )
        }
      case 'PRACTICE_SETUP': {
        const key =
          recommendation.reason.code === 'TARGET_LEVEL_NOT_SET'
            ? 'PRACTICE_SETUP_TARGET'
            : 'PRACTICE_SETUP_CATALOG'

        return {
          title: localization.t(
            `insights.projection.recommendation.${key}.title`
          ),
          reason: toPlainRecommendationReason(
            localization.t(`insights.projection.recommendation.${key}.reason`)
          )
        }
      }
      default:
        return assertNever(recommendation)
    }
  })()

  return {
    action: recommendation.action,
    actionLabel: toActionLabel(recommendation.action, localization),
    actionSummary: toActionSummary(recommendation.action, localization),
    kind: recommendation.kind,
    rank: recommendation.rank,
    ...content
  }
}

const toPersonalizationNotice = (
  reason: GetDashboardInsightsResponse['personalizationFallbackReason'],
  localization: DashboardViewLocalization
): string | null => {
  switch (reason) {
    case null:
      return null
    case 'NO_PERSONALIZED_EVIDENCE':
    case 'TARGET_LEVEL_NOT_SET':
    case 'NO_TARGET_CATALOG':
      return localization.t(`insights.projection.personalization.${reason}`)
    default:
      return assertNever(reason)
  }
}

export const toDashboardInsightsView = (
  response: GetDashboardInsightsResponse,
  localization: DashboardViewLocalization
): DashboardInsightsView => ({
  observedAt: response.observedAt,
  observedAtLabel: formatDateTimeLabel(response.observedAt, localization),
  window: response.window,
  stats: {
    overall: toMetricView(response.stats.overall, localization),
    byLevel: response.stats.byLevel.map((stat) => ({
      ...toMetricView(stat, localization),
      id: stat.level,
      label: stat.level
    })),
    bySubject: response.stats.bySubject.map((stat) => ({
      ...toMetricView(stat, localization),
      id: stat.subject,
      label: localization.commonT(`taxonomy.subjects.${stat.subject}`)
    })),
    byQuestionType: response.stats.byQuestionType.map((stat) => ({
      ...toMetricView(stat, localization),
      id: stat.questionType,
      label: localization.commonT(`taxonomy.questionTypes.${stat.questionType}`)
    })),
    byTag: response.stats.byTag.map((stat) => ({
      ...toMetricView(stat, localization),
      id: stat.tagId,
      label: stat.tagLabel
    })),
    byTagTotal: response.stats.byTagTotal,
    byTagTruncated: response.stats.byTagTruncated
  },
  reviewQueueCounts: response.reviewQueueCounts,
  weaknesses: response.weaknesses.map((weakness) =>
    toWeaknessView(weakness, localization)
  ),
  recommendations: response.recommendations.map((recommendation) =>
    toRecommendationView(recommendation, localization)
  ),
  personalizationNotice: toPersonalizationNotice(
    response.personalizationFallbackReason,
    localization
  )
})
