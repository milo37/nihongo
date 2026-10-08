import { randomInt, randomUUID } from 'node:crypto'
import { saveStudyDraftAnswersResponseSchema } from '@nihongo/contracts/study/save-study-draft-answers'
import type { ParsedSaveStudyDraftAnswersBody } from '@nihongo/contracts/study/save-study-draft-answers'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import type {
  ParsedListResumableStudySessionsQuery,
  ResumableStudySessionSummary
} from '@nihongo/contracts/study/list-resumable-study-sessions'
import {
  Prisma,
  type PrismaClient,
  type StudySessionStatus
} from '../generated/prisma/client.js'
import {
  GuestCredentialExpiredError,
  type ExistingStudyOwner
} from './studySessionRepository.js'
import {
  canonicalizeStudyDraftSave,
  hashStudyDraftSave
} from './studyDraftCanonicalizer.js'
import {
  IdempotencyKeyReusedError,
  StudySubmissionRepositoryUnavailableError
} from './studySubmissionRepository.js'

const MAX_TRANSACTION_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 5
const RETRY_JITTER_MAX_MS = 5
const DRAFT_IDEMPOTENCY_RETENTION_MS = 48 * 60 * 60 * 1_000
const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])

interface StudyDraftRepositoryOptions {
  afterCancelSessionLocked?: () => Promise<void>
  afterSessionLocked?: () => Promise<void>
  beforeFinalize?: () => Promise<void>
  delay?: (milliseconds: number) => Promise<void>
  jitterMilliseconds?: () => number
}

interface LockedSessionRow {
  expiresAt: Date
  guestPrincipalId: string | null
  id: string
  practiceContractVersion: number
  startedAt: Date
  status: StudySessionStatus
  userId: string | null
}

interface DraftQuestionRow {
  ordinal: number
  optionIds: string[]
  questionVersionId: string
  studySessionQuestionId: string
}

interface ReservationRow {
  id: string
}

export interface SaveStudyDraftAtomicInput {
  readonly body: ParsedSaveStudyDraftAnswersBody
  readonly idempotencyKey: string
  readonly observedAt: Date
  readonly owner: ExistingStudyOwner
  readonly sessionId: string
}

export interface SaveStudyDraftAtomicResult {
  readonly replayed: boolean
  readonly response: StudyDraftSnapshot
}

export type CancelOwnedStudySessionOutcome =
  | { readonly kind: 'CANCELLED' }
  | { readonly kind: 'NOT_EDITABLE' }
  | { readonly kind: 'NOT_FOUND' }

export interface StudyDraftRepository {
  cancelOwned: (
    sessionId: string,
    owner: ExistingStudyOwner,
    observedAt: Date
  ) => Promise<CancelOwnedStudySessionOutcome>
  findOwned: (
    sessionId: string,
    owner: ExistingStudyOwner,
    observedAt: Date
  ) => Promise<StudyDraftSnapshot | null>
  listOwnedResumable: (
    owner: ExistingStudyOwner,
    query: ParsedListResumableStudySessionsQuery,
    observedAt: Date
  ) => Promise<{
    items: ResumableStudySessionSummary[]
    page: number
    pageSize: number
    total: number
  }>
  saveAtomic: (
    input: SaveStudyDraftAtomicInput
  ) => Promise<SaveStudyDraftAtomicResult>
}

export class PracticeContractVersionMismatchError extends Error {
  constructor() {
    super('StudySession practice contract version does not support drafts.')
    this.name = 'PracticeContractVersionMismatchError'
  }
}

export class OwnedStudyDraftSessionNotFoundError extends Error {
  constructor() {
    super('Owned StudySession does not exist.')
    this.name = 'OwnedStudyDraftSessionNotFoundError'
  }
}

export class DraftVersionConflictError extends Error {
  constructor() {
    super('StudyDraft revision does not match expectedRevision.')
    this.name = 'DraftVersionConflictError'
  }
}

export class DraftAnswerNotInSessionError extends Error {
  constructor() {
    super('Draft answer set does not exactly cover the StudySession.')
    this.name = 'DraftAnswerNotInSessionError'
  }
}

export class DraftOptionNotInVersionError extends Error {
  constructor() {
    super('Draft selected option does not belong to the pinned version.')
    this.name = 'DraftOptionNotInVersionError'
  }
}

export class StudyDraftNotEditableError extends Error {
  constructor() {
    super('StudyDraft is not editable.')
    this.name = 'StudyDraftNotEditableError'
  }
}

export class StudyDraftRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StudyDraftRepositoryIntegrityError'
  }
}

class FreshDraftTransactionRetry extends Error {
  constructor() {
    super('Draft save requires a fresh Serializable transaction.')
    this.name = 'FreshDraftTransactionRetry'
  }
}

const delay = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds))

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

const isSerializableConflict = (error: unknown): boolean => {
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

const ownerWhere = (owner: ExistingStudyOwner) =>
  owner.kind === 'USER'
    ? { userId: owner.userId }
    : { guestPrincipalId: owner.guestPrincipalId }

const idempotencyOwnerWhere = (owner: ExistingStudyOwner) =>
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

const assertGuestProof = async (
  client: Prisma.TransactionClient | PrismaClient,
  owner: Extract<ExistingStudyOwner, { kind: 'GUEST' }>,
  observedAt: Date
): Promise<void> => {
  const guest = await client.guestPrincipal.findFirst({
    where: {
      id: owner.guestPrincipalId,
      tokenDigest: owner.tokenDigest,
      expiresAt: { gt: observedAt }
    },
    select: { id: true }
  })
  if (!guest) {
    throw new GuestCredentialExpiredError()
  }
}

const lockOwnedSession = async (
  transaction: Prisma.TransactionClient,
  sessionId: string,
  owner: ExistingStudyOwner
): Promise<LockedSessionRow | null> => {
  const rows =
    owner.kind === 'USER'
      ? await transaction.$queryRaw<LockedSessionRow[]>(Prisma.sql`
          SELECT
            session."id",
            session."userId",
            session."guestPrincipalId",
            session."status",
            session."expiresAt",
            session."startedAt",
            session."practiceContractVersion"
          FROM "StudySession" AS session
          WHERE session."id" = ${sessionId}::uuid
            AND session."userId" = ${owner.userId}::uuid
            AND session."guestPrincipalId" IS NULL
          FOR UPDATE OF session
        `)
      : await transaction.$queryRaw<LockedSessionRow[]>(Prisma.sql`
          SELECT
            session."id",
            session."userId",
            session."guestPrincipalId",
            session."status",
            session."expiresAt",
            session."startedAt",
            session."practiceContractVersion"
          FROM "StudySession" AS session
          WHERE session."id" = ${sessionId}::uuid
            AND session."guestPrincipalId" = ${owner.guestPrincipalId}::uuid
            AND session."userId" IS NULL
          FOR UPDATE OF session
        `)
  return rows[0] ?? null
}

const loadDraftQuestions = async (
  transaction: Prisma.TransactionClient,
  sessionId: string
): Promise<DraftQuestionRow[]> => {
  const questions = await transaction.studySessionQuestion.findMany({
    where: { studySessionId: sessionId },
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      ordinal: true,
      questionVersionId: true,
      questionVersion: {
        select: { options: { select: { id: true } } }
      }
    }
  })
  return questions.map((question) => ({
    studySessionQuestionId: question.id,
    questionVersionId: question.questionVersionId,
    ordinal: question.ordinal,
    optionIds: question.questionVersion.options.map(({ id }) => id)
  }))
}

const loadDraftSnapshot = async (
  client: Prisma.TransactionClient | PrismaClient,
  sessionId: string
): Promise<StudyDraftSnapshot | null> => {
  const draft = await client.studyDraft.findUnique({
    where: { studySessionId: sessionId },
    select: {
      studySessionId: true,
      revision: true,
      currentOrdinal: true,
      savedAt: true,
      answers: {
        orderBy: { studySessionQuestion: { ordinal: 'asc' } },
        select: {
          studySessionQuestionId: true,
          selectedOptionId: true,
          elapsedSec: true
        }
      }
    }
  })
  if (!draft) {
    return null
  }
  return saveStudyDraftAnswersResponseSchema.parse({
    studySessionId: draft.studySessionId,
    revision: draft.revision,
    currentOrdinal: draft.currentOrdinal,
    savedAt: draft.savedAt?.toISOString() ?? null,
    answers: draft.answers
  })
}

const expireLockedSession = async (
  transaction: Prisma.TransactionClient,
  sessionId: string,
  observedAt: Date
): Promise<void> => {
  await transaction.studySession.update({
    where: { id: sessionId },
    data: { status: 'EXPIRED', updatedAt: observedAt }
  })
  await transaction.studyDraft.deleteMany({
    where: { studySessionId: sessionId }
  })
}

const validateDraftBody = (
  questions: readonly DraftQuestionRow[],
  body: ParsedSaveStudyDraftAnswersBody
): void => {
  if (questions.length !== body.answers.length) {
    throw new DraftAnswerNotInSessionError()
  }
  const answerById = new Map(
    body.answers.map((answer) => [answer.studySessionQuestionId, answer])
  )
  for (const question of questions) {
    const answer = answerById.get(question.studySessionQuestionId)
    if (!answer) {
      throw new DraftAnswerNotInSessionError()
    }
    if (
      answer.selectedOptionId !== null &&
      !question.optionIds.includes(answer.selectedOptionId)
    ) {
      throw new DraftOptionNotInVersionError()
    }
  }
}

const reserveDraftIdempotency = async (
  transaction: Prisma.TransactionClient,
  input: SaveStudyDraftAtomicInput,
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
            'STUDY_DRAFT_SAVE'::"IdempotencyOperation",
            ${input.idempotencyKey}::uuid, ${input.sessionId}::uuid,
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
            'STUDY_DRAFT_SAVE'::"IdempotencyOperation",
            ${input.idempotencyKey}::uuid, ${input.sessionId}::uuid,
            ${requestHash}, 2, 'PROCESSING'::"IdempotencyState",
            ${input.observedAt}
          ) ON CONFLICT DO NOTHING
          RETURNING "id"
        `)
  return rows.length === 1
}

type RunSaveOutcome =
  | { readonly kind: 'IDEMPOTENCY_KEY_REUSED' }
  | {
      readonly kind: 'INTEGRITY_ERROR'
      readonly message: string
    }
  | { readonly kind: 'NOT_EDITABLE' }
  | {
      readonly kind: 'SAVED'
      readonly value: SaveStudyDraftAtomicResult
    }

const runSave = async (
  transaction: Prisma.TransactionClient,
  input: SaveStudyDraftAtomicInput,
  options: StudyDraftRepositoryOptions
): Promise<RunSaveOutcome> => {
  if (input.owner.kind === 'GUEST') {
    await assertGuestProof(transaction, input.owner, input.observedAt)
  }
  const session = await lockOwnedSession(
    transaction,
    input.sessionId,
    input.owner
  )
  if (!session) {
    throw new OwnedStudyDraftSessionNotFoundError()
  }
  await options.afterSessionLocked?.()

  const observedExpired =
    session.practiceContractVersion === 2 &&
    session.status === 'IN_PROGRESS' &&
    session.expiresAt <= input.observedAt
  if (observedExpired) {
    await expireLockedSession(transaction, input.sessionId, input.observedAt)
  }

  const questions = await loadDraftQuestions(transaction, input.sessionId)
  const requestHash = hashStudyDraftSave(
    canonicalizeStudyDraftSave(input.sessionId, questions, input.body)
  )
  let existing = await transaction.idempotencyRecord.findFirst({
    where: {
      ...idempotencyOwnerWhere(input.owner),
      operation: 'STUDY_DRAFT_SAVE',
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
      existing.studySessionId !== input.sessionId ||
      existing.requestHash !== requestHash ||
      existing.contractVersion !== 2
    ) {
      if (observedExpired) {
        return { kind: 'IDEMPOTENCY_KEY_REUSED' }
      }
      throw new IdempotencyKeyReusedError()
    }
    if (
      existing.state !== 'SUCCEEDED' ||
      existing.responseStatus !== 200 ||
      existing.responseBody === null
    ) {
      const message = 'Stored draft idempotency response is incomplete.'
      if (observedExpired) {
        return { kind: 'INTEGRITY_ERROR', message }
      }
      throw new StudyDraftRepositoryIntegrityError(message)
    }
    return {
      kind: 'SAVED',
      value: {
        replayed: true,
        response: saveStudyDraftAnswersResponseSchema.parse(
          existing.responseBody
        )
      }
    }
  }

  if (observedExpired) {
    return { kind: 'NOT_EDITABLE' }
  }

  if (session.practiceContractVersion !== 2) {
    throw new PracticeContractVersionMismatchError()
  }
  if (session.status !== 'IN_PROGRESS') {
    throw new StudyDraftNotEditableError()
  }
  const draft = await transaction.studyDraft.findUnique({
    where: { studySessionId: input.sessionId },
    select: { revision: true, createdAt: true, updatedAt: true }
  })
  if (!draft) {
    throw new StudyDraftRepositoryIntegrityError(
      'Version 2 StudySession has no draft.'
    )
  }
  if (draft.revision !== input.body.expectedRevision) {
    throw new DraftVersionConflictError()
  }
  validateDraftBody(questions, input.body)

  if (!(await reserveDraftIdempotency(transaction, input, requestHash))) {
    throw new FreshDraftTransactionRetry()
  }
  const savedAt = new Date(
    Math.max(input.observedAt.getTime(), draft.updatedAt.getTime() + 1)
  )
  const answerById = new Map(
    input.body.answers.map((answer) => [answer.studySessionQuestionId, answer])
  )
  for (const question of questions) {
    const answer = answerById.get(question.studySessionQuestionId)
    if (!answer) {
      throw new DraftAnswerNotInSessionError()
    }
    await transaction.studyDraftAnswer.update({
      where: {
        studySessionId_studySessionQuestionId: {
          studySessionId: input.sessionId,
          studySessionQuestionId: question.studySessionQuestionId
        }
      },
      data: {
        selectedOptionId: answer.selectedOptionId,
        elapsedSec: answer.elapsedSec,
        updatedAt: savedAt
      }
    })
  }
  await transaction.studyDraft.update({
    where: { studySessionId: input.sessionId },
    data: {
      revision: { increment: 1 },
      currentOrdinal: input.body.currentOrdinal,
      savedAt,
      updatedAt: savedAt
    }
  })
  const response = await loadDraftSnapshot(transaction, input.sessionId)
  if (!response) {
    throw new StudyDraftRepositoryIntegrityError(
      'Updated StudyDraft could not be projected.'
    )
  }
  await options.beforeFinalize?.()
  const finalized = await transaction.idempotencyRecord.updateMany({
    where: {
      ...idempotencyOwnerWhere(input.owner),
      operation: 'STUDY_DRAFT_SAVE',
      idempotencyKey: input.idempotencyKey,
      state: 'PROCESSING'
    },
    data: {
      state: 'SUCCEEDED',
      responseStatus: 200,
      responseBody: response as unknown as Prisma.InputJsonValue,
      completedAt: savedAt,
      expiresAt: new Date(savedAt.getTime() + DRAFT_IDEMPOTENCY_RETENTION_MS)
    }
  })
  if (finalized.count !== 1) {
    throw new StudyDraftRepositoryIntegrityError(
      'Draft idempotency finalize did not update exactly one row.'
    )
  }
  return { kind: 'SAVED', value: { replayed: false, response } }
}

export const createPrismaStudyDraftRepository = (
  client: PrismaClient,
  options: StudyDraftRepositoryOptions = {}
): StudyDraftRepository => {
  const retryDelay = options.delay ?? delay
  const jitterMilliseconds =
    options.jitterMilliseconds ?? (() => randomInt(0, RETRY_JITTER_MAX_MS + 1))

  const withRepositoryErrors = async <Result>(
    operation: () => Promise<Result>
  ): Promise<Result> => {
    try {
      return await operation()
    } catch (error: unknown) {
      if (isDatabaseUnavailableError(error)) {
        throw new StudySubmissionRepositoryUnavailableError({ cause: error })
      }
      throw error
    }
  }

  return {
    findOwned: (sessionId, owner, observedAt) =>
      withRepositoryErrors(async () => {
        const outcome = await client.$transaction(
          async (transaction) => {
            if (owner.kind === 'GUEST') {
              await assertGuestProof(transaction, owner, observedAt)
            }
            const session = await lockOwnedSession(
              transaction,
              sessionId,
              owner
            )
            if (!session) {
              return { kind: 'NOT_FOUND' } as const
            }
            if (session.practiceContractVersion !== 2) {
              throw new PracticeContractVersionMismatchError()
            }
            if (session.status !== 'IN_PROGRESS') {
              return { kind: 'NOT_EDITABLE' } as const
            }
            if (session.expiresAt <= observedAt) {
              await expireLockedSession(transaction, sessionId, observedAt)
              return { kind: 'NOT_EDITABLE' } as const
            }
            const draft = await loadDraftSnapshot(transaction, sessionId)
            if (!draft) {
              throw new StudyDraftRepositoryIntegrityError(
                'Version 2 StudySession has no draft.'
              )
            }
            return { kind: 'FOUND', draft } as const
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        )
        if (outcome.kind === 'NOT_FOUND') {
          return null
        }
        if (outcome.kind === 'NOT_EDITABLE') {
          throw new StudyDraftNotEditableError()
        }
        return outcome.draft
      }),
    listOwnedResumable: (owner, query, observedAt) =>
      withRepositoryErrors(async () => {
        if (owner.kind === 'GUEST') {
          await assertGuestProof(client, owner, observedAt)
        }
        return await client.$transaction(
          async (transaction) => {
            const where = {
              ...ownerWhere(owner),
              status: 'IN_PROGRESS' as const,
              expiresAt: { gt: observedAt }
            }
            const total = await transaction.studySession.count({ where })
            const sessions = await transaction.studySession.findMany({
              where,
              orderBy: [
                { draft: { savedAt: { sort: 'desc', nulls: 'last' } } },
                { startedAt: 'desc' },
                { id: 'asc' }
              ],
              skip: (query.page - 1) * query.pageSize,
              take: query.pageSize,
              select: {
                id: true,
                level: true,
                subject: true,
                mode: true,
                status: true,
                actualCount: true,
                startedAt: true,
                expiresAt: true,
                practiceContractVersion: true,
                draft: {
                  select: {
                    revision: true,
                    currentOrdinal: true,
                    savedAt: true
                  }
                }
              }
            })
            const items: ResumableStudySessionSummary[] = sessions.map(
              (session) => {
                if (
                  session.practiceContractVersion !== 1 &&
                  session.practiceContractVersion !== 2
                ) {
                  throw new StudyDraftRepositoryIntegrityError(
                    'Resumable session has an unsupported contract version.'
                  )
                }
                if (session.practiceContractVersion === 2 && !session.draft) {
                  throw new StudyDraftRepositoryIntegrityError(
                    'Version 2 resumable session has no draft.'
                  )
                }
                return {
                  id: session.id,
                  level: session.level,
                  subject: session.subject,
                  mode: session.mode,
                  status: 'IN_PROGRESS',
                  actualCount: session.actualCount,
                  startedAt: session.startedAt.toISOString(),
                  expiresAt: session.expiresAt.toISOString(),
                  practiceContractVersion: session.practiceContractVersion,
                  draftRevision: session.draft?.revision ?? null,
                  draftSavedAt: session.draft?.savedAt?.toISOString() ?? null,
                  currentOrdinal: session.draft?.currentOrdinal ?? null,
                  resumeAvailability:
                    session.practiceContractVersion === 1
                      ? 'LEGACY_LOCAL_ONLY'
                      : 'SERVER'
                }
              }
            )
            return {
              items,
              page: query.page,
              pageSize: query.pageSize,
              total
            }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
        )
      }),
    saveAtomic: (input) =>
      withRepositoryErrors(async () => {
        for (
          let attempt = 1;
          attempt <= MAX_TRANSACTION_ATTEMPTS;
          attempt += 1
        ) {
          try {
            const outcome = await client.$transaction(
              (transaction) => runSave(transaction, input, options),
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
            )
            if (outcome.kind === 'NOT_EDITABLE') {
              throw new StudyDraftNotEditableError()
            }
            if (outcome.kind === 'IDEMPOTENCY_KEY_REUSED') {
              throw new IdempotencyKeyReusedError()
            }
            if (outcome.kind === 'INTEGRITY_ERROR') {
              throw new StudyDraftRepositoryIntegrityError(outcome.message)
            }
            return outcome.value
          } catch (error: unknown) {
            const retryable =
              error instanceof FreshDraftTransactionRetry ||
              isSerializableConflict(error)
            if (retryable && attempt < MAX_TRANSACTION_ATTEMPTS) {
              await retryDelay(
                attempt * RETRY_BASE_DELAY_MS + jitterMilliseconds()
              )
              continue
            }
            if (retryable) {
              throw new StudySubmissionRepositoryUnavailableError({
                cause: error
              })
            }
            throw error
          }
        }
        throw new StudyDraftRepositoryIntegrityError(
          'Draft Serializable retry budget was exhausted.'
        )
      }),
    cancelOwned: (sessionId, owner, observedAt) =>
      withRepositoryErrors(
        async () =>
          await client.$transaction(
            async (transaction) => {
              if (owner.kind === 'GUEST') {
                await assertGuestProof(transaction, owner, observedAt)
              }
              const session = await lockOwnedSession(
                transaction,
                sessionId,
                owner
              )
              if (!session) {
                return { kind: 'NOT_FOUND' } as const
              }
              await options.afterCancelSessionLocked?.()
              if (session.status === 'CANCELLED') {
                return { kind: 'CANCELLED' } as const
              }
              if (session.status !== 'IN_PROGRESS') {
                return { kind: 'NOT_EDITABLE' } as const
              }
              if (session.expiresAt <= observedAt) {
                await expireLockedSession(transaction, sessionId, observedAt)
                return { kind: 'NOT_EDITABLE' } as const
              }
              const cancelledAt = new Date(
                Math.max(observedAt.getTime(), session.startedAt.getTime())
              )
              await transaction.studySession.update({
                where: { id: sessionId },
                data: {
                  status: 'CANCELLED',
                  cancelledAt,
                  updatedAt: cancelledAt
                }
              })
              await transaction.studyDraft.deleteMany({
                where: { studySessionId: sessionId }
              })
              return { kind: 'CANCELLED' } as const
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
          )
      )
  }
}
