export interface StudyCandidatePin {
  readonly questionId: string
  readonly questionVersionId: string
}

export interface RandomStudyCandidate extends StudyCandidatePin {
  /** #1242: when this person last had the question in a set; null if never. */
  readonly lastSeenAt: Date | null
  /** #986: questions with one passage come together, in passage order. */
  readonly passageId?: string | null
  readonly passageOrder?: number | null
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

/** A wrong note waiting for review, NEW or AGAIN (JLP-812). */
export interface ToReviewStudyCandidate extends StudyCandidatePin {
  readonly lastWrongAt: Date
}

export interface WeaknessStudyCandidate extends StudyCandidatePin {
  readonly answeredCount: number
  readonly incorrectCount: number
  readonly lastAnsweredAt: Date
}

type StudySelectionErrorCode =
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

const shuffleBy = <Item>(
  items: readonly Item[],
  key: (item: Item) => string,
  random: () => number
): Item[] => {
  const shuffled = items.toSorted((left, right) =>
    key(left).localeCompare(key(right))
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

  // A passage group is one unit, seen when any of its questions was (at the
  // latest of those times); a question without a passage is a unit of its own.
  const units = new Map<string, RandomStudyCandidate[]>()
  for (const candidate of candidates) {
    const unitKey = candidate.passageId
      ? `passage:${candidate.passageId}`
      : `question:${candidate.questionId}`
    units.set(unitKey, [...(units.get(unitKey) ?? []), candidate])
  }
  const ordered = [...units.values()].map((unit) =>
    unit.toSorted(
      (left, right) =>
        (left.passageOrder ?? 0) - (right.passageOrder ?? 0) ||
        left.questionId.localeCompare(right.questionId)
    )
  )
  const unitKey = (unit: readonly RandomStudyCandidate[]): string =>
    unit[0]!.questionId
  const seenAt = new Map(
    ordered.map((unit) => [
      unit,
      unit.reduce<number | null>(
        (latest, candidate) =>
          candidate.lastSeenAt === null
            ? latest
            : Math.max(latest ?? -Infinity, candidate.lastSeenAt.getTime()),
        null
      )
    ])
  )
  // #1242: never-seen units first in random order, then the ones seen
  // longest ago (units seen at the same time stay in random order).
  const unseen = shuffleBy(
    ordered.filter((unit) => seenAt.get(unit) === null),
    unitKey,
    random
  )
  const seen = shuffleBy(
    ordered.filter((unit) => seenAt.get(unit) !== null),
    unitKey,
    random
  ).toSorted((left, right) => seenAt.get(left)! - seenAt.get(right)!)

  // A group that does not fit the remaining places is skipped whole.
  const selected: RandomStudyCandidate[] = []
  for (const unit of [...unseen, ...seen]) {
    if (selected.length + unit.length <= requestedCount) {
      selected.push(...unit)
    }
  }
  return selected
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

/**
 * DAILY_REVIEW in two states (JLP-812): the oldest wrong answers first, so a
 * question just answered wrong does not come straight back.
 */
export const selectToReviewStudyCandidates = (
  candidates: readonly ToReviewStudyCandidate[],
  requestedCount: number
): ToReviewStudyCandidate[] =>
  selectRankedCandidates(
    candidates,
    requestedCount,
    (left, right) =>
      left.lastWrongAt.getTime() - right.lastWrongAt.getTime() ||
      left.questionId.localeCompare(right.questionId)
  )

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
