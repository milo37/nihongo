import { createHash, randomInt, randomUUID } from 'node:crypto'
import type {
  JlptLevel,
  QuestionDifficulty,
  QuestionSubject,
  QuestionType
} from '@nihongo/contracts/common/enum'
import { comparePublicQuestionTags } from '@nihongo/contracts/question/get-question'
import {
  createTargetedReviewSessionCanonicalMaterial,
  createTargetedReviewSessionResponseForQuestionSchema,
  type CreateTargetedReviewSessionResponse
} from '@nihongo/contracts/wrong-note/create-targeted-review-session'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

const MAX_TRANSACTION_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 5
const RETRY_JITTER_MAX_MS = 5
const SESSION_TTL_MS = 24 * 60 * 60 * 1_000
const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])

const delay = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds))

export interface CreateTargetedReviewAtomicInput {
  readonly idempotencyKey: string
  readonly observedAt: Date
  readonly questionId: string
  readonly userId: string
}

export interface CreateTargetedReviewAtomicResult {
  readonly replayed: boolean
  readonly response: CreateTargetedReviewSessionResponse
}

export interface WrongNoteTargetedReviewRepository {
  readonly createAtomic: (
    input: CreateTargetedReviewAtomicInput
  ) => Promise<CreateTargetedReviewAtomicResult>
}

interface WrongNoteTargetedReviewRepositoryOptions {
  readonly afterQuestionLocked?: () => Promise<void>
  readonly afterPointerUpdated?: () => Promise<void>
  readonly afterReservation?: () => Promise<void>
  readonly delay?: (milliseconds: number) => Promise<void>
  readonly jitterMilliseconds?: () => number
}

interface TargetedQuestionRow {
  readonly difficulty: QuestionDifficulty
  readonly level: JlptLevel
  readonly passage: string | null
  readonly questionId: string
  readonly questionText: string
  readonly questionType: QuestionType
  readonly questionVersionId: string
  readonly subject: QuestionSubject
  readonly versionNumber: number
}

interface LockedWrongNoteRow {
  readonly currentReviewQuestionVersionId: string | null
  readonly currentReviewVersionNumber: number | null
  readonly id: string
}

interface ReservationRow {
  readonly id: string
}

interface ExistingTargetedRecordRow {
  readonly contractVersion: number
  readonly expiresAt: Date | null
  readonly id: string
  readonly requestHash: string
  readonly responseBody: unknown
  readonly responseStatus: number | null
  readonly state: 'PROCESSING' | 'SUCCEEDED'
  readonly studySessionId: string
}

export class TargetedReviewWrongNoteNotFoundError extends Error {
  constructor() {
    super('Owned WrongNote was not found for targeted review.')
    this.name = 'TargetedReviewWrongNoteNotFoundError'
  }
}

export class TargetedReviewQuestionNotAvailableError extends Error {
  constructor() {
    super('Targeted review question is not currently available.')
    this.name = 'TargetedReviewQuestionNotAvailableError'
  }
}

export class TargetedReviewIdempotencyKeyReusedError extends Error {
  constructor() {
    super('Targeted review idempotency key was reused for another question.')
    this.name = 'TargetedReviewIdempotencyKeyReusedError'
  }
}

export class WrongNoteTargetedReviewRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Targeted review repository is unavailable.', options)
    this.name = 'WrongNoteTargetedReviewRepositoryUnavailableError'
  }
}

export class WrongNoteTargetedReviewRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WrongNoteTargetedReviewRepositoryIntegrityError'
  }
}

class FreshTargetedReviewTransactionError extends Error {
  constructor() {
    super('Targeted review creation requires a fresh Serializable transaction.')
    this.name = 'FreshTargetedReviewTransactionError'
  }
}

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

const isSerializableConflict = (error: unknown): boolean => {
  if (error instanceof FreshTargetedReviewTransactionError) {
    return true
  }
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false
  }
  const sqlState = error.meta?.code
  return (
    error.code === 'P2034' ||
    (error.code === 'P2010' &&
      (sqlState === '40001' ||
        sqlState === '40P01' ||
        /Code: [`'](?:40001|40P01)[`']/u.test(error.message)))
  )
}

export const hashTargetedReviewCommand = (questionId: string): string =>
  createHash('sha256')
    .update(createTargetedReviewSessionCanonicalMaterial(questionId))
    .digest('hex')

export const createTargetedReviewQuestionLockQuery = (questionId: string) =>
  Prisma.sql`
    SELECT
      question."id" AS "questionId",
      version."id" AS "questionVersionId",
      version."versionNumber",
      version."level",
      version."subject",
      version."questionType",
      version."passage",
      version."questionText",
      version."difficulty"
    FROM "Question" AS question
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
      AND version."id" = question."currentPublishedVersionId"
    WHERE question."id" = ${questionId}::uuid
      AND question."lifecycleStatus" = 'ACTIVE'
      AND version."status" = 'PUBLISHED'
    FOR SHARE OF question, version
  `

export const createTargetedReviewWrongNoteLockQuery = (
  userId: string,
  questionId: string
) => Prisma.sql`
  SELECT
    note."id",
    note."currentReviewQuestionVersionId",
    old_version."versionNumber" AS "currentReviewVersionNumber"
  FROM "WrongNote" AS note
  LEFT JOIN "QuestionVersion" AS old_version
    ON old_version."questionId" = note."questionId"
    AND old_version."id" = note."currentReviewQuestionVersionId"
  WHERE note."userId" = ${userId}::uuid
    AND note."questionId" = ${questionId}::uuid
  FOR UPDATE OF note
`

export const createTargetedReviewExistingRecordQuery = (
  userId: string,
  idempotencyKey: string
) => Prisma.sql`
  SELECT
    record."id",
    record."studySessionId",
    record."requestHash",
    record."contractVersion",
    record."state",
    record."responseStatus",
    record."responseBody",
    record."expiresAt"
  FROM "IdempotencyRecord" AS record
  WHERE record."principalType" = 'USER'
    AND record."userId" = ${userId}::uuid
    AND record."guestPrincipalId" IS NULL
    AND record."operation" = 'STUDY_TARGETED_REVIEW_CREATE'
    AND record."idempotencyKey" = ${idempotencyKey}::uuid
`

const parseStoredResponse = (
  questionId: string,
  value: unknown
): CreateTargetedReviewSessionResponse => {
  try {
    return createTargetedReviewSessionResponseForQuestionSchema(
      questionId
    ).parse(value)
  } catch (error: unknown) {
    throw new WrongNoteTargetedReviewRepositoryIntegrityError(
      'Stored targeted review response violates the response contract.',
      { cause: error }
    )
  }
}

const createReservation = async (
  transaction: Prisma.TransactionClient,
  input: CreateTargetedReviewAtomicInput,
  targetSessionId: string,
  requestHash: string
): Promise<string | null> => {
  const rows = await transaction.$queryRaw<ReservationRow[]>(Prisma.sql`
    INSERT INTO "IdempotencyRecord" (
      "id", "principalType", "userId", "guestPrincipalId",
      "operation", "idempotencyKey", "studySessionId", "requestHash",
      "contractVersion", "state", "createdAt"
    ) VALUES (
      ${randomUUID()}::uuid, 'USER'::"IdempotencyPrincipalType",
      ${input.userId}::uuid, NULL,
      'STUDY_TARGETED_REVIEW_CREATE'::"IdempotencyOperation",
      ${input.idempotencyKey}::uuid, ${targetSessionId}::uuid,
      ${requestHash}, 2, 'PROCESSING'::"IdempotencyState",
      ${input.observedAt}
    ) ON CONFLICT DO NOTHING
    RETURNING "id"
  `)
  return rows[0]?.id ?? null
}

const updateReviewPointer = async (
  transaction: Prisma.TransactionClient,
  note: LockedWrongNoteRow,
  target: TargetedQuestionRow
): Promise<void> => {
  if (note.currentReviewQuestionVersionId === target.questionVersionId) {
    return
  }
  if (
    note.currentReviewQuestionVersionId !== null &&
    (note.currentReviewVersionNumber === null ||
      note.currentReviewVersionNumber >= target.versionNumber)
  ) {
    throw new WrongNoteTargetedReviewRepositoryIntegrityError(
      'WrongNote review pointer cannot be moved to an older version.'
    )
  }

  const updated = await transaction.$executeRaw(Prisma.sql`
    UPDATE "WrongNote"
    SET "currentReviewQuestionVersionId" = ${target.questionVersionId}::uuid
    WHERE "id" = ${note.id}::uuid
      AND "currentReviewQuestionVersionId" IS NOT DISTINCT FROM
        ${note.currentReviewQuestionVersionId}::uuid
  `)
  if (updated !== 1) {
    throw new FreshTargetedReviewTransactionError()
  }
}

const createTargetedReviewInTransaction = async (
  transaction: Prisma.TransactionClient,
  input: CreateTargetedReviewAtomicInput,
  options: WrongNoteTargetedReviewRepositoryOptions
): Promise<CreateTargetedReviewAtomicResult> => {
  const requestHash = hashTargetedReviewCommand(input.questionId)
  let existing: ExistingTargetedRecordRow | null =
    (
      await transaction.$queryRaw<ExistingTargetedRecordRow[]>(
        createTargetedReviewExistingRecordQuery(
          input.userId,
          input.idempotencyKey
        )
      )
    )[0] ?? null
  if (
    existing?.state === 'SUCCEEDED' &&
    existing.expiresAt !== null &&
    existing.expiresAt <= input.observedAt
  ) {
    await transaction.idempotencyRecord.delete({ where: { id: existing.id } })
    existing = null
  }
  if (existing) {
    if (existing.state !== 'SUCCEEDED') {
      throw new WrongNoteTargetedReviewRepositoryIntegrityError(
        'Visible targeted review idempotency state is incomplete.'
      )
    }
    if (
      existing.requestHash !== requestHash ||
      existing.contractVersion !== 2
    ) {
      throw new TargetedReviewIdempotencyKeyReusedError()
    }
    if (
      existing.responseStatus !== 201 ||
      existing.responseBody === null ||
      existing.expiresAt === null
    ) {
      throw new WrongNoteTargetedReviewRepositoryIntegrityError(
        'Visible targeted review idempotency state is incomplete.'
      )
    }
    const response = parseStoredResponse(
      input.questionId,
      existing.responseBody
    )
    if (response.session.id !== existing.studySessionId) {
      throw new WrongNoteTargetedReviewRepositoryIntegrityError(
        'Stored targeted review response targets another StudySession.'
      )
    }
    return { replayed: true, response }
  }

  const owned = await transaction.wrongNote.findFirst({
    where: { userId: input.userId, questionId: input.questionId },
    select: { id: true }
  })
  if (!owned) {
    throw new TargetedReviewWrongNoteNotFoundError()
  }

  const targets = await transaction.$queryRaw<TargetedQuestionRow[]>(
    createTargetedReviewQuestionLockQuery(input.questionId)
  )
  const target = targets[0]
  if (!target) {
    throw new TargetedReviewQuestionNotAvailableError()
  }
  await options.afterQuestionLocked?.()

  await transaction.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
    SELECT 1 AS "locked"
    FROM (
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${input.userId}:${input.questionId}`}, 0)
      )
    ) AS acquired
  `)
  const notes = await transaction.$queryRaw<LockedWrongNoteRow[]>(
    createTargetedReviewWrongNoteLockQuery(input.userId, input.questionId)
  )
  const note = notes[0]
  if (!note || note.id !== owned.id) {
    throw new FreshTargetedReviewTransactionError()
  }

  const sessionId = randomUUID()
  const sessionQuestionId = randomUUID()
  await transaction.studySession.create({
    data: {
      id: sessionId,
      userId: input.userId,
      guestPrincipalId: null,
      retryOfStudySessionId: null,
      level: target.level,
      subject: target.subject,
      mode: 'WRONG_NOTE',
      status: 'IN_PROGRESS',
      requestedCount: 1,
      actualCount: 1,
      usedFallback: false,
      fallbackReason: null,
      practiceContractVersion: 2,
      startedAt: input.observedAt,
      expiresAt: new Date(input.observedAt.getTime() + SESSION_TTL_MS)
    },
    select: { id: true }
  })
  await transaction.studySessionQuestion.create({
    data: {
      id: sessionQuestionId,
      studySessionId: sessionId,
      questionId: target.questionId,
      questionVersionId: target.questionVersionId,
      ordinal: 1,
      createdAt: input.observedAt
    }
  })
  await transaction.studyDraft.create({
    data: {
      studySessionId: sessionId,
      revision: 0,
      currentOrdinal: 1,
      savedAt: null,
      createdAt: input.observedAt,
      updatedAt: input.observedAt
    }
  })
  await transaction.studyDraftAnswer.create({
    data: {
      studySessionId: sessionId,
      studySessionQuestionId: sessionQuestionId,
      questionVersionId: target.questionVersionId,
      selectedOptionId: null,
      elapsedSec: 0,
      updatedAt: input.observedAt
    }
  })

  const reservationId = await createReservation(
    transaction,
    input,
    sessionId,
    requestHash
  )
  if (!reservationId) {
    throw new FreshTargetedReviewTransactionError()
  }
  await options.afterReservation?.()
  await updateReviewPointer(transaction, note, target)
  await options.afterPointerUpdated?.()

  const optionsRows = await transaction.questionOption.findMany({
    where: { questionVersionId: target.questionVersionId },
    orderBy: { ordinal: 'asc' },
    select: { id: true, label: true, text: true }
  })
  const tagRows = await transaction.questionVersionTag.findMany({
    where: { questionVersionId: target.questionVersionId },
    select: { tagId: true, labelSnapshot: true }
  })
  let response: CreateTargetedReviewSessionResponse
  try {
    response = createTargetedReviewSessionResponseForQuestionSchema(
      input.questionId
    ).parse({
      session: {
        id: sessionId,
        level: target.level,
        subject: target.subject,
        mode: 'WRONG_NOTE',
        status: 'IN_PROGRESS',
        requestedCount: 1,
        actualCount: 1,
        usedFallback: false,
        fallbackReason: null,
        startedAt: input.observedAt.toISOString(),
        expiresAt: new Date(
          input.observedAt.getTime() + SESSION_TTL_MS
        ).toISOString(),
        submittedAt: null,
        durationSec: null,
        practiceContractVersion: 2
      },
      questions: [
        {
          sessionQuestionId,
          ordinal: 1,
          question: {
            id: target.questionId,
            questionVersionId: target.questionVersionId,
            level: target.level,
            subject: target.subject,
            questionType: target.questionType,
            passage: target.passage,
            questionText: target.questionText,
            options: optionsRows,
            difficulty: target.difficulty,
            tags: tagRows
              .map(({ labelSnapshot, tagId }) => ({
                id: tagId,
                label: labelSnapshot
              }))
              .toSorted(comparePublicQuestionTags)
          }
        }
      ]
    })
  } catch (error: unknown) {
    throw new WrongNoteTargetedReviewRepositoryIntegrityError(
      'Created targeted review response violates the response contract.',
      { cause: error }
    )
  }
  const finalized = await transaction.idempotencyRecord.updateMany({
    where: {
      id: reservationId,
      state: 'PROCESSING'
    },
    data: {
      state: 'SUCCEEDED',
      responseStatus: 201,
      responseBody: response as unknown as Prisma.InputJsonValue,
      completedAt: input.observedAt,
      expiresAt: new Date(input.observedAt.getTime() + IDEMPOTENCY_RETENTION_MS)
    }
  })
  if (finalized.count !== 1) {
    throw new WrongNoteTargetedReviewRepositoryIntegrityError(
      'Targeted review idempotency finalize did not update one reservation.'
    )
  }
  return { replayed: false, response }
}

export const createPrismaWrongNoteTargetedReviewRepository = (
  client: PrismaClient,
  options: WrongNoteTargetedReviewRepositoryOptions = {}
): WrongNoteTargetedReviewRepository => {
  const retryDelay = options.delay ?? delay
  const jitterMilliseconds =
    options.jitterMilliseconds ?? (() => randomInt(0, RETRY_JITTER_MAX_MS + 1))

  return {
    createAtomic: async (input) => {
      try {
        for (
          let attempt = 1;
          attempt <= MAX_TRANSACTION_ATTEMPTS;
          attempt += 1
        ) {
          try {
            return await client.$transaction(
              (transaction) =>
                createTargetedReviewInTransaction(transaction, input, options),
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
            )
          } catch (error: unknown) {
            if (!isSerializableConflict(error)) {
              throw error
            }
            if (attempt === MAX_TRANSACTION_ATTEMPTS) {
              throw new WrongNoteTargetedReviewRepositoryUnavailableError({
                cause: error
              })
            }
            await retryDelay(
              attempt * RETRY_BASE_DELAY_MS + jitterMilliseconds()
            )
          }
        }
      } catch (error: unknown) {
        if (isDatabaseUnavailableError(error)) {
          throw new WrongNoteTargetedReviewRepositoryUnavailableError({
            cause: error
          })
        }
        throw error
      }
      throw new WrongNoteTargetedReviewRepositoryIntegrityError(
        'Targeted review transaction budget was exhausted.'
      )
    }
  }
}
