export const WRONG_NOTE_ALGORITHM_VERSION = 1 as const

export type WrongNoteReviewStatus = 'NEW' | 'REVIEWING' | 'AGAIN' | 'SOLVED'

export type WrongNoteReviewErrorCode =
  | 'INVALID_PREVIOUS_STATE'
  | 'INVALID_OCCURRED_AT'
  | 'NON_MONOTONIC_OCCURRED_AT'
  | 'INVALID_EVIDENCE'
  | 'DUPLICATE_EVIDENCE'

export class WrongNoteReviewError extends Error {
  readonly code: WrongNoteReviewErrorCode

  constructor(code: WrongNoteReviewErrorCode, message: string) {
    super(message)
    this.name = 'WrongNoteReviewError'
    this.code = code
  }
}

export interface WrongNoteReviewState {
  readonly wrongCount: number
  readonly correctStreak: number
  readonly status: WrongNoteReviewStatus
  readonly lastWrongAt: Date
  readonly lastReviewedAt: Date | null
}

export interface WrongNoteReviewScheduleDecision {
  readonly nextReviewAt: Date
  readonly intervalDays: number
  readonly algorithmVersion: typeof WRONG_NOTE_ALGORITHM_VERSION
}

export interface WrongNoteReviewEventDecision {
  readonly isCorrect: boolean
  readonly previousStatus: WrongNoteReviewStatus | null
  readonly nextStatus: WrongNoteReviewStatus
  readonly previousCorrectStreak: number | null
  readonly nextCorrectStreak: number
  readonly previousWrongCount: number | null
  readonly wrongCountAfter: number
  readonly occurredAt: Date
  readonly algorithmVersion: typeof WRONG_NOTE_ALGORITHM_VERSION
}

export interface WrongNoteReviewDecision {
  readonly wrongNote: WrongNoteReviewState
  readonly schedule: WrongNoteReviewScheduleDecision
  readonly event: WrongNoteReviewEventDecision
}

export interface ApplyWrongNoteReviewInput {
  readonly previous: WrongNoteReviewState | null
  readonly isCorrect: boolean
  readonly occurredAt: Date
}

export interface ReviewEventEvidence {
  readonly studyAnswerId: string | null
}

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000

const isValidDate = (value: Date): boolean => Number.isFinite(value.getTime())

const cloneDate = (value: Date): Date => new Date(value.getTime())

const addDays = (value: Date, days: number): Date =>
  new Date(value.getTime() + days * DAY_IN_MILLISECONDS)

const assertPreviousState = (state: WrongNoteReviewState): void => {
  if (
    !Number.isInteger(state.wrongCount) ||
    state.wrongCount < 1 ||
    !Number.isInteger(state.correctStreak) ||
    state.correctStreak < 0 ||
    !isValidDate(state.lastWrongAt) ||
    (state.lastReviewedAt !== null && !isValidDate(state.lastReviewedAt))
  ) {
    throw new WrongNoteReviewError(
      'INVALID_PREVIOUS_STATE',
      '이전 오답 노트 상태의 count 또는 시간이 올바르지 않습니다.'
    )
  }

  const isStatusValid =
    (state.status === 'NEW' &&
      state.wrongCount === 1 &&
      state.correctStreak === 0 &&
      state.lastReviewedAt === null) ||
    (state.status === 'AGAIN' &&
      state.wrongCount >= 2 &&
      state.correctStreak === 0 &&
      state.lastReviewedAt !== null) ||
    (state.status === 'REVIEWING' &&
      state.correctStreak === 1 &&
      state.lastReviewedAt !== null) ||
    (state.status === 'SOLVED' &&
      state.correctStreak >= 2 &&
      state.lastReviewedAt !== null)

  if (!isStatusValid) {
    throw new WrongNoteReviewError(
      'INVALID_PREVIOUS_STATE',
      '이전 오답 노트 status와 count가 일치하지 않습니다.'
    )
  }

  if (
    state.lastReviewedAt !== null &&
    state.lastReviewedAt.getTime() < state.lastWrongAt.getTime()
  ) {
    throw new WrongNoteReviewError(
      'INVALID_PREVIOUS_STATE',
      '마지막 복습 시각은 마지막 오답 시각보다 빠를 수 없습니다.'
    )
  }
}

const assertOccurredAt = (
  occurredAt: Date,
  previous: WrongNoteReviewState | null
): void => {
  if (!isValidDate(occurredAt)) {
    throw new WrongNoteReviewError(
      'INVALID_OCCURRED_AT',
      '유효한 server UTC instant가 필요합니다.'
    )
  }

  if (previous === null) {
    return
  }

  const latestPreviousTime = Math.max(
    previous.lastWrongAt.getTime(),
    previous.lastReviewedAt?.getTime() ?? Number.NEGATIVE_INFINITY
  )

  if (occurredAt.getTime() < latestPreviousTime) {
    throw new WrongNoteReviewError(
      'NON_MONOTONIC_OCCURRED_AT',
      '복습 시각은 이전 오답 노트 시각보다 빠를 수 없습니다.'
    )
  }
}

const getCorrectReviewIntervalDays = (correctStreak: number): number => {
  if (correctStreak === 1) {
    return 3
  }
  if (correctStreak === 2) {
    return 7
  }
  if (correctStreak === 3) {
    return 14
  }
  return 30
}

const createDecision = (
  previous: WrongNoteReviewState | null,
  wrongNote: WrongNoteReviewState,
  isCorrect: boolean,
  occurredAt: Date,
  intervalDays: number
): WrongNoteReviewDecision => ({
  wrongNote,
  schedule: {
    nextReviewAt: addDays(occurredAt, intervalDays),
    intervalDays,
    algorithmVersion: WRONG_NOTE_ALGORITHM_VERSION
  },
  event: {
    isCorrect,
    previousStatus: previous?.status ?? null,
    nextStatus: wrongNote.status,
    previousCorrectStreak: previous?.correctStreak ?? null,
    nextCorrectStreak: wrongNote.correctStreak,
    previousWrongCount: previous?.wrongCount ?? null,
    wrongCountAfter: wrongNote.wrongCount,
    occurredAt: cloneDate(occurredAt),
    algorithmVersion: WRONG_NOTE_ALGORITHM_VERSION
  }
})

export const applyWrongNoteReview = ({
  previous,
  isCorrect,
  occurredAt
}: ApplyWrongNoteReviewInput): WrongNoteReviewDecision | null => {
  if (previous !== null) {
    assertPreviousState(previous)
  }
  assertOccurredAt(occurredAt, previous)

  if (previous === null) {
    if (isCorrect) {
      return null
    }

    return createDecision(
      null,
      {
        wrongCount: 1,
        correctStreak: 0,
        status: 'NEW',
        lastWrongAt: cloneDate(occurredAt),
        lastReviewedAt: null
      },
      false,
      occurredAt,
      1
    )
  }

  if (!isCorrect) {
    return createDecision(
      previous,
      {
        wrongCount: previous.wrongCount + 1,
        correctStreak: 0,
        status: 'AGAIN',
        lastWrongAt: cloneDate(occurredAt),
        lastReviewedAt: cloneDate(occurredAt)
      },
      false,
      occurredAt,
      1
    )
  }

  const correctStreak = previous.correctStreak + 1
  const status: WrongNoteReviewStatus =
    correctStreak >= 2 ? 'SOLVED' : 'REVIEWING'
  const intervalDays = getCorrectReviewIntervalDays(correctStreak)

  return createDecision(
    previous,
    {
      wrongCount: previous.wrongCount,
      correctStreak,
      status,
      lastWrongAt: cloneDate(previous.lastWrongAt),
      lastReviewedAt: cloneDate(occurredAt)
    },
    true,
    occurredAt,
    intervalDays
  )
}

export const assertUniqueReviewEventEvidence = (
  evidence: readonly ReviewEventEvidence[]
): void => {
  const studyAnswerIds = new Set<string>()

  for (const item of evidence) {
    if (item.studyAnswerId === null) {
      continue
    }

    if (item.studyAnswerId.trim().length === 0) {
      throw new WrongNoteReviewError(
        'INVALID_EVIDENCE',
        'ReviewEvent studyAnswerId는 비어 있을 수 없습니다.'
      )
    }

    if (studyAnswerIds.has(item.studyAnswerId)) {
      throw new WrongNoteReviewError(
        'DUPLICATE_EVIDENCE',
        `같은 StudyAnswer evidence를 두 번 적용할 수 없습니다: ${item.studyAnswerId}`
      )
    }

    studyAnswerIds.add(item.studyAnswerId)
  }
}
