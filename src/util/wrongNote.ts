import type { WrongNote, WrongNoteStatus } from '@common/types/domain'
import { addDaysToIso } from '@util/date'

export interface WrongNoteTransition {
  wrongCount: number
  correctStreak: number
  status: WrongNoteStatus
}

const calculateNextReviewAt = (
  status: WrongNoteStatus,
  reviewedAt: string
): string | null => {
  if (status === 'SOLVED') {
    return null
  }

  return addDaysToIso(reviewedAt, status === 'REVIEWING' ? 3 : 1)
}

export const calculateNextWrongNoteState = (
  wrongNote: WrongNote,
  isCorrect: boolean
): WrongNoteTransition => {
  if (!isCorrect) {
    return {
      wrongCount: wrongNote.wrongCount + 1,
      correctStreak: 0,
      status: 'AGAIN'
    }
  }

  const correctStreak = wrongNote.correctStreak + 1

  return {
    wrongCount: wrongNote.wrongCount,
    correctStreak,
    status: correctStreak >= 2 ? 'SOLVED' : 'REVIEWING'
  }
}

export const createWrongNoteFromIncorrectAnswer = (
  userId: string,
  questionId: string,
  answeredAt: string
): WrongNote => ({
  id: `wrong-note-${userId}-${questionId}`,
  userId,
  questionId,
  wrongCount: 1,
  correctStreak: 0,
  status: 'NEW',
  memo: null,
  lastWrongAt: answeredAt,
  lastReviewedAt: null,
  nextReviewAt: calculateNextReviewAt('NEW', answeredAt),
  createdAt: answeredAt,
  updatedAt: answeredAt
})

export const updateWrongNoteAfterIncorrectAnswer = (
  wrongNote: WrongNote,
  reviewedAt: string
): WrongNote => {
  const transition = calculateNextWrongNoteState(wrongNote, false)

  return {
    ...wrongNote,
    ...transition,
    lastWrongAt: reviewedAt,
    lastReviewedAt: reviewedAt,
    nextReviewAt: calculateNextReviewAt(transition.status, reviewedAt),
    updatedAt: reviewedAt
  }
}

export const updateWrongNoteAfterCorrectReview = (
  wrongNote: WrongNote,
  reviewedAt: string
): WrongNote => {
  const transition = calculateNextWrongNoteState(wrongNote, true)

  return {
    ...wrongNote,
    ...transition,
    lastReviewedAt: reviewedAt,
    nextReviewAt: calculateNextReviewAt(transition.status, reviewedAt),
    updatedAt: reviewedAt
  }
}
