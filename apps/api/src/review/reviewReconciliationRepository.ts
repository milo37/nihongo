import {
  reconcileWrongNoteReview,
  reviewReconciliationMismatchCategories,
  type ReviewReconciliationEvent,
  type ReviewReconciliationMismatchCategory
} from '@nihongo/domain/review/reconcile-wrong-note-review'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

export interface ReviewReconciliationInput {
  readonly batchSize: number
}

export interface ReviewReconciliationCategoryResult {
  readonly category: ReviewReconciliationMismatchCategory
  readonly count: number
  readonly oldestOccurredAt: string | null
}

export interface ReviewReconciliationResult {
  readonly categories: readonly ReviewReconciliationCategoryResult[]
  readonly mismatchWrongNoteCount: number
  readonly scannedWrongNoteCount: number
}

export interface ReviewReconciliationRepository {
  reconcile: (
    input: ReviewReconciliationInput
  ) => Promise<ReviewReconciliationResult>
}

export const REVIEW_RECONCILIATION_TRANSACTION_TIMEOUT_MS = 60_000

interface WrongNoteRow {
  correctStreak: number
  id: string
  lastReviewedAt: Date | null
  lastWrongQuestionVersionId: string
  lastWrongAt: Date
  scheduleAlgorithmVersion: number | null
  scheduleIntervalDays: number | null
  scheduleNextReviewAt: Date | null
  scheduleUpdatedAt: Date | null
  status: 'AGAIN' | 'NEW' | 'REVIEWING' | 'SOLVED'
  updatedAt: Date
  wrongCount: number
}

interface ReviewEventRow {
  algorithmVersion: number
  evidenceValid: boolean
  isCorrect: boolean | null
  nextCorrectStreak: number
  nextStatus: 'AGAIN' | 'NEW' | 'REVIEWING' | 'SOLVED'
  occurredAt: Date
  previousCorrectStreak: number | null
  previousStatus: 'AGAIN' | 'NEW' | 'REVIEWING' | 'SOLVED' | null
  previousWrongCount: number | null
  questionVersionId: string
  source: 'STUDY_SUBMIT' | 'VERSION_REBASE' | 'WRONG_NOTE_REVIEW'
  sourceModeValid: boolean
  wrongCountAfter: number
  wrongNoteId: string
}

export const createReviewReconciliationNoteBatchQuery = ({
  batchSize,
  cursor
}: {
  readonly batchSize: number
  readonly cursor: string | null
}): Prisma.Sql => Prisma.sql`
  SELECT
    note."id",
    note."wrongCount",
    note."correctStreak",
    note."status"::text AS "status",
    note."lastWrongAt",
    note."lastReviewedAt",
    note."lastWrongQuestionVersionId",
    note."updatedAt",
    schedule."nextReviewAt" AS "scheduleNextReviewAt",
    schedule."intervalDays" AS "scheduleIntervalDays",
    schedule."algorithmVersion" AS "scheduleAlgorithmVersion",
    schedule."updatedAt" AS "scheduleUpdatedAt"
  FROM "WrongNote" AS note
  LEFT JOIN "ReviewSchedule" AS schedule
    ON schedule."wrongNoteId" = note."id"
  WHERE (${cursor}::uuid IS NULL OR note."id" > ${cursor}::uuid)
  ORDER BY note."id" ASC
  LIMIT ${batchSize}
`

export const createReviewReconciliationEventBatchQuery = (
  noteIds: readonly string[]
): Prisma.Sql => {
  if (noteIds.length === 0) {
    throw new Error('Review reconciliation event batch cannot be empty.')
  }
  return Prisma.sql`
    SELECT
      event."wrongNoteId",
      event."source"::text AS "source",
      event."isCorrect",
      event."previousStatus"::text AS "previousStatus",
      event."nextStatus"::text AS "nextStatus",
      event."previousCorrectStreak",
      event."nextCorrectStreak",
      event."previousWrongCount",
      event."wrongCountAfter",
      event."questionVersionId",
      event."algorithmVersion",
      event."occurredAt",
      (
        (event."source" = 'VERSION_REBASE'
          AND version."id" IS NOT NULL
          AND event."studySessionId" IS NULL
          AND event."studyAnswerId" IS NULL
          AND event."selectedOptionId" IS NULL
          AND event."isCorrect" IS NULL)
        OR (
          event."source" <> 'VERSION_REBASE'
          AND version."id" IS NOT NULL
          AND answer."id" IS NOT NULL
          AND item."id" IS NOT NULL
          AND event."selectedOptionId" IS NOT DISTINCT FROM
            answer."selectedOptionId"
          AND event."isCorrect" IS NOT DISTINCT FROM answer."isCorrect"
        )
      ) AS "evidenceValid",
      (
        event."source" = 'VERSION_REBASE'
        OR (
          session."id" IS NOT NULL
          AND session."status" = 'SUBMITTED'
          AND session."userId" = event."userId"
          AND (
            (event."source" = 'STUDY_SUBMIT'
              AND session."mode" IN ('RANDOM', 'WEAKNESS', 'BOOKMARK'))
            OR (event."source" = 'WRONG_NOTE_REVIEW'
              AND session."mode" IN ('WRONG_NOTE', 'DAILY_REVIEW'))
          )
          AND (
            session."retryOfStudySessionId" IS NULL
            OR (
              event."source" = 'WRONG_NOTE_REVIEW'
              AND session."mode" = 'WRONG_NOTE'
              AND EXISTS (
                SELECT 1
                FROM "StudySessionQuestion" AS source_item
                JOIN "StudyAnswer" AS source_answer
                  ON source_answer."studySessionQuestionId" =
                    source_item."id"
                  AND source_answer."questionVersionId" =
                    source_item."questionVersionId"
                WHERE source_item."studySessionId" =
                    session."retryOfStudySessionId"
                  AND source_item."questionId" = event."questionId"
                  AND source_item."questionVersionId" =
                    event."questionVersionId"
                  AND NOT source_answer."isCorrect"
              )
            )
          )
        )
      ) AS "sourceModeValid"
    FROM "ReviewEvent" AS event
    LEFT JOIN "QuestionVersion" AS version
      ON version."id" = event."questionVersionId"
      AND version."questionId" = event."questionId"
    LEFT JOIN "StudyAnswer" AS answer
      ON answer."id" = event."studyAnswerId"
      AND answer."questionVersionId" = event."questionVersionId"
    LEFT JOIN "StudySessionQuestion" AS item
      ON item."id" = answer."studySessionQuestionId"
      AND item."studySessionId" = event."studySessionId"
      AND item."questionId" = event."questionId"
      AND item."questionVersionId" = event."questionVersionId"
    LEFT JOIN "StudySession" AS session
      ON session."id" = event."studySessionId"
    WHERE event."wrongNoteId" IN (${Prisma.join(noteIds)})
    ORDER BY event."wrongNoteId" ASC,
      event."occurredAt" ASC,
      event."id" ASC
  `
}

const toEvent = (row: ReviewEventRow): ReviewReconciliationEvent => ({
  algorithmVersion: row.algorithmVersion,
  evidenceValid: row.evidenceValid,
  isCorrect: row.isCorrect,
  nextCorrectStreak: row.nextCorrectStreak,
  nextStatus: row.nextStatus,
  occurredAt: row.occurredAt,
  previousCorrectStreak: row.previousCorrectStreak,
  previousStatus: row.previousStatus,
  previousWrongCount: row.previousWrongCount,
  questionVersionId: row.questionVersionId,
  source: row.source,
  sourceModeValid: row.sourceModeValid,
  wrongCountAfter: row.wrongCountAfter
})

export const createPrismaReviewReconciliationRepository = (
  client: PrismaClient
): ReviewReconciliationRepository => ({
  reconcile: async ({ batchSize }) =>
    await client.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SET TRANSACTION READ ONLY`

        const categoryCounts = new Map<
          ReviewReconciliationMismatchCategory,
          {
            count: number
            hasUnknownOccurredAt: boolean
            oldestOccurredAt: Date | null
          }
        >(
          reviewReconciliationMismatchCategories.map((category) => [
            category,
            {
              count: 0,
              hasUnknownOccurredAt: false,
              oldestOccurredAt: null
            }
          ])
        )
        let cursor: string | null = null
        let mismatchWrongNoteCount = 0
        let scannedWrongNoteCount = 0

        while (true) {
          const notes: WrongNoteRow[] = await transaction.$queryRaw<
            WrongNoteRow[]
          >(createReviewReconciliationNoteBatchQuery({ batchSize, cursor }))

          if (notes.length === 0) {
            break
          }

          const noteIds = notes.map((note) => note.id)
          const events = await transaction.$queryRaw<ReviewEventRow[]>(
            createReviewReconciliationEventBatchQuery(noteIds)
          )
          const eventsByWrongNote = new Map<string, ReviewEventRow[]>()
          for (const event of events) {
            const grouped = eventsByWrongNote.get(event.wrongNoteId) ?? []
            grouped.push(event)
            eventsByWrongNote.set(event.wrongNoteId, grouped)
          }

          for (const note of notes) {
            const result = reconcileWrongNoteReview({
              events: (eventsByWrongNote.get(note.id) ?? []).map(toEvent),
              materializedWrongNote: {
                wrongCount: note.wrongCount,
                correctStreak: note.correctStreak,
                status: note.status,
                lastWrongAt: note.lastWrongAt,
                lastReviewedAt: note.lastReviewedAt,
                lastWrongQuestionVersionId: note.lastWrongQuestionVersionId,
                updatedAt: note.updatedAt
              },
              schedule:
                note.scheduleNextReviewAt === null ||
                note.scheduleIntervalDays === null ||
                note.scheduleAlgorithmVersion === null ||
                note.scheduleUpdatedAt === null
                  ? null
                  : {
                      nextReviewAt: note.scheduleNextReviewAt,
                      intervalDays: note.scheduleIntervalDays,
                      algorithmVersion: note.scheduleAlgorithmVersion,
                      updatedAt: note.scheduleUpdatedAt
                    }
            })
            scannedWrongNoteCount += 1
            if (result.mismatchCategories.length > 0) {
              mismatchWrongNoteCount += 1
            }
            for (const category of result.mismatchCategories) {
              const aggregate = categoryCounts.get(category)
              if (!aggregate) {
                throw new Error('Unknown review reconciliation category.')
              }
              aggregate.count += 1
              const mismatchOccurredAt =
                result.oldestMismatchOccurredAtByCategory[category] ?? null
              if (mismatchOccurredAt === null) {
                aggregate.hasUnknownOccurredAt = true
              }
              if (
                mismatchOccurredAt !== null &&
                (aggregate.oldestOccurredAt === null ||
                  mismatchOccurredAt < aggregate.oldestOccurredAt)
              ) {
                aggregate.oldestOccurredAt = mismatchOccurredAt
              }
            }
          }

          cursor = notes.at(-1)?.id ?? null
          if (notes.length < batchSize) {
            break
          }
        }

        return {
          scannedWrongNoteCount,
          mismatchWrongNoteCount,
          categories: reviewReconciliationMismatchCategories.map((category) => {
            const aggregate = categoryCounts.get(category)
            if (!aggregate) {
              throw new Error('Missing review reconciliation aggregate.')
            }
            return {
              category,
              count: aggregate.count,
              oldestOccurredAt: aggregate.hasUnknownOccurredAt
                ? null
                : (aggregate.oldestOccurredAt?.toISOString() ?? null)
            }
          })
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: REVIEW_RECONCILIATION_TRANSACTION_TIMEOUT_MS
      }
    )
})
