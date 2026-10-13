import {
  applyWrongNoteReview,
  WRONG_NOTE_ALGORITHM_VERSION,
  type WrongNoteReviewState,
  type WrongNoteReviewStatus
} from './apply-wrong-note-review.js'

export const reviewReconciliationMismatchCategories = [
  'EVENT_CHAIN',
  'MATERIALIZED_WRONG_NOTE',
  'REVIEW_SCHEDULE',
  'EVIDENCE_PIN',
  'SOURCE_MODE'
] as const

export type ReviewReconciliationMismatchCategory =
  (typeof reviewReconciliationMismatchCategories)[number]

export interface ReviewReconciliationEvent {
  readonly algorithmVersion: number
  readonly evidenceValid: boolean
  readonly isCorrect: boolean | null
  readonly nextCorrectStreak: number
  readonly nextStatus: WrongNoteReviewStatus
  readonly occurredAt: Date
  readonly previousCorrectStreak: number | null
  readonly previousStatus: WrongNoteReviewStatus | null
  readonly previousWrongCount: number | null
  readonly questionVersionId: string
  readonly source: 'STUDY_SUBMIT' | 'VERSION_REBASE' | 'WRONG_NOTE_REVIEW'
  readonly sourceModeValid: boolean
  readonly wrongCountAfter: number
}

export interface ReviewReconciliationSchedule {
  readonly algorithmVersion: number
  readonly intervalDays: number
  readonly nextReviewAt: Date
  readonly updatedAt: Date
}

export interface ReviewReconciliationMaterializedWrongNote
  extends WrongNoteReviewState {
  readonly lastWrongQuestionVersionId: string
  readonly updatedAt: Date
}

export interface ReconcileWrongNoteReviewInput {
  readonly events: readonly ReviewReconciliationEvent[]
  readonly materializedWrongNote: ReviewReconciliationMaterializedWrongNote
  readonly schedule: ReviewReconciliationSchedule | null
}

export interface ReconcileWrongNoteReviewResult {
  readonly mismatchCategories: readonly ReviewReconciliationMismatchCategory[]
  readonly oldestMismatchOccurredAtByCategory: Readonly<
    Partial<Record<ReviewReconciliationMismatchCategory, Date | null>>
  >
}

const datesEqual = (left: Date | null, right: Date | null): boolean =>
  left?.getTime() === right?.getTime()

const statesEqual = (
  left: WrongNoteReviewState,
  right: WrongNoteReviewState
): boolean =>
  left.status === right.status &&
  left.correctStreak === right.correctStreak &&
  left.wrongCount === right.wrongCount &&
  datesEqual(left.lastWrongAt, right.lastWrongAt) &&
  datesEqual(left.lastReviewedAt, right.lastReviewedAt)

export const reconcileWrongNoteReview = ({
  events,
  materializedWrongNote,
  schedule
}: ReconcileWrongNoteReviewInput): ReconcileWrongNoteReviewResult => {
  const mismatches = new Set<ReviewReconciliationMismatchCategory>()
  const oldestMismatchOccurredAtByCategory = new Map<
    ReviewReconciliationMismatchCategory,
    Date | null
  >()
  let previous: WrongNoteReviewState | null = null
  let expectedSchedule: ReviewReconciliationSchedule | null = null
  let expectedLastWrongQuestionVersionId: string | null = null
  let expectedMaterializedUpdatedAt: Date | null = null
  let previousEventOccurredAt: Date | null = null

  const markMismatch = (
    category: ReviewReconciliationMismatchCategory,
    occurredAt: Date | null
  ): void => {
    mismatches.add(category)
    if (!oldestMismatchOccurredAtByCategory.has(category)) {
      oldestMismatchOccurredAtByCategory.set(category, occurredAt)
      return
    }
    const previousOccurredAt = oldestMismatchOccurredAtByCategory.get(category)
    if (
      previousOccurredAt !== undefined &&
      previousOccurredAt !== null &&
      occurredAt !== null &&
      occurredAt.getTime() < previousOccurredAt.getTime()
    ) {
      oldestMismatchOccurredAtByCategory.set(category, occurredAt)
    }
  }

  for (const event of events) {
    if (
      previousEventOccurredAt !== null &&
      event.occurredAt.getTime() <= previousEventOccurredAt.getTime()
    ) {
      markMismatch('EVENT_CHAIN', event.occurredAt)
    }
    previousEventOccurredAt = event.occurredAt
    if (!event.evidenceValid) {
      markMismatch('EVIDENCE_PIN', event.occurredAt)
    }
    if (!event.sourceModeValid) {
      markMismatch('SOURCE_MODE', event.occurredAt)
    }

    const previousSnapshotMatches =
      event.previousStatus === (previous?.status ?? null) &&
      event.previousCorrectStreak === (previous?.correctStreak ?? null) &&
      event.previousWrongCount === (previous?.wrongCount ?? null)

    if (!previousSnapshotMatches) {
      markMismatch('EVENT_CHAIN', event.occurredAt)
    }

    if (event.source === 'VERSION_REBASE') {
      const preservesState =
        previous !== null &&
        event.algorithmVersion === WRONG_NOTE_ALGORITHM_VERSION &&
        event.isCorrect === null &&
        event.nextStatus === previous.status &&
        event.nextCorrectStreak === previous.correctStreak &&
        event.wrongCountAfter === previous.wrongCount
      if (!preservesState) {
        markMismatch('EVENT_CHAIN', event.occurredAt)
      }
      continue
    }

    if (event.isCorrect === null) {
      markMismatch('EVENT_CHAIN', event.occurredAt)
      continue
    }

    try {
      const decision = applyWrongNoteReview({
        previous,
        isCorrect: event.isCorrect,
        occurredAt: event.occurredAt
      })
      if (decision === null) {
        markMismatch('EVENT_CHAIN', event.occurredAt)
        continue
      }
      if (
        event.algorithmVersion !== WRONG_NOTE_ALGORITHM_VERSION ||
        event.nextStatus !== decision.event.nextStatus ||
        event.nextCorrectStreak !== decision.event.nextCorrectStreak ||
        event.wrongCountAfter !== decision.event.wrongCountAfter
      ) {
        markMismatch('EVENT_CHAIN', event.occurredAt)
      }

      previous = decision.wrongNote
      expectedSchedule = {
        ...decision.schedule,
        updatedAt: event.occurredAt
      }
      expectedMaterializedUpdatedAt = event.occurredAt
      if (!event.isCorrect) {
        expectedLastWrongQuestionVersionId = event.questionVersionId
      }
    } catch {
      markMismatch('EVENT_CHAIN', event.occurredAt)
    }
  }

  const latestOccurredAt = events.at(-1)?.occurredAt ?? null
  if (
    previous === null ||
    expectedLastWrongQuestionVersionId === null ||
    expectedMaterializedUpdatedAt === null ||
    !statesEqual(previous, materializedWrongNote) ||
    materializedWrongNote.lastWrongQuestionVersionId !==
      expectedLastWrongQuestionVersionId ||
    !datesEqual(materializedWrongNote.updatedAt, expectedMaterializedUpdatedAt)
  ) {
    markMismatch('MATERIALIZED_WRONG_NOTE', latestOccurredAt)
  }

  if (
    expectedSchedule === null ||
    schedule === null ||
    schedule.algorithmVersion !== expectedSchedule.algorithmVersion ||
    schedule.intervalDays !== expectedSchedule.intervalDays ||
    !datesEqual(schedule.nextReviewAt, expectedSchedule.nextReviewAt) ||
    !datesEqual(schedule.updatedAt, expectedSchedule.updatedAt)
  ) {
    markMismatch('REVIEW_SCHEDULE', latestOccurredAt)
  }

  return {
    mismatchCategories: reviewReconciliationMismatchCategories.filter(
      (category) => mismatches.has(category)
    ),
    oldestMismatchOccurredAtByCategory: Object.fromEntries(
      oldestMismatchOccurredAtByCategory
    )
  }
}
