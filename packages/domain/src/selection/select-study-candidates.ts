export interface StudyCandidatePin {
  readonly questionId: string
  readonly questionVersionId: string
}

export interface RandomStudyCandidate extends StudyCandidatePin {
  readonly isRecent: boolean
}

export interface BookmarkStudyCandidate extends StudyCandidatePin {
  readonly createdAt: Date
}

export interface WrongNoteStudyCandidate extends StudyCandidatePin {
  readonly lastWrongAt: Date
  readonly wrongCount: number
}

export type DailyReviewCandidateStatus =
  | 'NEW'
  | 'REVIEWING'
  | 'AGAIN'
  | 'SOLVED'

export interface DailyReviewStudyCandidate extends StudyCandidatePin {
  readonly nextReviewAt: Date
  readonly status: DailyReviewCandidateStatus
}

export interface WeaknessStudyCandidate extends StudyCandidatePin {
  readonly answeredCount: number
  readonly incorrectCount: number
  readonly lastAnsweredAt: Date
}

export type StudySelectionErrorCode =
  | 'DUPLICATE_CANDIDATE'
  | 'INVALID_CANDIDATE'
  | 'INVALID_RANDOM_VALUE'
  | 'INVALID_REQUESTED_COUNT'

export class StudySelectionError extends Error {
  readonly code: StudySelectionErrorCode

  constructor(code: StudySelectionErrorCode, message: string) {
    super(message)
    this.name = 'StudySelectionError'
    this.code = code
  }
}

const assertRequestedCount = (requestedCount: number): void => {
  if (!Number.isSafeInteger(requestedCount) || requestedCount < 1) {
    throw new StudySelectionError(
      'INVALID_REQUESTED_COUNT',
      'requestedCount는 1 이상의 safe integer여야 합니다.'
    )
  }
}

const assertUniqueCandidates = <Candidate extends StudyCandidatePin>(
  candidates: readonly Candidate[]
): void => {
  const questionIds = new Set<string>()

  for (const candidate of candidates) {
    if (
      candidate.questionId.trim().length === 0 ||
      candidate.questionVersionId.trim().length === 0
    ) {
      throw new StudySelectionError(
        'INVALID_CANDIDATE',
        'candidate ID는 비어 있을 수 없습니다.'
      )
    }
    if (questionIds.has(candidate.questionId)) {
      throw new StudySelectionError(
        'DUPLICATE_CANDIDATE',
        `stable Question 후보가 중복됐습니다: ${candidate.questionId}`
      )
    }
    questionIds.add(candidate.questionId)
  }
}

const selectRankedCandidates = <Candidate extends StudyCandidatePin>(
  candidates: readonly Candidate[],
  requestedCount: number,
  compare: (left: Candidate, right: Candidate) => number
): Candidate[] => {
  assertRequestedCount(requestedCount)
  assertUniqueCandidates(candidates)

  return candidates.toSorted(compare).slice(0, requestedCount)
}

const shuffleCandidates = <Candidate extends StudyCandidatePin>(
  candidates: readonly Candidate[],
  random: () => number
): Candidate[] => {
  const shuffled = candidates.toSorted((left, right) =>
    left.questionId.localeCompare(right.questionId)
  )

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomValue = random()
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
      throw new StudySelectionError(
        'INVALID_RANDOM_VALUE',
        'RNG는 0 이상 1 미만의 유한수를 반환해야 합니다.'
      )
    }
    const swapIndex = Math.floor(randomValue * (index + 1))
    const current = shuffled[index]
    const selected = shuffled[swapIndex]
    if (!current || !selected) {
      throw new StudySelectionError(
        'INVALID_CANDIDATE',
        'candidate shuffle index가 유효하지 않습니다.'
      )
    }
    shuffled[index] = selected
    shuffled[swapIndex] = current
  }

  return shuffled
}

export const selectRandomStudyCandidates = (
  candidates: readonly RandomStudyCandidate[],
  requestedCount: number,
  random: () => number
): RandomStudyCandidate[] => {
  assertRequestedCount(requestedCount)
  assertUniqueCandidates(candidates)

  const nonRecent = shuffleCandidates(
    candidates.filter((candidate) => !candidate.isRecent),
    random
  )
  const recent = shuffleCandidates(
    candidates.filter((candidate) => candidate.isRecent),
    random
  )

  return [...nonRecent, ...recent].slice(0, requestedCount)
}

export const selectBookmarkStudyCandidates = (
  candidates: readonly BookmarkStudyCandidate[],
  requestedCount: number
): BookmarkStudyCandidate[] =>
  selectRankedCandidates(candidates, requestedCount, (left, right) => {
    const createdOrder = right.createdAt.getTime() - left.createdAt.getTime()
    return createdOrder !== 0
      ? createdOrder
      : left.questionId.localeCompare(right.questionId)
  })

export const selectWrongNoteStudyCandidates = (
  candidates: readonly WrongNoteStudyCandidate[],
  requestedCount: number
): WrongNoteStudyCandidate[] =>
  selectRankedCandidates(candidates, requestedCount, (left, right) => {
    const lastWrongOrder =
      right.lastWrongAt.getTime() - left.lastWrongAt.getTime()
    if (lastWrongOrder !== 0) {
      return lastWrongOrder
    }
    if (left.wrongCount !== right.wrongCount) {
      return right.wrongCount - left.wrongCount
    }
    return left.questionId.localeCompare(right.questionId)
  })

const DAILY_REVIEW_STATUS_PRIORITY: Record<DailyReviewCandidateStatus, number> =
  {
    AGAIN: 0,
    NEW: 1,
    REVIEWING: 2,
    SOLVED: 3
  }

export const selectDailyReviewStudyCandidates = (
  candidates: readonly DailyReviewStudyCandidate[],
  requestedCount: number
): DailyReviewStudyCandidate[] =>
  selectRankedCandidates(candidates, requestedCount, (left, right) => {
    const scheduleOrder =
      left.nextReviewAt.getTime() - right.nextReviewAt.getTime()
    if (scheduleOrder !== 0) {
      return scheduleOrder
    }
    const statusOrder =
      DAILY_REVIEW_STATUS_PRIORITY[left.status] -
      DAILY_REVIEW_STATUS_PRIORITY[right.status]
    if (statusOrder !== 0) {
      return statusOrder
    }
    return left.questionId.localeCompare(right.questionId)
  })

export const selectWeaknessStudyCandidates = (
  candidates: readonly WeaknessStudyCandidate[],
  requestedCount: number
): WeaknessStudyCandidate[] => {
  for (const candidate of candidates) {
    if (
      !Number.isSafeInteger(candidate.answeredCount) ||
      !Number.isSafeInteger(candidate.incorrectCount) ||
      candidate.answeredCount < 3 ||
      candidate.incorrectCount < 1 ||
      candidate.incorrectCount > candidate.answeredCount
    ) {
      throw new StudySelectionError(
        'INVALID_CANDIDATE',
        `WEAKNESS 집계가 유효하지 않습니다: ${candidate.questionId}`
      )
    }
  }

  return selectRankedCandidates(candidates, requestedCount, (left, right) => {
    const leftRateNumerator =
      BigInt(left.incorrectCount) * BigInt(right.answeredCount)
    const rightRateNumerator =
      BigInt(right.incorrectCount) * BigInt(left.answeredCount)
    if (leftRateNumerator !== rightRateNumerator) {
      return leftRateNumerator > rightRateNumerator ? -1 : 1
    }
    if (left.incorrectCount !== right.incorrectCount) {
      return right.incorrectCount - left.incorrectCount
    }
    const lastAnsweredOrder =
      left.lastAnsweredAt.getTime() - right.lastAnsweredAt.getTime()
    if (lastAnsweredOrder !== 0) {
      return lastAnsweredOrder
    }
    return left.questionId.localeCompare(right.questionId)
  })
}
