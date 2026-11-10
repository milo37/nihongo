import type { ImportGuestResultResponse } from '@nihongo/contracts/study/import-guest-result'
import { ApplicationError } from '../errors/applicationError.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { isDatabaseUnavailableError } from './studyRepositorySupport.js'
import { lockWrongNotes } from './studySubmissionLocks.js'
import type { AtomicSession } from './studySubmissionModel.js'
import { createReviewFacts } from './studySubmissionRecords.js'

/**
 * JLP-823: at login the guest's last result on this device becomes the
 * member's. The session changes owner and its answers go through the same
 * wrong-note rule as a member submission, so the member sees it in records
 * and wrong notes as if they had been signed in.
 */
export interface GuestResultImportInput {
  readonly guest: { readonly id: string; readonly tokenDigest: string }
  readonly observedAt: Date
  readonly userId: string
}

export interface GuestResultImportRepository {
  importLast: (
    input: GuestResultImportInput
  ) => Promise<ImportGuestResultResponse>
}

export class GuestResultImportUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Guest result import is unavailable.', options)
    this.name = 'GuestResultImportUnavailableError'
  }
}

const NOTHING: ImportGuestResultResponse = {
  importedSessionId: null,
  wrongAnswerCount: 0
}

interface SourceRow {
  readonly id: string
  readonly mode: AtomicSession['mode']
  readonly submittedAt: Date
}

interface AnswerRow {
  readonly answerId: string
  readonly isCorrect: boolean
  readonly questionId: string
  readonly questionVersionId: string
  readonly selectedOptionId: string | null
  readonly studySessionQuestionId: string
}

const importInTransaction = async (
  transaction: Prisma.TransactionClient,
  input: GuestResultImportInput
): Promise<ImportGuestResultResponse> => {
  const [guest] = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "GuestPrincipal"
    WHERE "id" = ${input.guest.id}::uuid
      AND "tokenDigest" = ${input.guest.tokenDigest}
      AND "expiresAt" > ${input.observedAt}
    FOR UPDATE`
  if (!guest) return NOTHING

  // The last submitted set. A retry cannot belong to a member as a random
  // set (StudySession_retry_shape_check), so its source set is moved.
  const [source] = await transaction.$queryRaw<SourceRow[]>`
    SELECT "id", "mode"::text AS "mode", "submittedAt"
    FROM "StudySession"
    WHERE "guestPrincipalId" = ${guest.id}::uuid
      AND "status" = 'SUBMITTED'
      AND "retryOfStudySessionId" IS NULL
    ORDER BY "submittedAt" DESC, "id" DESC
    LIMIT 1
    FOR UPDATE`
  if (!source) return NOTHING

  const answers = await transaction.$queryRaw<AnswerRow[]>`
    SELECT
      item."id" AS "studySessionQuestionId",
      item."questionId",
      answer."id" AS "answerId",
      answer."questionVersionId",
      answer."selectedOptionId",
      answer."isCorrect"
    FROM "StudySessionQuestion" AS item
    JOIN "StudyAnswer" AS answer
      ON answer."studySessionQuestionId" = item."id"
    WHERE item."studySessionId" = ${source.id}::uuid
    ORDER BY item."questionId" ASC`

  // Guest-only rows keyed by (session, guest) would lose their owner when the
  // session moves: the guest's retries of this set and its replay records.
  await transaction.$executeRaw`
    WITH RECURSIVE chain AS (
      SELECT "id" FROM "StudySession"
      WHERE "retryOfStudySessionId" = ${source.id}::uuid
        AND "guestPrincipalId" = ${guest.id}::uuid
      UNION
      SELECT child."id" FROM "StudySession" AS child
      JOIN chain ON child."retryOfStudySessionId" = chain."id"
    )
    DELETE FROM "StudySession" WHERE "id" IN (SELECT "id" FROM chain)`
  await transaction.$executeRaw`
    DELETE FROM "IdempotencyRecord"
    WHERE "studySessionId" = ${source.id}::uuid
      AND "guestPrincipalId" = ${guest.id}::uuid`

  const wrongNotes = await lockWrongNotes(
    transaction,
    input.userId,
    answers.map(({ questionId }) => questionId).toSorted()
  )
  const latestWrongNoteTime = wrongNotes.reduce(
    (latest, note) => Math.max(latest, note.updatedAt.getTime() + 1),
    Number.NEGATIVE_INFINITY
  )
  const effectiveAt = new Date(
    Math.max(
      input.observedAt.getTime(),
      source.submittedAt.getTime(),
      latestWrongNoteTime
    )
  )

  await transaction.$executeRaw`
    UPDATE "StudySession"
    SET "userId" = ${input.userId}::uuid,
        "guestPrincipalId" = NULL,
        "updatedAt" = ${effectiveAt}
    WHERE "id" = ${source.id}::uuid`

  await createReviewFacts(transaction, {
    answerIdBySessionQuestionId: new Map(
      answers.map(({ answerId, studySessionQuestionId }) => [
        studySessionQuestionId,
        answerId
      ])
    ),
    effectiveSubmittedAt: effectiveAt,
    gradedAnswers: answers,
    mode: source.mode,
    questions: answers,
    sessionId: source.id,
    userId: input.userId,
    wrongNotes
  })

  return {
    importedSessionId: source.id,
    wrongAnswerCount: answers.filter(({ isCorrect }) => !isCorrect).length
  }
}

export const createPrismaGuestResultImportRepository = (
  client: PrismaClient
): GuestResultImportRepository => ({
  importLast: async (input) => {
    try {
      return await client.$transaction(
        async (transaction) => await importInTransaction(transaction, input)
      )
    } catch (error: unknown) {
      if (isDatabaseUnavailableError(error)) {
        throw new GuestResultImportUnavailableError({ cause: error })
      }
      throw error
    }
  }
})

export interface GuestResultImportService {
  importLast: (
    input: GuestResultImportInput
  ) => Promise<ImportGuestResultResponse>
}

export const createGuestResultImportService = (
  repository: GuestResultImportRepository
): GuestResultImportService => ({
  importLast: async (input) => {
    try {
      return await repository.importLast(input)
    } catch (error: unknown) {
      if (error instanceof GuestResultImportUnavailableError) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '학습 기록 저장소에 연결할 수 없습니다.',
          retryable: true,
          cause: error
        })
      }
      throw error
    }
  }
})
