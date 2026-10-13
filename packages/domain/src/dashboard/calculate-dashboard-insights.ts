export const DASHBOARD_INSIGHT_WINDOW_DAYS = 90 as const
export const DASHBOARD_WEAKNESS_MIN_ATTEMPTS = 5 as const
export const DASHBOARD_WEAKNESS_FULL_CONFIDENCE_ATTEMPTS = 20 as const
export const DASHBOARD_RECOMMENDATION_LIMIT = 5 as const

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000
const BASIS_POINTS = 10_000n
const SCORE_DENOMINATOR = 1_000_000_000_000n

const LEVEL_ORDER = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
const SUBJECT_ORDER = ['VOCABULARY', 'GRAMMAR', 'READING'] as const
const QUESTION_TYPE_ORDER = [
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

const VOCABULARY_QUESTION_TYPES = QUESTION_TYPE_ORDER.slice(0, 5)
const GRAMMAR_QUESTION_TYPES = QUESTION_TYPE_ORDER.slice(5, 8)
const READING_QUESTION_TYPES_BY_LEVEL = {
  N5: ['SHORT_READING', 'INFO_RETRIEVAL'],
  N4: ['SHORT_READING', 'INFO_RETRIEVAL'],
  N3: ['SHORT_READING', 'MEDIUM_READING', 'INFO_RETRIEVAL'],
  N2: ['MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL'],
  N1: ['MEDIUM_READING', 'LONG_READING', 'INFO_RETRIEVAL']
} as const satisfies Record<
  (typeof LEVEL_ORDER)[number],
  readonly (typeof QUESTION_TYPE_ORDER)[number][]
>

export type DashboardInsightLevel = (typeof LEVEL_ORDER)[number]
export type DashboardInsightSubject = (typeof SUBJECT_ORDER)[number]
export type DashboardInsightQuestionType = (typeof QUESTION_TYPE_ORDER)[number]
export type DashboardWeaknessDimension = 'SUBJECT' | 'QUESTION_TYPE' | 'TAG'

interface DashboardWeaknessCandidateBase {
  readonly attemptedCount: number
  readonly incorrectCount: number
  readonly key: string
  readonly lastAnsweredAt: Date
  readonly level: DashboardInsightLevel
  readonly repeatExtra: number
  readonly subject: DashboardInsightSubject
}

export interface DashboardSubjectWeaknessCandidate
  extends DashboardWeaknessCandidateBase {
  readonly dimension: 'SUBJECT'
}

export interface DashboardQuestionTypeWeaknessCandidate
  extends DashboardWeaknessCandidateBase {
  readonly dimension: 'QUESTION_TYPE'
  readonly questionType: DashboardInsightQuestionType
}

export interface DashboardTagWeaknessCandidate
  extends DashboardWeaknessCandidateBase {
  readonly dimension: 'TAG'
  readonly tagId: string
  readonly tagLabel: string
}

export type DashboardWeaknessCandidate =
  | DashboardSubjectWeaknessCandidate
  | DashboardQuestionTypeWeaknessCandidate
  | DashboardTagWeaknessCandidate

export type DashboardScoredWeakness = DashboardWeaknessCandidate & {
  readonly ageDays: number
  readonly errorRateBasisPoints: number
  readonly recencyWeightBasisPoints: 5_500 | 7_000 | 8_500 | 10_000
  readonly repeatWeightBasisPoints: number
  readonly sampleConfidenceBasisPoints: number
  readonly scoreBasisPoints: number
}

export type DashboardInsightCalculationErrorCode =
  | 'DUPLICATE_WEAKNESS_KEY'
  | 'INVALID_COUNT'
  | 'INVALID_DATE'
  | 'INVALID_LIMIT'
  | 'INVALID_RECOMMENDATION_INPUT'

export class DashboardInsightCalculationError extends Error {
  readonly code: DashboardInsightCalculationErrorCode

  constructor(code: DashboardInsightCalculationErrorCode, message: string) {
    super(message)
    this.name = 'DashboardInsightCalculationError'
    this.code = code
  }
}

const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1

const enumIndex = <Value extends string>(
  values: readonly Value[],
  value: Value
): number => values.indexOf(value)

const assertSafeNonNegativeInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DashboardInsightCalculationError(
      'INVALID_COUNT',
      `${field}는 0 이상의 safe integer여야 합니다.`
    )
  }
}

const assertValidDate = (value: Date, field: string): void => {
  if (!Number.isFinite(value.getTime())) {
    throw new DashboardInsightCalculationError(
      'INVALID_DATE',
      `${field}는 유효한 시각이어야 합니다.`
    )
  }
}

const isApplicableQuestionType = (
  level: DashboardInsightLevel,
  subject: DashboardInsightSubject,
  questionType: DashboardInsightQuestionType
): boolean => {
  if (subject === 'VOCABULARY') {
    return VOCABULARY_QUESTION_TYPES.includes(questionType)
  }
  if (subject === 'GRAMMAR') {
    return GRAMMAR_QUESTION_TYPES.includes(questionType)
  }
  return READING_QUESTION_TYPES_BY_LEVEL[level].includes(questionType as never)
}

const createWeaknessKey = (candidate: DashboardWeaknessCandidate): string => {
  switch (candidate.dimension) {
    case 'SUBJECT':
      return `SUBJECT|${candidate.level}|${candidate.subject}`
    case 'QUESTION_TYPE':
      return `QUESTION_TYPE|${candidate.level}|${candidate.subject}|${candidate.questionType}`
    case 'TAG':
      return `TAG|${candidate.level}|${candidate.subject}|${candidate.tagId}`
  }
}

const divideRoundHalfUp = (numerator: bigint, denominator: bigint): bigint => {
  if (numerator < 0n || denominator <= 0n) {
    throw new DashboardInsightCalculationError(
      'INVALID_COUNT',
      '반올림 입력은 non-negative numerator와 positive denominator여야 합니다.'
    )
  }
  return (numerator + denominator / 2n) / denominator
}

const toSafeNumber = (value: bigint, field: string): number => {
  const converted = Number(value)
  if (!Number.isSafeInteger(converted) || BigInt(converted) !== value) {
    throw new DashboardInsightCalculationError(
      'INVALID_COUNT',
      `${field}가 safe integer 범위를 벗어났습니다.`
    )
  }
  return converted
}

const getRecencyWeight = (
  ageDays: number
): DashboardScoredWeakness['recencyWeightBasisPoints'] => {
  if (ageDays <= 6) {
    return 10_000
  }
  if (ageDays <= 29) {
    return 8_500
  }
  if (ageDays <= 59) {
    return 7_000
  }
  return 5_500
}

export const calculateDashboardWeakness = (
  candidate: DashboardWeaknessCandidate,
  observedAt: Date
): DashboardScoredWeakness | null => {
  assertValidDate(observedAt, 'observedAt')
  assertValidDate(candidate.lastAnsweredAt, 'lastAnsweredAt')
  assertSafeNonNegativeInteger(candidate.attemptedCount, 'attemptedCount')
  assertSafeNonNegativeInteger(candidate.incorrectCount, 'incorrectCount')
  assertSafeNonNegativeInteger(candidate.repeatExtra, 'repeatExtra')

  if (
    !LEVEL_ORDER.includes(candidate.level) ||
    !SUBJECT_ORDER.includes(candidate.subject) ||
    (candidate.dimension === 'QUESTION_TYPE' &&
      (!QUESTION_TYPE_ORDER.includes(candidate.questionType) ||
        !isApplicableQuestionType(
          candidate.level,
          candidate.subject,
          candidate.questionType
        ))) ||
    (candidate.dimension === 'TAG' &&
      (candidate.tagId.trim().length === 0 ||
        candidate.tagLabel.trim().length === 0 ||
        [...candidate.tagLabel].length > 100)) ||
    candidate.key !== createWeaknessKey(candidate)
  ) {
    throw new DashboardInsightCalculationError(
      'INVALID_RECOMMENDATION_INPUT',
      'weakness taxonomy와 canonical identity가 일치해야 합니다.'
    )
  }
  if (
    candidate.incorrectCount > candidate.attemptedCount ||
    candidate.repeatExtra > Math.max(0, candidate.incorrectCount - 1)
  ) {
    throw new DashboardInsightCalculationError(
      'INVALID_COUNT',
      '오답 수 또는 repeatExtra가 attempt 불변식을 위반했습니다.'
    )
  }

  const ageMilliseconds =
    observedAt.getTime() - candidate.lastAnsweredAt.getTime()
  if (
    ageMilliseconds < 0 ||
    ageMilliseconds > DASHBOARD_INSIGHT_WINDOW_DAYS * DAY_MILLISECONDS
  ) {
    throw new DashboardInsightCalculationError(
      'INVALID_DATE',
      'lastAnsweredAt은 insights 분석 window 안에 있어야 합니다.'
    )
  }

  if (
    candidate.attemptedCount < DASHBOARD_WEAKNESS_MIN_ATTEMPTS ||
    candidate.incorrectCount === 0
  ) {
    return null
  }

  const attempted = BigInt(candidate.attemptedCount)
  const incorrect = BigInt(candidate.incorrectCount)
  const repeatExtra = BigInt(candidate.repeatExtra)
  const errorRateBasisPoints = toSafeNumber(
    divideRoundHalfUp(incorrect * BASIS_POINTS, attempted),
    'errorRateBasisPoints'
  )
  const repeatWeightBasisPoints = toSafeNumber(
    BASIS_POINTS + divideRoundHalfUp(repeatExtra * 5_000n, incorrect),
    'repeatWeightBasisPoints'
  )
  const sampleConfidenceBasisPoints =
    candidate.attemptedCount >= DASHBOARD_WEAKNESS_FULL_CONFIDENCE_ATTEMPTS
      ? 10_000
      : Number(BigInt(candidate.attemptedCount) * 500n)
  const ageDays = Math.floor(ageMilliseconds / DAY_MILLISECONDS)
  const recencyWeightBasisPoints = getRecencyWeight(ageDays)
  const scoreBasisPoints = toSafeNumber(
    divideRoundHalfUp(
      BigInt(errorRateBasisPoints) *
        BigInt(recencyWeightBasisPoints) *
        BigInt(repeatWeightBasisPoints) *
        BigInt(sampleConfidenceBasisPoints),
      SCORE_DENOMINATOR
    ),
    'scoreBasisPoints'
  )

  return {
    ...candidate,
    ageDays,
    errorRateBasisPoints,
    recencyWeightBasisPoints,
    repeatWeightBasisPoints,
    sampleConfidenceBasisPoints,
    scoreBasisPoints
  }
}

const getDimensionOrder = (dimension: DashboardWeaknessDimension): number => {
  switch (dimension) {
    case 'SUBJECT':
      return 0
    case 'QUESTION_TYPE':
      return 1
    case 'TAG':
      return 2
  }
}

export const compareDashboardWeaknesses = (
  left: DashboardScoredWeakness,
  right: DashboardScoredWeakness
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
  const recentOrder =
    right.lastAnsweredAt.getTime() - left.lastAnsweredAt.getTime()
  if (recentOrder !== 0) {
    return recentOrder
  }
  const dimensionOrder =
    getDimensionOrder(left.dimension) - getDimensionOrder(right.dimension)
  if (dimensionOrder !== 0) {
    return dimensionOrder
  }
  const levelOrder =
    enumIndex(LEVEL_ORDER, left.level) - enumIndex(LEVEL_ORDER, right.level)
  if (levelOrder !== 0) {
    return levelOrder
  }
  const subjectOrder =
    enumIndex(SUBJECT_ORDER, left.subject) -
    enumIndex(SUBJECT_ORDER, right.subject)
  if (subjectOrder !== 0) {
    return subjectOrder
  }
  if (
    left.dimension === 'QUESTION_TYPE' &&
    right.dimension === 'QUESTION_TYPE'
  ) {
    const typeOrder =
      enumIndex(QUESTION_TYPE_ORDER, left.questionType) -
      enumIndex(QUESTION_TYPE_ORDER, right.questionType)
    if (typeOrder !== 0) {
      return typeOrder
    }
  }
  return compareText(left.key, right.key)
}

export const selectTopDashboardWeaknesses = (
  candidates: readonly DashboardWeaknessCandidate[],
  observedAt: Date,
  limit: number
): DashboardScoredWeakness[] => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new DashboardInsightCalculationError(
      'INVALID_LIMIT',
      'weakness limit는 1..100 safe integer여야 합니다.'
    )
  }

  const keys = new Set<string>()
  const selected: DashboardScoredWeakness[] = []

  for (const candidate of candidates) {
    if (keys.has(candidate.key)) {
      throw new DashboardInsightCalculationError(
        'DUPLICATE_WEAKNESS_KEY',
        `weakness key가 중복됐습니다: ${candidate.key}`
      )
    }
    keys.add(candidate.key)
    const scored = calculateDashboardWeakness(candidate, observedAt)
    if (!scored) {
      continue
    }

    let insertAt = selected.findIndex(
      (current) => compareDashboardWeaknesses(scored, current) < 0
    )
    if (insertAt === -1) {
      insertAt = selected.length
    }
    if (insertAt < limit) {
      selected.splice(insertAt, 0, scored)
      if (selected.length > limit) {
        selected.pop()
      }
    }
  }

  return selected
}

export interface DashboardDueRecommendationGroup {
  readonly dueCount: number
  readonly earliestDueAt: Date
  readonly level: DashboardInsightLevel
  readonly subject: DashboardInsightSubject
}

export interface DashboardRepeatedWrongCandidate {
  readonly isDue: boolean
  readonly lastWrongAt: Date
  readonly level: DashboardInsightLevel
  readonly questionId: string
  readonly questionPreview: string
  readonly status: 'NEW' | 'REVIEWING' | 'AGAIN'
  readonly subject: DashboardInsightSubject
  readonly wrongCount: number
}

export interface DashboardTargetPracticeCandidate {
  readonly catalogCount: number
  readonly lastStudiedAt: Date | null
  readonly level: DashboardInsightLevel
  readonly nonRecentCount: number
  readonly subject: DashboardInsightSubject
}

export interface DashboardStartSessionAction {
  readonly count: 5 | 10 | 20
  readonly kind: 'START_SESSION'
  readonly level: DashboardInsightLevel
  readonly mode: 'DAILY_REVIEW' | 'WEAKNESS' | 'RANDOM'
  readonly subject: DashboardInsightSubject
}

export interface DashboardStartTargetedReviewAction {
  readonly kind: 'START_TARGETED_REVIEW'
  readonly questionId: string
}

export interface DashboardOpenPracticeSetupAction {
  readonly kind: 'OPEN_PRACTICE_SETUP'
}

export type DashboardRecommendationAction =
  | DashboardStartSessionAction
  | DashboardStartTargetedReviewAction
  | DashboardOpenPracticeSetupAction

interface RankedRecommendation {
  readonly rank: number
}

export interface DashboardDueRecommendation extends RankedRecommendation {
  readonly action: DashboardStartSessionAction & {
    readonly mode: 'DAILY_REVIEW'
  }
  readonly kind: 'DUE_REVIEW'
  readonly reason: {
    readonly code: 'DUE_REVIEW_COUNT'
    readonly dueCount: number
    readonly earliestDueAt: Date
    readonly level: DashboardInsightLevel
    readonly subject: DashboardInsightSubject
  }
}

export interface DashboardRepeatedWrongRecommendation
  extends RankedRecommendation {
  readonly action: DashboardStartTargetedReviewAction
  readonly kind: 'REPEATED_WRONG'
  readonly reason: {
    readonly code: 'REPEATED_WRONG_COUNT'
    readonly lastWrongAt: Date
    readonly level: DashboardInsightLevel
    readonly questionId: string
    readonly questionPreview: string
    readonly subject: DashboardInsightSubject
    readonly wrongCount: number
  }
}

export interface DashboardRecentTypeRecommendation
  extends RankedRecommendation {
  readonly action: DashboardStartSessionAction & { readonly mode: 'WEAKNESS' }
  readonly kind: 'RECENT_LOW_ACCURACY_TYPE'
  readonly reason: {
    readonly actionableCandidateCount: number
    readonly attemptedCount: number
    readonly code: 'RECENT_LOW_ACCURACY_TYPE'
    readonly errorRateBasisPoints: number
    readonly incorrectCount: number
    readonly questionType: DashboardInsightQuestionType
    readonly scoreBasisPoints: number
  }
}

export interface DashboardStaleSubjectRecommendation
  extends RankedRecommendation {
  readonly action: DashboardStartSessionAction & { readonly mode: 'WEAKNESS' }
  readonly kind: 'STALE_WEAK_SUBJECT'
  readonly reason: {
    readonly actionableCandidateCount: number
    readonly ageDays: number
    readonly attemptedCount: number
    readonly code: 'STALE_WEAK_SUBJECT'
    readonly errorRateBasisPoints: number
    readonly incorrectCount: number
    readonly scoreBasisPoints: number
  }
}

export interface DashboardTargetLevelRecommendation
  extends RankedRecommendation {
  readonly action: DashboardStartSessionAction & { readonly mode: 'RANDOM' }
  readonly kind: 'TARGET_LEVEL_PRACTICE'
  readonly reason: {
    readonly catalogCount: number
    readonly code: 'TARGET_LEVEL_RECENT_GAP'
    readonly lastStudiedAt: Date | null
    readonly level: DashboardInsightLevel
    readonly nonRecentCount: number
    readonly subject: DashboardInsightSubject
  }
}

export interface DashboardPracticeSetupRecommendation
  extends RankedRecommendation {
  readonly action: DashboardOpenPracticeSetupAction
  readonly kind: 'PRACTICE_SETUP'
  readonly reason: {
    readonly code: 'TARGET_LEVEL_NOT_SET' | 'NO_TARGET_CATALOG'
  }
}

export type DashboardRecommendation =
  | DashboardDueRecommendation
  | DashboardRepeatedWrongRecommendation
  | DashboardRecentTypeRecommendation
  | DashboardStaleSubjectRecommendation
  | DashboardTargetLevelRecommendation
  | DashboardPracticeSetupRecommendation

export type DashboardPersonalizationFallbackReason =
  | 'NO_PERSONALIZED_EVIDENCE'
  | 'TARGET_LEVEL_NOT_SET'
  | 'NO_TARGET_CATALOG'
  | null

export interface BuildDashboardRecommendationsInput {
  readonly actionableWeaknessCandidateCountByLevelSubject: ReadonlyMap<
    string,
    number
  >
  readonly dueGroups: readonly DashboardDueRecommendationGroup[]
  readonly repeatedWrongCandidates: readonly DashboardRepeatedWrongCandidate[]
  readonly targetLevel: DashboardInsightLevel | null
  readonly targetPracticeCandidates: readonly DashboardTargetPracticeCandidate[]
  readonly weaknesses: readonly DashboardScoredWeakness[]
}

export interface DashboardRecommendationResult {
  readonly personalizationFallbackReason: DashboardPersonalizationFallbackReason
  readonly recommendations: readonly DashboardRecommendation[]
}

export const createLevelSubjectKey = (
  level: DashboardInsightLevel,
  subject: DashboardInsightSubject
): string => `${level}|${subject}`

export const toDashboardSetupCount = (count: number): 5 | 10 | 20 => {
  assertSafeNonNegativeInteger(count, 'actionableCount')
  if (count < 1) {
    throw new DashboardInsightCalculationError(
      'INVALID_RECOMMENDATION_INPUT',
      'actionableCount는 1 이상이어야 합니다.'
    )
  }
  return count >= 20 ? 20 : count >= 10 ? 10 : 5
}

const isLowAccuracy = (weakness: DashboardScoredWeakness): boolean =>
  BigInt(weakness.incorrectCount) * 10_000n >=
  BigInt(weakness.attemptedCount) * 4_000n

const getActionKey = (action: DashboardRecommendationAction): string => {
  switch (action.kind) {
    case 'START_SESSION':
      return [
        'SESSION',
        action.mode,
        action.level,
        action.subject,
        action.count
      ].join('|')
    case 'START_TARGETED_REVIEW':
      return `TARGETED|${action.questionId}`
    case 'OPEN_PRACTICE_SETUP':
      return 'SETUP'
  }
}

const chooseDueGroup = (
  groups: readonly DashboardDueRecommendationGroup[],
  targetLevel: DashboardInsightLevel | null
): DashboardDueRecommendationGroup | null => {
  let selected: DashboardDueRecommendationGroup | null = null
  for (const group of groups) {
    assertSafeNonNegativeInteger(group.dueCount, 'dueCount')
    assertValidDate(group.earliestDueAt, 'earliestDueAt')
    if (group.dueCount < 1) {
      throw new DashboardInsightCalculationError(
        'INVALID_RECOMMENDATION_INPUT',
        'due group count는 1 이상이어야 합니다.'
      )
    }
    if (!selected) {
      selected = group
      continue
    }
    const timeOrder =
      group.earliestDueAt.getTime() - selected.earliestDueAt.getTime()
    const countOrder = selected.dueCount - group.dueCount
    const targetOrder =
      Number(selected.level === targetLevel) -
      Number(group.level === targetLevel)
    const levelOrder =
      enumIndex(LEVEL_ORDER, group.level) -
      enumIndex(LEVEL_ORDER, selected.level)
    const subjectOrder =
      enumIndex(SUBJECT_ORDER, group.subject) -
      enumIndex(SUBJECT_ORDER, selected.subject)
    if (
      timeOrder < 0 ||
      (timeOrder === 0 && countOrder < 0) ||
      (timeOrder === 0 && countOrder === 0 && targetOrder < 0) ||
      (timeOrder === 0 &&
        countOrder === 0 &&
        targetOrder === 0 &&
        levelOrder < 0) ||
      (timeOrder === 0 &&
        countOrder === 0 &&
        targetOrder === 0 &&
        levelOrder === 0 &&
        subjectOrder < 0)
    ) {
      selected = group
    }
  }
  return selected
}

const chooseRepeatedWrong = (
  candidates: readonly DashboardRepeatedWrongCandidate[]
): DashboardRepeatedWrongCandidate | null => {
  let selected: DashboardRepeatedWrongCandidate | null = null
  const ids = new Set<string>()
  for (const candidate of candidates) {
    if (ids.has(candidate.questionId)) {
      throw new DashboardInsightCalculationError(
        'INVALID_RECOMMENDATION_INPUT',
        `repeated candidate가 중복됐습니다: ${candidate.questionId}`
      )
    }
    ids.add(candidate.questionId)
    assertSafeNonNegativeInteger(candidate.wrongCount, 'wrongCount')
    assertValidDate(candidate.lastWrongAt, 'lastWrongAt')
    if (candidate.wrongCount < 2 || candidate.isDue) {
      continue
    }
    if (
      !selected ||
      candidate.wrongCount > selected.wrongCount ||
      (candidate.wrongCount === selected.wrongCount &&
        candidate.lastWrongAt.getTime() > selected.lastWrongAt.getTime()) ||
      (candidate.wrongCount === selected.wrongCount &&
        candidate.lastWrongAt.getTime() === selected.lastWrongAt.getTime() &&
        compareText(candidate.questionId, selected.questionId) < 0)
    ) {
      selected = candidate
    }
  }
  return selected
}

const chooseWeakness = (
  weaknesses: readonly DashboardScoredWeakness[],
  dimension: 'QUESTION_TYPE' | 'SUBJECT',
  actionableCounts: ReadonlyMap<string, number>,
  minimumAgeDays: number,
  maximumAgeDays: number
): DashboardScoredWeakness | null => {
  let selected: DashboardScoredWeakness | null = null
  for (const weakness of weaknesses) {
    if (
      weakness.dimension !== dimension ||
      weakness.ageDays < minimumAgeDays ||
      weakness.ageDays > maximumAgeDays ||
      !isLowAccuracy(weakness)
    ) {
      continue
    }
    const actionableCount =
      actionableCounts.get(
        createLevelSubjectKey(weakness.level, weakness.subject)
      ) ?? 0
    assertSafeNonNegativeInteger(
      actionableCount,
      'actionableWeaknessCandidateCount'
    )
    if (actionableCount === 0) {
      continue
    }
    if (!selected || compareDashboardWeaknesses(weakness, selected) < 0) {
      selected = weakness
    }
  }
  return selected
}

const chooseTargetPractice = (
  candidates: readonly DashboardTargetPracticeCandidate[],
  targetLevel: DashboardInsightLevel | null
): DashboardTargetPracticeCandidate | null => {
  let selected: DashboardTargetPracticeCandidate | null = null
  const identities = new Set<string>()
  for (const candidate of candidates) {
    const identity = createLevelSubjectKey(candidate.level, candidate.subject)
    if (identities.has(identity)) {
      throw new DashboardInsightCalculationError(
        'INVALID_RECOMMENDATION_INPUT',
        `target practice candidate가 중복됐습니다: ${identity}`
      )
    }
    identities.add(identity)
    assertSafeNonNegativeInteger(candidate.catalogCount, 'catalogCount')
    assertSafeNonNegativeInteger(candidate.nonRecentCount, 'nonRecentCount')
    if (candidate.lastStudiedAt) {
      assertValidDate(candidate.lastStudiedAt, 'lastStudiedAt')
    }
    if (candidate.nonRecentCount > candidate.catalogCount) {
      throw new DashboardInsightCalculationError(
        'INVALID_RECOMMENDATION_INPUT',
        'target practice nonRecentCount는 catalogCount를 초과할 수 없습니다.'
      )
    }
    if (candidate.level !== targetLevel || candidate.catalogCount < 1) {
      continue
    }
    if (!selected) {
      selected = candidate
      continue
    }
    const nonRecentAvailabilityOrder =
      Number(selected.nonRecentCount > 0) - Number(candidate.nonRecentCount > 0)
    const studiedOrder =
      candidate.lastStudiedAt === null && selected.lastStudiedAt === null
        ? 0
        : candidate.lastStudiedAt === null
          ? -1
          : selected.lastStudiedAt === null
            ? 1
            : candidate.lastStudiedAt.getTime() -
              selected.lastStudiedAt.getTime()
    const nonRecentCountOrder =
      selected.nonRecentCount - candidate.nonRecentCount
    const catalogCountOrder = selected.catalogCount - candidate.catalogCount
    const subjectOrder =
      enumIndex(SUBJECT_ORDER, candidate.subject) -
      enumIndex(SUBJECT_ORDER, selected.subject)
    if (
      nonRecentAvailabilityOrder < 0 ||
      (nonRecentAvailabilityOrder === 0 && studiedOrder < 0) ||
      (nonRecentAvailabilityOrder === 0 &&
        studiedOrder === 0 &&
        nonRecentCountOrder < 0) ||
      (nonRecentAvailabilityOrder === 0 &&
        studiedOrder === 0 &&
        nonRecentCountOrder === 0 &&
        catalogCountOrder < 0) ||
      (nonRecentAvailabilityOrder === 0 &&
        studiedOrder === 0 &&
        nonRecentCountOrder === 0 &&
        catalogCountOrder === 0 &&
        subjectOrder < 0)
    ) {
      selected = candidate
    }
  }
  return selected
}

export const buildDashboardRecommendations = (
  input: BuildDashboardRecommendationsInput
): DashboardRecommendationResult => {
  const recommendations: DashboardRecommendation[] = []
  const actionKeys = new Set<string>()
  const dueGroupKeys = new Set<string>()
  for (const group of input.dueGroups) {
    const groupKey = createLevelSubjectKey(group.level, group.subject)
    if (dueGroupKeys.has(groupKey)) {
      throw new DashboardInsightCalculationError(
        'INVALID_RECOMMENDATION_INPUT',
        `due group이 중복됐습니다: ${groupKey}`
      )
    }
    dueGroupKeys.add(groupKey)
  }

  const append = (
    recommendation: Omit<DashboardRecommendation, 'rank'>
  ): void => {
    const actionKey = getActionKey(recommendation.action)
    if (actionKeys.has(actionKey)) {
      return
    }
    actionKeys.add(actionKey)
    recommendations.push({
      ...recommendation,
      rank: recommendations.length + 1
    } as DashboardRecommendation)
  }

  const due = chooseDueGroup(input.dueGroups, input.targetLevel)
  if (due) {
    append({
      kind: 'DUE_REVIEW',
      reason: {
        code: 'DUE_REVIEW_COUNT',
        dueCount: due.dueCount,
        earliestDueAt: due.earliestDueAt,
        level: due.level,
        subject: due.subject
      },
      action: {
        kind: 'START_SESSION',
        mode: 'DAILY_REVIEW',
        level: due.level,
        subject: due.subject,
        count: toDashboardSetupCount(due.dueCount)
      }
    })
  }

  const repeated = chooseRepeatedWrong(input.repeatedWrongCandidates)
  if (repeated) {
    append({
      kind: 'REPEATED_WRONG',
      reason: {
        code: 'REPEATED_WRONG_COUNT',
        level: repeated.level,
        subject: repeated.subject,
        questionId: repeated.questionId,
        questionPreview: repeated.questionPreview,
        wrongCount: repeated.wrongCount,
        lastWrongAt: repeated.lastWrongAt
      },
      action: {
        kind: 'START_TARGETED_REVIEW',
        questionId: repeated.questionId
      }
    })
  }

  const recentType = chooseWeakness(
    input.weaknesses,
    'QUESTION_TYPE',
    input.actionableWeaknessCandidateCountByLevelSubject,
    0,
    29
  )
  if (recentType?.dimension === 'QUESTION_TYPE') {
    const actionableCandidateCount =
      input.actionableWeaknessCandidateCountByLevelSubject.get(
        createLevelSubjectKey(recentType.level, recentType.subject)
      ) ?? 0
    append({
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
      action: {
        kind: 'START_SESSION',
        mode: 'WEAKNESS',
        level: recentType.level,
        subject: recentType.subject,
        count: toDashboardSetupCount(actionableCandidateCount)
      }
    })
  }

  const staleSubject = chooseWeakness(
    input.weaknesses,
    'SUBJECT',
    input.actionableWeaknessCandidateCountByLevelSubject,
    30,
    90
  )
  if (staleSubject?.dimension === 'SUBJECT') {
    const actionableCandidateCount =
      input.actionableWeaknessCandidateCountByLevelSubject.get(
        createLevelSubjectKey(staleSubject.level, staleSubject.subject)
      ) ?? 0
    append({
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
      action: {
        kind: 'START_SESSION',
        mode: 'WEAKNESS',
        level: staleSubject.level,
        subject: staleSubject.subject,
        count: toDashboardSetupCount(actionableCandidateCount)
      }
    })
  }

  const personalizedCount = recommendations.length
  const targetPractice = chooseTargetPractice(
    input.targetPracticeCandidates,
    input.targetLevel
  )
  if (targetPractice) {
    append({
      kind: 'TARGET_LEVEL_PRACTICE',
      reason: {
        code: 'TARGET_LEVEL_RECENT_GAP',
        catalogCount: targetPractice.catalogCount,
        nonRecentCount: targetPractice.nonRecentCount,
        lastStudiedAt: targetPractice.lastStudiedAt,
        level: targetPractice.level,
        subject: targetPractice.subject
      },
      action: {
        kind: 'START_SESSION',
        mode: 'RANDOM',
        level: targetPractice.level,
        subject: targetPractice.subject,
        count: toDashboardSetupCount(targetPractice.catalogCount)
      }
    })
  }

  let personalizationFallbackReason: DashboardPersonalizationFallbackReason =
    null
  if (personalizedCount === 0) {
    if (targetPractice) {
      personalizationFallbackReason = 'NO_PERSONALIZED_EVIDENCE'
    } else if (input.targetLevel === null) {
      personalizationFallbackReason = 'TARGET_LEVEL_NOT_SET'
      append({
        kind: 'PRACTICE_SETUP',
        reason: { code: 'TARGET_LEVEL_NOT_SET' },
        action: { kind: 'OPEN_PRACTICE_SETUP' }
      })
    } else {
      personalizationFallbackReason = 'NO_TARGET_CATALOG'
      append({
        kind: 'PRACTICE_SETUP',
        reason: { code: 'NO_TARGET_CATALOG' },
        action: { kind: 'OPEN_PRACTICE_SETUP' }
      })
    }
  }

  return { recommendations, personalizationFallbackReason }
}
