import { createHash, randomInt, randomUUID } from 'node:crypto'
import { createResultRetrySessionResponseSchema } from '@nihongo/contracts/study/create-result-retry-session'
import type { VersionedStudySessionPayload } from '@nihongo/contracts/study/study-session'
import {
  ResultRetrySelectionError,
  selectResultRetryCandidates,
  type ResultRetryCandidate
} from '@nihongo/domain/selection/select-result-retry-candidates'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  GuestCredentialExpiredError,
  NoEligibleQuestionsError,
  loadStudySessionRecord,
  type ExistingStudyOwner
} from './studySessionRepository.js'
import { toVersionedStudySessionPayload } from './studySessionMapper.js'

const MAX_TRANSACTION_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 5
const RETRY_JITTER_MAX_MS = 5
const RETRY_SESSION_TTL_MS = 24 * 60 * 60 * 1_000
const RETRY_IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const RETRY_COMMAND_VERSION = 'study-result-retry-v1'
const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])

const delay = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds))

export interface CreateResultRetryAtomicInput {
  readonly idempotencyKey: string
  readonly observedAt: Date
  readonly owner: ExistingStudyOwner
  readonly sourceSessionId: string
}

export interface CreateResultRetryAtomicResult {
  readonly replayed: boolean
  readonly response: VersionedStudySessionPayload
}

export interface StudyResultRetryRepository {
  createAtomic: (
    input: CreateResultRetryAtomicInput
  ) => Promise<CreateResultRetryAtomicResult>
}

interface StudyResultRetryRepositoryOptions {
  readonly afterReservation?: () => Promise<void>
  readonly delay?: (milliseconds: number) => Promise<void>
  readonly jitterMilliseconds?: () => number
}

interface RetrySourceRow {
  actualCount: number
  guestPrincipalId: string | null
  id: string
  level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'CANCELLED' | 'EXPIRED'
  subject: 'VOCABULARY' | 'GRAMMAR' | 'READING'
  userId: string | null
}

interface RetryCandidateRow {
  isCorrect: boolean
  ordinal: number
  questionId: string
  questionLifecycleStatus: 'ACTIVE' | 'ARCHIVED' | null
  questionVersionId: string
  questionVersionStatus: 'DRAFT' | 'PUBLISHED' | 'RETIRED' | null
}

interface ReservationRow {
  id: string
}

interface LockedRetryCandidateRow {
  questionId: string
  questionLifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  questionVersionId: string
  questionVersionStatus: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
}

export class ResultRetrySourceNotFoundError extends Error {
  constructor() {
    super('Owned retry source session was not found.')
    this.name = 'ResultRetrySourceNotFoundError'
  }
}

export class ResultRetryStudyResultNotReadyError extends Error {
  constructor() {
    super('Retry source result is not ready.')
    this.name = 'ResultRetryStudyResultNotReadyError'
  }
}

export class ResultRetryIdempotencyKeyReusedError extends Error {
  constructor() {
    super('Retry idempotency key was reused for another command.')
    this.name = 'ResultRetryIdempotencyKeyReusedError'
  }
}

export class StudyResultRetryRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Study result retry repository is unavailable.', options)
    this.name = 'StudyResultRetryRepositoryUnavailableError'
  }
}

export class StudyResultRetryRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StudyResultRetryRepositoryIntegrityError'
  }
}

class FreshRetryTransactionError extends Error {
  constructor() {
    super('Retry creation requires a fresh Serializable transaction.')
    this.name = 'FreshRetryTransactionError'
  }
}

export const hashStudyResultRetryCommand = (sourceSessionId: string): string =>
  createHash('sha256')
    .update(`${RETRY_COMMAND_VERSION}\n${sourceSessionId}`)
    .digest('hex')

const ownerWhere = (owner: ExistingStudyOwner) =>
  owner.kind === 'USER'
    ? {
        principalType: 'USER' as const,
        userId: owner.userId,
        guestPrincipalId: null
      }
    : {
        principalType: 'GUEST' as const,
        userId: null,
        guestPrincipalId: owner.guestPrincipalId
      }

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

const isSerializableConflict = (error: unknown): boolean => {
  if (error instanceof FreshRetryTransactionError) {
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

const assertGuestProof = async (
  transaction: Prisma.TransactionClient,
  owner: Extract<ExistingStudyOwner, { kind: 'GUEST' }>,
  observedAt: Date
): Promise<Date> => {
  const rows = await transaction.$queryRaw<Array<{ expiresAt: Date }>>(
    Prisma.sql`
      SELECT guest."expiresAt"
      FROM "GuestPrincipal" AS guest
      WHERE guest."id" = ${owner.guestPrincipalId}::uuid
        AND guest."tokenDigest" = ${owner.tokenDigest}
        AND guest."expiresAt" > ${observedAt}
      FOR NO KEY UPDATE OF guest
    `
  )
  const proof = rows[0]
  if (!proof) {
    throw new GuestCredentialExpiredError()
  }
  return proof.expiresAt
}

const loadLockedSource = async (
  transaction: Prisma.TransactionClient,
  input: CreateResultRetryAtomicInput
): Promise<RetrySourceRow | null> => {
  const ownerPredicate =
    input.owner.kind === 'USER'
      ? Prisma.sql`source."userId" = ${input.owner.userId}::uuid
          AND source."guestPrincipalId" IS NULL`
      : Prisma.sql`source."guestPrincipalId" = ${input.owner.guestPrincipalId}::uuid
          AND source."userId" IS NULL`

  const rows = await transaction.$queryRaw<RetrySourceRow[]>(Prisma.sql`
    SELECT
      source."id",
      source."userId",
      source."guestPrincipalId",
      source."level",
      source."subject",
      source."status",
      source."actualCount"
    FROM "StudySession" AS source
    WHERE source."id" = ${input.sourceSessionId}::uuid
      AND ${ownerPredicate}
    FOR KEY SHARE OF source
  `)
  return rows[0] ?? null
}

const loadRetryCandidates = async (
  transaction: Prisma.TransactionClient,
  sourceSessionId: string
): Promise<RetryCandidateRow[]> =>
  await transaction.$queryRaw<RetryCandidateRow[]>(Prisma.sql`
    SELECT
      item."questionId",
      item."questionVersionId",
      item."ordinal",
      COALESCE(answer."isCorrect", FALSE) AS "isCorrect",
      question."lifecycleStatus" AS "questionLifecycleStatus",
      version."status" AS "questionVersionStatus"
    FROM "StudySessionQuestion" AS item
    LEFT JOIN "StudyAnswer" AS answer
      ON answer."studySessionQuestionId" = item."id"
      AND answer."questionVersionId" = item."questionVersionId"
    LEFT JOIN "Question" AS question
      ON question."id" = item."questionId"
    LEFT JOIN "QuestionVersion" AS version
      ON version."questionId" = item."questionId"
      AND version."id" = item."questionVersionId"
    WHERE item."studySessionId" = ${sourceSessionId}::uuid
    ORDER BY item."ordinal" ASC, item."id" ASC
  `)

const lockRetryCandidates = async (
  transaction: Prisma.TransactionClient,
  candidates: readonly ResultRetryCandidate[]
): Promise<void> => {
  const ordered = candidates.toSorted((left, right) =>
    left.questionId === right.questionId
      ? left.questionVersionId < right.questionVersionId
        ? -1
        : left.questionVersionId === right.questionVersionId
          ? 0
          : 1
      : left.questionId < right.questionId
        ? -1
        : 1
  )
  const pairs = ordered.map(
    ({ questionId, questionVersionId }) =>
      Prisma.sql`(${questionId}::uuid, ${questionVersionId}::uuid)`
  )
  const locked = await transaction.$queryRaw<LockedRetryCandidateRow[]>(
    Prisma.sql`
      SELECT
        question."id" AS "questionId",
        question."lifecycleStatus" AS "questionLifecycleStatus",
        version."id" AS "questionVersionId",
        version."status" AS "questionVersionStatus"
      FROM "Question" AS question
      JOIN "QuestionVersion" AS version
        ON version."questionId" = question."id"
      WHERE (question."id", version."id") IN (${Prisma.join(pairs)})
      ORDER BY question."id" ASC, version."id" ASC
      FOR SHARE OF question, version
    `
  )
  if (
    locked.length !== ordered.length ||
    locked.some(
      (candidate, index) =>
        candidate.questionId !== ordered[index]?.questionId ||
        candidate.questionVersionId !== ordered[index]?.questionVersionId ||
        candidate.questionLifecycleStatus !== 'ACTIVE' ||
        (candidate.questionVersionStatus !== 'PUBLISHED' &&
          candidate.questionVersionStatus !== 'RETIRED')
    )
  ) {
    throw new FreshRetryTransactionError()
  }
}

const parseStoredResponse = (value: unknown): VersionedStudySessionPayload => {
  try {
    return createResultRetrySessionResponseSchema.parse(value)
  } catch (error: unknown) {
    throw new StudyResultRetryRepositoryIntegrityError(
      'Stored retry response does not satisfy the retry contract.',
      { cause: error }
    )
  }
}

const createReservation = async (
  transaction: Prisma.TransactionClient,
  input: CreateResultRetryAtomicInput,
  targetSessionId: string,
  requestHash: string
): Promise<boolean> => {
  const id = randomUUID()
  const rows =
    input.owner.kind === 'USER'
      ? await transaction.$queryRaw<ReservationRow[]>(Prisma.sql`
          INSERT INTO "IdempotencyRecord" (
            "id", "principalType", "userId", "guestPrincipalId",
            "operation", "idempotencyKey", "studySessionId", "requestHash",
            "contractVersion", "state", "createdAt"
          ) VALUES (
            ${id}::uuid, 'USER'::"IdempotencyPrincipalType",
            ${input.owner.userId}::uuid, NULL,
            'STUDY_RETRY_CREATE'::"IdempotencyOperation",
            ${input.idempotencyKey}::uuid, ${targetSessionId}::uuid,
            ${requestHash}, 2, 'PROCESSING'::"IdempotencyState",
            ${input.observedAt}
          ) ON CONFLICT DO NOTHING
          RETURNING "id"
        `)
      : await transaction.$queryRaw<ReservationRow[]>(Prisma.sql`
          INSERT INTO "IdempotencyRecord" (
            "id", "principalType", "userId", "guestPrincipalId",
            "operation", "idempotencyKey", "studySessionId", "requestHash",
            "contractVersion", "state", "createdAt"
          ) VALUES (
            ${id}::uuid, 'GUEST'::"IdempotencyPrincipalType", NULL,
            ${input.owner.guestPrincipalId}::uuid,
            'STUDY_RETRY_CREATE'::"IdempotencyOperation",
            ${input.idempotencyKey}::uuid, ${targetSessionId}::uuid,
            ${requestHash}, 2, 'PROCESSING'::"IdempotencyState",
            ${input.observedAt}
          ) ON CONFLICT DO NOTHING
          RETURNING "id"
        `)
  return rows.length === 1
}

const createRetryInTransaction = async (
  transaction: Prisma.TransactionClient,
  input: CreateResultRetryAtomicInput,
  options: StudyResultRetryRepositoryOptions
): Promise<CreateResultRetryAtomicResult> => {
  const requestHash = hashStudyResultRetryCommand(input.sourceSessionId)
  const guestProofExpiresAt =
    input.owner.kind === 'GUEST'
      ? await assertGuestProof(transaction, input.owner, input.observedAt)
      : null
  let existing = await transaction.idempotencyRecord.findFirst({
    where: {
      ...ownerWhere(input.owner),
      operation: 'STUDY_RETRY_CREATE',
      idempotencyKey: input.idempotencyKey
    },
    select: {
      id: true,
      studySessionId: true,
      requestHash: true,
      contractVersion: true,
      state: true,
      responseStatus: true,
      responseBody: true,
      expiresAt: true
    }
  })
  if (
    existing?.state === 'SUCCEEDED' &&
    existing.expiresAt !== null &&
    existing.expiresAt <= input.observedAt
  ) {
    await transaction.idempotencyRecord.delete({ where: { id: existing.id } })
    existing = null
  }
  if (existing) {
    if (
      existing.requestHash !== requestHash ||
      existing.contractVersion !== 2
    ) {
      throw new ResultRetryIdempotencyKeyReusedError()
    }
    if (
      existing.state !== 'SUCCEEDED' ||
      existing.responseStatus !== 201 ||
      existing.responseBody === null
    ) {
      throw new FreshRetryTransactionError()
    }
    const response = parseStoredResponse(existing.responseBody)
    if (response.session.id !== existing.studySessionId) {
      throw new StudyResultRetryRepositoryIntegrityError(
        'Stored retry response targets another StudySession.'
      )
    }
    return { replayed: true, response }
  }

  const source = await loadLockedSource(transaction, input)
  if (!source) {
    throw new ResultRetrySourceNotFoundError()
  }
  const sourceResult = await transaction.studyResult.findUnique({
    where: { studySessionId: input.sourceSessionId },
    select: { incorrectCount: true }
  })
  if (source.status !== 'SUBMITTED' || !sourceResult) {
    throw new ResultRetryStudyResultNotReadyError()
  }

  const sourceQuestions = await loadRetryCandidates(
    transaction,
    input.sourceSessionId
  )
  let retrySelection: ReturnType<typeof selectResultRetryCandidates>
  try {
    retrySelection = selectResultRetryCandidates(sourceQuestions)
  } catch (error: unknown) {
    if (error instanceof ResultRetrySelectionError) {
      throw new StudyResultRetryRepositoryIntegrityError(
        'Retry source candidates violate stable selection invariants.',
        { cause: error }
      )
    }
    throw error
  }
  const { candidates: selected, requestedCount: selectedIncorrectCount } =
    retrySelection
  if (selected.length === 0) {
    throw new NoEligibleQuestionsError()
  }
  if (
    selectedIncorrectCount > sourceResult.incorrectCount ||
    sourceResult.incorrectCount > source.actualCount
  ) {
    throw new StudyResultRetryRepositoryIntegrityError(
      'Retry source incorrect aggregate does not match its result.'
    )
  }
  const requestedCount = sourceResult.incorrectCount
  await lockRetryCandidates(transaction, selected)

  const expiresAt = new Date(input.observedAt.getTime() + RETRY_SESSION_TTL_MS)
  const targetExpiresAt =
    guestProofExpiresAt && guestProofExpiresAt < expiresAt
      ? guestProofExpiresAt
      : expiresAt
  const target = await transaction.studySession.create({
    data: {
      userId: source.userId,
      guestPrincipalId: source.guestPrincipalId,
      retryOfStudySessionId: source.id,
      level: source.level,
      subject: source.subject,
      mode: input.owner.kind === 'USER' ? 'WRONG_NOTE' : 'RANDOM',
      status: 'IN_PROGRESS',
      requestedCount,
      actualCount: selected.length,
      usedFallback: false,
      fallbackReason: null,
      practiceContractVersion: 2,
      startedAt: input.observedAt,
      expiresAt: targetExpiresAt
    },
    select: { id: true }
  })
  const sessionQuestions = selected.map((question, index) => ({
    id: randomUUID(),
    studySessionId: target.id,
    questionId: question.questionId,
    questionVersionId: question.questionVersionId,
    ordinal: index + 1,
    createdAt: input.observedAt
  }))
  await transaction.studySessionQuestion.createMany({
    data: sessionQuestions
  })
  await transaction.studyDraft.create({
    data: {
      studySessionId: target.id,
      revision: 0,
      currentOrdinal: 1,
      savedAt: null,
      createdAt: input.observedAt,
      updatedAt: input.observedAt,
      answers: {
        createMany: {
          data: sessionQuestions.map((question) => ({
            studySessionQuestionId: question.id,
            questionVersionId: question.questionVersionId,
            selectedOptionId: null,
            elapsedSec: 0,
            updatedAt: input.observedAt
          }))
        }
      }
    }
  })

  if (!(await createReservation(transaction, input, target.id, requestHash))) {
    throw new FreshRetryTransactionError()
  }
  await options.afterReservation?.()

  const record = await loadStudySessionRecord(transaction, target.id)
  if (!record) {
    throw new StudyResultRetryRepositoryIntegrityError(
      'Created retry StudySession could not be projected.'
    )
  }
  const response = createResultRetrySessionResponseSchema.parse(
    toVersionedStudySessionPayload(record)
  )
  const finalized = await transaction.idempotencyRecord.updateMany({
    where: {
      ...ownerWhere(input.owner),
      operation: 'STUDY_RETRY_CREATE',
      idempotencyKey: input.idempotencyKey,
      state: 'PROCESSING'
    },
    data: {
      state: 'SUCCEEDED',
      responseStatus: 201,
      responseBody: response as unknown as Prisma.InputJsonValue,
      completedAt: input.observedAt,
      expiresAt: new Date(
        input.observedAt.getTime() + RETRY_IDEMPOTENCY_RETENTION_MS
      )
    }
  })
  if (finalized.count !== 1) {
    throw new StudyResultRetryRepositoryIntegrityError(
      'Retry idempotency finalize did not update one reservation.'
    )
  }
  return { replayed: false, response }
}

export const createPrismaStudyResultRetryRepository = (
  client: PrismaClient,
  options: StudyResultRetryRepositoryOptions = {}
): StudyResultRetryRepository => {
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
                createRetryInTransaction(transaction, input, options),
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
            )
          } catch (error: unknown) {
            if (!isSerializableConflict(error)) {
              throw error
            }
            if (attempt === MAX_TRANSACTION_ATTEMPTS) {
              throw new StudyResultRetryRepositoryUnavailableError({
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
          throw new StudyResultRetryRepositoryUnavailableError({
            cause: error
          })
        }
        throw error
      }
      throw new StudyResultRetryRepositoryIntegrityError(
        'Retry transaction budget was exhausted.'
      )
    }
  }
}
