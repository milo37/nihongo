import type {
  DashboardInsightMetric,
  DashboardRecommendation,
  DashboardRecommendationAction,
  DashboardWeakness,
  GetDashboardInsightsResponse
} from '@nihongo/contracts/dashboard/get-dashboard-insights'

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const

const questionTypeLabels = {
  KANJI_READING: '한자 읽기',
  ORTHOGRAPHY: '표기',
  CONTEXT_VOCABULARY: '문맥 어휘',
  PARAPHRASE: '유의 표현',
  WORD_USAGE: '용법',
  GRAMMAR_SELECT: '문법 선택',
  SENTENCE_ORDER: '문장 배열',
  TEXT_GRAMMAR: '글 문법',
  SHORT_READING: '단문 독해',
  MEDIUM_READING: '중문 독해',
  LONG_READING: '장문 독해',
  INFO_RETRIEVAL: '정보 검색'
} as const

const modeLabels = {
  DAILY_REVIEW: '오늘 복습',
  WEAKNESS: '약점 연습',
  RANDOM: '일반 연습'
} as const

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

const assertNever = (value: never): never => {
  throw new Error(`지원하지 않는 대시보드 인사이트 값입니다: ${String(value)}`)
}

export const formatDashboardBasisPoints = (
  basisPoints: number | null
): string => {
  if (basisPoints === null) return '표본 없음'

  const whole = Math.trunc(basisPoints / 100)
  const fraction = basisPoints % 100
  if (fraction === 0) return `${whole}%`
  if (fraction % 10 === 0) return `${whole}.${fraction / 10}%`
  return `${whole}.${fraction.toString().padStart(2, '0')}%`
}

const formatDateTime = (value: string | null): string =>
  value === null ? '학습 기록 없음' : dateTimeFormatter.format(new Date(value))

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
  readonly reason: string
  readonly title: string
}

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
  metric: DashboardInsightMetric
): DashboardInsightMetricView => ({
  ...metric,
  averageElapsedLabel:
    metric.averageElapsedSec === null
      ? '표본 없음'
      : `${metric.averageElapsedSec}초`,
  correctRateLabel: formatDashboardBasisPoints(metric.correctRateBasisPoints),
  lastAnsweredLabel: formatDateTime(metric.lastAnsweredAt)
})

const toWeaknessView = (weakness: DashboardWeakness): DashboardWeaknessView => {
  const accuracyLabel = formatDashboardBasisPoints(
    10_000 - weakness.errorRateBasisPoints
  )
  const detail = `${weakness.attemptedCount}회 중 ${weakness.incorrectCount}회 오답 · 정답률 ${accuracyLabel} · 최근 ${weakness.ageDays}일`
  const title = (() => {
    switch (weakness.dimension) {
      case 'SUBJECT':
        return `${weakness.level} ${subjectLabels[weakness.subject]}`
      case 'QUESTION_TYPE':
        return `${weakness.level} ${subjectLabels[weakness.subject]} · ${questionTypeLabels[weakness.questionType]}`
      case 'TAG':
        return `${weakness.level} ${subjectLabels[weakness.subject]} · #${weakness.tagLabel}`
      default:
        return assertNever(weakness)
    }
  })()

  return {
    detail,
    key: weakness.key,
    scoreLabel: `약점 점수 ${weakness.scoreBasisPoints.toLocaleString('ko-KR')}`,
    title
  }
}

const toActionSummary = (action: DashboardRecommendationAction): string => {
  switch (action.kind) {
    case 'START_SESSION':
      return `${modeLabels[action.mode]} · ${action.level} ${subjectLabels[action.subject]} · ${action.count}문제`
    case 'START_TARGETED_REVIEW':
      return '반복 오답 1문제 집중 복습'
    case 'OPEN_PRACTICE_SETUP':
      return '연습 조건 설정 열기'
    default:
      return assertNever(action)
  }
}

const toActionLabel = (action: DashboardRecommendationAction): string => {
  switch (action.kind) {
    case 'START_SESSION':
      return `${modeLabels[action.mode]} 시작하기`
    case 'START_TARGETED_REVIEW':
      return '이 문제만 복습하기'
    case 'OPEN_PRACTICE_SETUP':
      return '연습 조건 설정 열기'
    default:
      return assertNever(action)
  }
}

const toRecommendationView = (
  recommendation: DashboardRecommendation
): DashboardRecommendationView => {
  const content = (() => {
    switch (recommendation.kind) {
      case 'DUE_REVIEW':
        return {
          title: '오늘 복습부터 시작하세요',
          reason: `${recommendation.reason.level} ${subjectLabels[recommendation.reason.subject]} 복습 예정 문제가 ${recommendation.reason.dueCount}개 있습니다. 가장 이른 예정 시각은 ${formatDateTime(recommendation.reason.earliestDueAt)}입니다.`
        }
      case 'REPEATED_WRONG':
        return {
          title: '반복해서 틀린 문제를 다시 확인하세요',
          reason: `“${recommendation.reason.questionPreview}” 문제를 ${recommendation.reason.wrongCount}회 틀렸습니다. 마지막 오답은 ${formatDateTime(recommendation.reason.lastWrongAt)}입니다.`
        }
      case 'RECENT_LOW_ACCURACY_TYPE':
        return {
          title: '최근 정확도가 낮은 유형을 연습하세요',
          reason: `${recommendation.action.level} ${subjectLabels[recommendation.action.subject]}의 ${questionTypeLabels[recommendation.reason.questionType]} 유형에서 ${recommendation.reason.attemptedCount}회 중 ${recommendation.reason.incorrectCount}회 틀렸습니다. 정답률은 ${formatDashboardBasisPoints(10_000 - recommendation.reason.errorRateBasisPoints)}입니다.`
        }
      case 'STALE_WEAK_SUBJECT':
        return {
          title: '오래 쉬었던 약한 과목을 다시 잡아보세요',
          reason: `${recommendation.action.level} ${subjectLabels[recommendation.action.subject]}의 마지막 약점 근거가 ${recommendation.reason.ageDays}일 전입니다. ${recommendation.reason.attemptedCount}회 중 ${recommendation.reason.incorrectCount}회 틀렸습니다.`
        }
      case 'TARGET_LEVEL_PRACTICE':
        return {
          title: '목표 급수의 다음 문제를 풀어보세요',
          reason: `${recommendation.reason.level} ${subjectLabels[recommendation.reason.subject]} 문제 ${recommendation.reason.catalogCount}개 중 ${recommendation.reason.nonRecentCount}개가 최근 3개 세션 밖에 있어 우선 연습할 수 있습니다.`
        }
      case 'PRACTICE_SETUP':
        return recommendation.reason.code === 'TARGET_LEVEL_NOT_SET'
          ? {
              title: '목표 급수를 먼저 설정해 주세요',
              reason:
                '목표 급수가 정해지면 현재 공개된 문제 안에서 다음 연습을 추천합니다.'
            }
          : {
              title: '연습 조건을 다시 선택해 주세요',
              reason:
                '현재 목표 급수에 공개된 문제가 없어 다른 급수나 과목을 선택해야 합니다.'
            }
      default:
        return assertNever(recommendation)
    }
  })()

  return {
    action: recommendation.action,
    actionLabel: toActionLabel(recommendation.action),
    actionSummary: toActionSummary(recommendation.action),
    kind: recommendation.kind,
    rank: recommendation.rank,
    ...content
  }
}

const toPersonalizationNotice = (
  reason: GetDashboardInsightsResponse['personalizationFallbackReason']
): string | null => {
  switch (reason) {
    case null:
      return null
    case 'NO_PERSONALIZED_EVIDENCE':
      return '개인화 근거가 아직 충분하지 않아 목표 급수의 일반 연습을 함께 추천합니다.'
    case 'TARGET_LEVEL_NOT_SET':
      return '목표 급수가 없어 연습 조건 설정을 안내합니다.'
    case 'NO_TARGET_CATALOG':
      return '현재 목표 급수에 공개된 문제가 없어 연습 조건 설정을 안내합니다.'
    default:
      return assertNever(reason)
  }
}

export const toDashboardInsightsView = (
  response: GetDashboardInsightsResponse
): DashboardInsightsView => ({
  observedAt: response.observedAt,
  observedAtLabel: formatDateTime(response.observedAt),
  window: response.window,
  stats: {
    overall: toMetricView(response.stats.overall),
    byLevel: response.stats.byLevel.map((stat) => ({
      ...toMetricView(stat),
      id: stat.level,
      label: stat.level
    })),
    bySubject: response.stats.bySubject.map((stat) => ({
      ...toMetricView(stat),
      id: stat.subject,
      label: subjectLabels[stat.subject]
    })),
    byQuestionType: response.stats.byQuestionType.map((stat) => ({
      ...toMetricView(stat),
      id: stat.questionType,
      label: questionTypeLabels[stat.questionType]
    })),
    byTag: response.stats.byTag.map((stat) => ({
      ...toMetricView(stat),
      id: stat.tagId,
      label: stat.tagLabel
    })),
    byTagTotal: response.stats.byTagTotal,
    byTagTruncated: response.stats.byTagTruncated
  },
  reviewQueueCounts: response.reviewQueueCounts,
  weaknesses: response.weaknesses.map(toWeaknessView),
  recommendations: response.recommendations.map(toRecommendationView),
  personalizationNotice: toPersonalizationNotice(
    response.personalizationFallbackReason
  )
})
