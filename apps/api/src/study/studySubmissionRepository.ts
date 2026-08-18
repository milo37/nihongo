import { randomInt, randomUUID } from 'node:crypto'
import { submitStudySessionResponseSchema } from '@nihongo/contracts/study/submit-study-session'
import type { StudyResult } from '@nihongo/contracts/study/study-result'
import {
  applyWrongNoteReview,
  type WrongNoteReviewState
} from '@nihongo/domain/review/apply-wrong-note-review'
import {
  canonicalizeStudySubmission,
  canonicalizeStudySubmissionV2,
  type OrderedSessionQuestionForSubmission
} from '@nihongo/domain/submission/canonicalize-study-submission'
import {
  gradePinnedStudySubmission,
  type PinnedStudyQuestionForGrading,
  type SubmittedStudyAnswer
} from '@nihongo/domain/grading/grade-study-submission'
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
  canonicalizeTolerantStudySubmission,
  canonicalizeTolerantStudySubmissionV2,
  hashStudySubmission
} from './studySubmissionCanonicalizer.js'
import {
  toStudyResult,
  type ReviewedQuestionRecord,
  type StudyResultRecord
} from './studySubmissionMapper.js'

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])
const MAX_TRANSACTION_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 5
const RETRY_JITTER_MAX_MS = 5
const GUEST_RENEWAL_MS = 7 * 24 * 60 * 60 * 1_000
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000

interface StudySubmissionRepositoryOptions {
  afterExistingMiss?: () => Promise<void>
  afterReservation?: () => Promise<void>
  beforeFinalize?: () => Promise<void>
  delay?: (milliseconds: number) => Promise<void>
  jitterMilliseconds?: () => number
}

export interface OwnedStudySubmissionPreload {
  readonly expiresAt: Date
  readonly orderedSessionQuestions: readonly {
    readonly ordinal: number
    readonly questionId: string
    readonly studySessionQuestionId: string
  }[]
  readonly sessionId: string
  readonly practiceContractVersion?: 1 | 2
  readonly status: StudySessionStatus
}

export interface SubmitStudySessionAtomicInput {
  readonly answers: readonly SubmittedStudyAnswer[]
  readonly durationSec: number
  readonly expectedDraftRevision?: number | null
  readonly idempotencyKey: string
  readonly observedAt: Date
  readonly owner: ExistingStudyOwner
  readonly practiceContractVersion?: 1 | 2
  readonly requestHash: string
  readonly sessionId: string
}

export interface SubmitStudySessionAtomicResult {
  readonly guestProofExpiresAt: Date | null
  readonly replayed: boolean
  readonly response: StudyResult
}

export type FindOwnedStudyResultOutcome =
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'NOT_READY' }
  | { readonly kind: 'READY'; readonly response: StudyResult }

export interface StudySubmissionRepository {
  findOwnedResult: (
    sessionId: string,
    owner: ExistingStudyOwner,
    observedAt: Date
  ) => Promise<FindOwnedStudyResultOutcome>
  preloadOwned: (
    sessionId: string,
    owner: ExistingStudyOwner,
    observedAt: Date
  ) => Promise<OwnedStudySubmissionPreload | null>
  submitAtomic: (
    input: SubmitStudySessionAtomicInput
  ) => Promise<SubmitStudySessionAtomicResult>
}

export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super('Idempotency key was already used for another request.')
    this.name = 'IdempotencyKeyReusedError'
  }
}

export class StudySessionAlreadySubmittedError extends Error {
  constructor() {
    super('Study session was already submitted.')
    this.name = 'StudySessionAlreadySubmittedError'
  }
}

export class StudySessionNotEditableError extends Error {
  constructor() {
    super('Study session is not editable.')
    this.name = 'StudySessionNotEditableError'
  }
}

export class StudySubmissionContractVersionMismatchError extends Error {
  constructor() {
    super('Submission contract version does not match the StudySession.')
    this.name = 'StudySubmissionContractVersionMismatchError'
  }
}

export class DraftSubmissionVersionConflictError extends Error {
  constructor() {
    super('Submission expectedDraftRevision is stale.')
    this.name = 'DraftSubmissionVersionConflictError'
  }
}

export class DraftSubmitMismatchError extends Error {
  constructor() {
    super('Submission answers do not match the authoritative draft.')
    this.name = 'DraftSubmitMismatchError'
  }
}

export class OwnedStudySessionNotFoundError extends Error {
  constructor() {
    super('Owned StudySession no longer exists.')
    this.name = 'OwnedStudySessionNotFoundError'
  }
}

export class StudySubmissionRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Study submission repository is unavailable.', options)
    this.name = 'StudySubmissionRepositoryUnavailableError'
  }
}

export class StudySubmissionRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StudySubmissionRepositoryIntegrityError'
  }
}

export class FreshTransactionRetry extends Error {
  constructor() {
    super('A fresh Serializable snapshot is required.')
    this.name = 'FreshTransactionRetry'
  }
}

interface GuestProofRow {
  expiresAt: Date
  id: string
  lastSeenAt: Date
}

interface LockedSessionRow {
  expiresAt: Date
  guestPrincipalId: string | null
  id: string
  practiceContractVersion: number
  status: StudySessionStatus
  userId: string | null
}

interface ReservationRow {
  id: string
}

interface LockedWrongNoteRow {
  correctStreak: number
  id: string
  lastReviewedAt: Date | null
  lastWrongAt: Date
  lastWrongQuestionVersionId: string
  questionId: string
  status: 'NEW' | 'REVIEWING' | 'AGAIN' | 'SOLVED'
  updatedAt: Date
  wrongCount: number
}

interface AtomicQuestion {
  readonly correctOptionId: string
  readonly ordinal: number
  readonly optionIds: readonly string[]
  readonly questionId: string
  readonly questionVersionId: string
  readonly studySessionQuestionId: string
}

interface AtomicSession {
  readonly draft: {
    readonly answers: readonly {
      readonly elapsedSec: number
      readonly selectedOptionId: string | null
      readonly studySessionQuestionId: string
    }[]
    readonly revision: number
  } | null
  readonly expiresAt: Date
  readonly mode:
    | 'RANDOM'
    | 'WRONG_NOTE'
    | 'WEAKNESS'
    | 'BOOKMARK'
    | 'DAILY_REVIEW'
  readonly questions: readonly AtomicQuestion[]
  readonly practiceContractVersion: number
  readonly startedAt: Date
  readonly status: StudySessionStatus
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

const isFreshWrongNoteConflict = (error: unknown): boolean => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002' ||
    error.meta?.modelName !== 'WrongNote'
  ) {
    return false
  }

  const target = error.meta.target
  return (
    target === 'WrongNote_userId_questionId_key' ||
    (Array.isArray(target) &&
      target.length === 2 &&
      target.includes('userId') &&
      target.includes('questionId'))
  )
}

const isOwner = (
  row: { userId: string | null; guestPrincipalId: string | null },
  owner: ExistingStudyOwner
): boolean =>
  owner.kind === 'USER'
    ? row.userId === owner.userId && row.guestPrincipalId === null
    : row.guestPrincipalId === owner.guestPrincipalId && row.userId === null

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

const parseStoredStudyResult = (
  value: unknown,
  message: string
): StudyResult => {
  try {
    return submitStudySessionResponseSchema.parse(value)
  } catch (error: unknown) {
    throw new StudySubmissionRepositoryIntegrityError(message, {
      cause: error
    })
  }
}

const lockGuestProof = async (
  transaction: Prisma.TransactionClient,
  owner: Extract<ExistingStudyOwner, { kind: 'GUEST' }>,
  observedAt: Date
): Promise<GuestProofRow> => {
  const rows = await transaction.$queryRaw<GuestProofRow[]>(Prisma.sql`
    SELECT
      guest."id",
      guest."lastSeenAt",
      guest."expiresAt"
    FROM "GuestPrincipal" AS guest
    WHERE guest."id" = ${owner.guestPrincipalId}::uuid
      AND guest."tokenDigest" = ${owner.tokenDigest}
    FOR NO KEY UPDATE OF guest
  `)
  const guest = rows[0]
  if (!guest || guest.expiresAt <= observedAt) {
    throw new GuestCredentialExpiredError()
  }
  return guest
}

const assertGuestProof = async (
  client: PrismaClient,
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

const loadAtomicSession = async (
  transaction: Prisma.TransactionClient,
  sessionId: string,
  owner: ExistingStudyOwner
): Promise<AtomicSession | null> => {
  const session = await transaction.studySession.findFirst({
    where: { id: sessionId, ...ownerWhere(owner) },
    select: {
      status: true,
      expiresAt: true,
      startedAt: true,
      mode: true,
      practiceContractVersion: true,
      draft: {
        select: {
          revision: true,
          answers: {
            select: {
              studySessionQuestionId: true,
              selectedOptionId: true,
              elapsedSec: true
            }
          }
        }
      },
      questions: {
        orderBy: { ordinal: 'asc' },
        select: {
          id: true,
          ordinal: true,
          questionId: true,
          questionVersionId: true,
          questionVersion: {
            select: {
              correctOptionId: true,
              options: {
                orderBy: { ordinal: 'asc' },
                select: { id: true }
              }
            }
          }
        }
      }
    }
  })
  if (!session) {
    return null
  }

  return {
    status: session.status,
    expiresAt: session.expiresAt,
    startedAt: session.startedAt,
    mode: session.mode,
    practiceContractVersion: session.practiceContractVersion,
    draft: session.draft,
    questions: session.questions.map((question) => {
      if (!question.questionVersion.correctOptionId) {
        throw new StudySubmissionRepositoryIntegrityError(
          'Pinned QuestionVersion has no correct option.'
        )
      }
      return {
        studySessionQuestionId: question.id,
        questionId: question.questionId,
        questionVersionId: question.questionVersionId,
        ordinal: question.ordinal,
        correctOptionId: question.questionVersion.correctOptionId,
        optionIds: question.questionVersion.options.map(({ id }) => id)
      }
    })
  }
}

const lockSession = async (
  transaction: Prisma.TransactionClient,
  sessionId: string
): Promise<LockedSessionRow | null> => {
  const rows = await transaction.$queryRaw<LockedSessionRow[]>(Prisma.sql`
    SELECT
      session."id",
      session."userId",
      session."guestPrincipalId",
      session."status",
      session."expiresAt",
      session."practiceContractVersion"
    FROM "StudySession" AS session
    WHERE session."id" = ${sessionId}::uuid
    FOR UPDATE OF session
  `)
  return rows[0] ?? null
}

const reserveIdempotency = async (
  transaction: Prisma.TransactionClient,
  input: SubmitStudySessionAtomicInput
): Promise<boolean> => {
  const id = randomUUID()
  const rows =
    input.owner.kind === 'USER'
      ? await transaction.$queryRaw<ReservationRow[]>(Prisma.sql`
          INSERT INTO "IdempotencyRecord" (
            "id", "principalType", "userId", "guestPrincipalId",
            "operation", "idempotencyKey", "studySessionId", "requestHash",
            "contractVersion", "state", "createdAt"
          )
          VALUES (
            ${id}::uuid, 'USER'::"IdempotencyPrincipalType",
            ${input.owner.userId}::uuid, NULL,
            'STUDY_SUBMIT'::"IdempotencyOperation",
            ${input.idempotencyKey}::uuid, ${input.sessionId}::uuid,
            ${input.requestHash}, ${input.practiceContractVersion ?? 1},
            'PROCESSING'::"IdempotencyState",
            ${input.observedAt}
          )
          ON CONFLICT DO NOTHING
          RETURNING "id"
        `)
      : await transaction.$queryRaw<ReservationRow[]>(Prisma.sql`
          INSERT INTO "IdempotencyRecord" (
            "id", "principalType", "userId", "guestPrincipalId",
            "operation", "idempotencyKey", "studySessionId", "requestHash",
            "contractVersion", "state", "createdAt"
          )
          VALUES (
            ${id}::uuid, 'GUEST'::"IdempotencyPrincipalType", NULL,
            ${input.owner.guestPrincipalId}::uuid,
            'STUDY_SUBMIT'::"IdempotencyOperation",
            ${input.idempotencyKey}::uuid, ${input.sessionId}::uuid,
            ${input.requestHash}, ${input.practiceContractVersion ?? 1},
            'PROCESSING'::"IdempotencyState",
            ${input.observedAt}
          )
          ON CONFLICT DO NOTHING
          RETURNING "id"
        `)

  return rows.length === 1
}

const lockWrongNotes = async (
  transaction: Prisma.TransactionClient,
  userId: string,
  questionIds: readonly string[]
): Promise<readonly LockedWrongNoteRow[]> => {
  for (const questionId of questionIds) {
    await transaction.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
      SELECT 1 AS "locked"
      FROM (
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${userId}:${questionId}`}, 0)
        )
      ) AS acquired
    `)
  }

  if (questionIds.length === 0) {
    return []
  }

  return await transaction.$queryRaw<LockedWrongNoteRow[]>(Prisma.sql`
    SELECT
      note."id",
      note."questionId",
      note."lastWrongQuestionVersionId",
      note."wrongCount",
      note."correctStreak",
      note."status",
      note."lastWrongAt",
      note."lastReviewedAt",
      note."updatedAt"
    FROM "WrongNote" AS note
    WHERE note."userId" = ${userId}::uuid
      AND note."questionId" IN (${Prisma.join(questionIds)})
    ORDER BY note."questionId" ASC
    FOR UPDATE OF note
  `)
}

const toWrongNoteState = (row: LockedWrongNoteRow): WrongNoteReviewState => ({
  wrongCount: row.wrongCount,
  correctStreak: row.correctStreak,
  status: row.status,
  lastWrongAt: row.lastWrongAt,
  lastReviewedAt: row.lastReviewedAt
})

const loadStudyResultRecord = async (
  client: Prisma.TransactionClient | PrismaClient,
  sessionId: string,
  owner: ExistingStudyOwner
): Promise<StudyResultRecord | null> => {
  const session = await client.studySession.findFirst({
    where: { id: sessionId, ...ownerWhere(owner) },
    select: {
      id: true,
      level: true,
      subject: true,
      mode: true,
      submittedAt: true,
      result: {
        select: {
          totalCount: true,
          correctCount: true,
          incorrectCount: true,
          correctRateBasisPoints: true,
          durationSec: true
        }
      },
      questions: {
        orderBy: { ordinal: 'asc' },
        select: {
          id: true,
          ordinal: true,
          questionId: true,
          questionVersion: {
            select: {
              id: true,
              level: true,
              subject: true,
              questionType: true,
              passage: true,
              questionText: true,
              difficulty: true,
              correctOptionId: true,
              explanationKo: true,
              explanationJa: true,
              options: {
                orderBy: { ordinal: 'asc' },
                select: { id: true, label: true, text: true }
              },
              tags: {
                orderBy: [{ labelSnapshot: 'asc' }, { tagId: 'asc' }],
                select: { tagId: true, labelSnapshot: true }
              }
            }
          },
          answer: {
            select: {
              selectedOptionId: true,
              isCorrect: true,
              reviewEvent: { select: { nextStatus: true } }
            }
          }
        }
      }
    }
  })

  if (!session) {
    return null
  }
  if (!session.result || !session.submittedAt) {
    return null
  }

  const questions = session.questions.map((item) => {
    const { answer, questionVersion } = item
    if (!answer || !questionVersion.correctOptionId) {
      throw new StudySubmissionRepositoryIntegrityError(
        'Submitted StudySession has an incomplete result projection.'
      )
    }
    const question: ReviewedQuestionRecord = {
      id: item.questionId,
      questionVersionId: questionVersion.id,
      level: questionVersion.level,
      subject: questionVersion.subject,
      questionType: questionVersion.questionType,
      passage: questionVersion.passage,
      questionText: questionVersion.questionText,
      difficulty: questionVersion.difficulty,
      options: questionVersion.options,
      tags: questionVersion.tags.map(({ labelSnapshot, tagId }) => ({
        id: tagId,
        label: labelSnapshot
      })),
      correctOptionId: questionVersion.correctOptionId,
      explanationKo: questionVersion.explanationKo,
      explanationJa: questionVersion.explanationJa
    }

    return {
      sessionQuestionId: item.id,
      ordinal: item.ordinal,
      question,
      answer: {
        selectedOptionId: answer.selectedOptionId,
        isCorrect: answer.isCorrect,
        reviewEvent: answer.reviewEvent
      }
    }
  })

  return {
    id: session.id,
    level: session.level,
    subject: session.subject,
    mode: session.mode,
    submittedAt: session.submittedAt,
    ...session.result,
    questions
  }
}

const createReviewFacts = async (
  transaction: Prisma.TransactionClient,
  input: {
    readonly answerIdBySessionQuestionId: ReadonlyMap<string, string>
    readonly effectiveSubmittedAt: Date
    readonly gradedAnswers: ReturnType<
      typeof gradePinnedStudySubmission
    >['answers']
    readonly mode: AtomicSession['mode']
    readonly questions: readonly AtomicQuestion[]
    readonly sessionId: string
    readonly userId: string
    readonly wrongNotes: readonly LockedWrongNoteRow[]
  }
): Promise<void> => {
  const questionBySessionQuestionId = new Map(
    input.questions.map((question) => [
      question.studySessionQuestionId,
      question
    ])
  )
  const wrongNoteByQuestionId = new Map(
    input.wrongNotes.map((wrongNote) => [wrongNote.questionId, wrongNote])
  )
  const answers = input.gradedAnswers
    .map((answer) => {
      const question = questionBySessionQuestionId.get(
        answer.studySessionQuestionId
      )
      if (!question) {
        throw new StudySubmissionRepositoryIntegrityError(
          'Graded answer no longer matches a pinned question.'
        )
      }
      return { answer, question }
    })
    .toSorted((left, right) =>
      left.question.questionId.localeCompare(right.question.questionId)
    )

  for (const { answer, question } of answers) {
    const previousRow = wrongNoteByQuestionId.get(question.questionId) ?? null
    const decision = applyWrongNoteReview({
      previous: previousRow ? toWrongNoteState(previousRow) : null,
      isCorrect: answer.isCorrect,
      occurredAt: input.effectiveSubmittedAt
    })
    if (!decision) {
      continue
    }

    const wrongNoteId = previousRow?.id ?? randomUUID()
    if (previousRow) {
      await transaction.wrongNote.update({
        where: { id: wrongNoteId },
        data: {
          lastWrongQuestionVersionId: answer.isCorrect
            ? previousRow.lastWrongQuestionVersionId
            : answer.questionVersionId,
          currentReviewQuestionVersionId: null,
          wrongCount: decision.wrongNote.wrongCount,
          correctStreak: decision.wrongNote.correctStreak,
          status: decision.wrongNote.status,
          lastWrongAt: decision.wrongNote.lastWrongAt,
          lastReviewedAt: decision.wrongNote.lastReviewedAt,
          updatedAt: input.effectiveSubmittedAt,
          schedule: {
            update: {
              nextReviewAt: decision.schedule.nextReviewAt,
              intervalDays: decision.schedule.intervalDays,
              algorithmVersion: decision.schedule.algorithmVersion,
              updatedAt: input.effectiveSubmittedAt
            }
          }
        }
      })
    } else {
      await transaction.wrongNote.create({
        data: {
          id: wrongNoteId,
          userId: input.userId,
          questionId: question.questionId,
          lastWrongQuestionVersionId: answer.questionVersionId,
          currentReviewQuestionVersionId: null,
          wrongCount: decision.wrongNote.wrongCount,
          correctStreak: decision.wrongNote.correctStreak,
          status: decision.wrongNote.status,
          lastWrongAt: decision.wrongNote.lastWrongAt,
          lastReviewedAt: decision.wrongNote.lastReviewedAt,
          createdAt: input.effectiveSubmittedAt,
          updatedAt: input.effectiveSubmittedAt,
          schedule: {
            create: {
              id: randomUUID(),
              nextReviewAt: decision.schedule.nextReviewAt,
              intervalDays: decision.schedule.intervalDays,
              algorithmVersion: decision.schedule.algorithmVersion,
              updatedAt: input.effectiveSubmittedAt
            }
          }
        }
      })
    }

    const studyAnswerId = input.answerIdBySessionQuestionId.get(
      answer.studySessionQuestionId
    )
    if (!studyAnswerId) {
      throw new StudySubmissionRepositoryIntegrityError(
        'ReviewEvent evidence StudyAnswer is missing.'
      )
    }
    await transaction.reviewEvent.create({
      data: {
        id: randomUUID(),
        wrongNoteId,
        userId: input.userId,
        questionId: question.questionId,
        questionVersionId: answer.questionVersionId,
        source: 'STUDY_SUBMIT',
        studySessionId: input.sessionId,
        studyAnswerId,
        selectedOptionId: answer.selectedOptionId,
        isCorrect: answer.isCorrect,
        previousStatus: decision.event.previousStatus,
        nextStatus: decision.event.nextStatus,
        previousCorrectStreak: decision.event.previousCorrectStreak,
        nextCorrectStreak: decision.event.nextCorrectStreak,
        previousWrongCount: decision.event.previousWrongCount,
        wrongCountAfter: decision.event.wrongCountAfter,
        algorithmVersion: decision.event.algorithmVersion,
        occurredAt: decision.event.occurredAt
      }
    })
  }
}

const assertEditable = (
  status: StudySessionStatus,
  expiresAt: Date,
  observedAt: Date
): void => {
  if (status === 'SUBMITTED') {
    throw new StudySessionAlreadySubmittedError()
  }
  if (status !== 'IN_PROGRESS' || expiresAt <= observedAt) {
    throw new StudySessionNotEditableError()
  }
}

const expireLockedSubmissionSession = async (
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

type RunAtomicSubmissionOutcome =
  | { readonly kind: 'NOT_EDITABLE' }
  | {
      readonly kind: 'SUBMITTED'
      readonly value: SubmitStudySessionAtomicResult
    }

const runAtomicSubmission = async (
  transaction: Prisma.TransactionClient,
  input: SubmitStudySessionAtomicInput,
  options: StudySubmissionRepositoryOptions
): Promise<RunAtomicSubmissionOutcome> => {
  const practiceContractVersion = input.practiceContractVersion ?? 1
  const expectedDraftRevision = input.expectedDraftRevision ?? null
  const guestProof =
    input.owner.kind === 'GUEST'
      ? await lockGuestProof(transaction, input.owner, input.observedAt)
      : null

  const prelockedSession = await loadAtomicSession(
    transaction,
    input.sessionId,
    input.owner
  )
  if (!prelockedSession) {
    throw new OwnedStudySessionNotFoundError()
  }

  let existing = await transaction.idempotencyRecord.findFirst({
    where: {
      ...idempotencyOwnerWhere(input.owner),
      operation: 'STUDY_SUBMIT',
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
      existing.requestHash !== input.requestHash ||
      existing.contractVersion !== practiceContractVersion
    ) {
      throw new IdempotencyKeyReusedError()
    }
    if (
      existing.state !== 'SUCCEEDED' ||
      existing.responseStatus !== 201 ||
      existing.responseBody === null
    ) {
      throw new StudySubmissionRepositoryIntegrityError(
        'Committed IdempotencyRecord is not replayable.'
      )
    }
    return {
      kind: 'SUBMITTED',
      value: {
        response: parseStoredStudyResult(
          existing.responseBody,
          'Stored idempotency response does not satisfy the submit contract.'
        ),
        replayed: true,
        guestProofExpiresAt: guestProof?.expiresAt ?? null
      }
    }
  }
  await options.afterExistingMiss?.()
  if (
    prelockedSession.practiceContractVersion !== practiceContractVersion ||
    (practiceContractVersion === 1 && expectedDraftRevision !== null) ||
    (practiceContractVersion === 2 && expectedDraftRevision === null)
  ) {
    throw new StudySubmissionContractVersionMismatchError()
  }
  if (prelockedSession.mode !== 'RANDOM') {
    throw new StudySessionNotEditableError()
  }

  if (prelockedSession.status === 'SUBMITTED') {
    throw new StudySessionAlreadySubmittedError()
  }
  if (prelockedSession.status !== 'IN_PROGRESS') {
    throw new StudySessionNotEditableError()
  }
  if (prelockedSession.expiresAt <= input.observedAt) {
    const expiredSession = await lockSession(transaction, input.sessionId)
    if (!expiredSession || !isOwner(expiredSession, input.owner)) {
      throw new OwnedStudySessionNotFoundError()
    }
    if (
      expiredSession.status === 'IN_PROGRESS' &&
      expiredSession.expiresAt <= input.observedAt
    ) {
      await expireLockedSubmissionSession(
        transaction,
        input.sessionId,
        input.observedAt
      )
      return { kind: 'NOT_EDITABLE' }
    }
    assertEditable(
      expiredSession.status,
      expiredSession.expiresAt,
      input.observedAt
    )
  }
  if (!(await reserveIdempotency(transaction, input))) {
    throw new FreshTransactionRetry()
  }
  await options.afterReservation?.()

  const lockedSession = await lockSession(transaction, input.sessionId)
  if (!lockedSession || !isOwner(lockedSession, input.owner)) {
    throw new OwnedStudySessionNotFoundError()
  }
  assertEditable(
    lockedSession.status,
    lockedSession.expiresAt,
    input.observedAt
  )

  const session = await loadAtomicSession(
    transaction,
    input.sessionId,
    input.owner
  )
  if (!session) {
    throw new OwnedStudySessionNotFoundError()
  }
  if (session.mode !== 'RANDOM') {
    throw new StudySessionNotEditableError()
  }
  if (session.practiceContractVersion !== practiceContractVersion) {
    throw new StudySubmissionContractVersionMismatchError()
  }

  if (practiceContractVersion === 2) {
    if (!session.draft || expectedDraftRevision === null) {
      throw new StudySubmissionContractVersionMismatchError()
    }
    if (session.draft.revision !== expectedDraftRevision) {
      throw new DraftSubmissionVersionConflictError()
    }
    const submittedByQuestionId = new Map(
      input.answers.map((answer) => [answer.studySessionQuestionId, answer])
    )
    const draftMatches =
      session.draft.answers.length === session.questions.length &&
      session.questions.every((question) => {
        const submitted = submittedByQuestionId.get(
          question.studySessionQuestionId
        )
        const draftAnswer = session.draft?.answers.find(
          (answer) =>
            answer.studySessionQuestionId === question.studySessionQuestionId
        )
        return (
          submitted !== undefined &&
          draftAnswer !== undefined &&
          submitted.selectedOptionId === draftAnswer.selectedOptionId &&
          submitted.elapsedSec === draftAnswer.elapsedSec
        )
      })
    if (!draftMatches) {
      throw new DraftSubmitMismatchError()
    }
  }

  const orderedSessionQuestions: OrderedSessionQuestionForSubmission[] =
    session.questions.map(({ ordinal, studySessionQuestionId }) => ({
      ordinal,
      studySessionQuestionId
    }))
  const exactCanonical =
    practiceContractVersion === 2 && expectedDraftRevision !== null
      ? canonicalizeStudySubmissionV2({
          sessionId: input.sessionId,
          orderedSessionQuestions,
          answers: input.answers,
          durationSec: input.durationSec,
          expectedDraftRevision
        })
      : canonicalizeStudySubmission({
          sessionId: input.sessionId,
          orderedSessionQuestions,
          answers: input.answers,
          durationSec: input.durationSec
        })
  if (hashStudySubmission(exactCanonical) !== input.requestHash) {
    throw new StudySubmissionRepositoryIntegrityError(
      'Submission canonical hash changed after the idempotency reservation.'
    )
  }

  const gradingQuestions: PinnedStudyQuestionForGrading[] =
    session.questions.map((question) => ({
      studySessionQuestionId: question.studySessionQuestionId,
      questionVersionId: question.questionVersionId,
      correctOptionId: question.correctOptionId,
      optionIds: question.optionIds
    }))
  const grade = gradePinnedStudySubmission(gradingQuestions, input.answers)

  const sortedQuestionIds = session.questions
    .map(({ questionId }) => questionId)
    .toSorted()
  const wrongNotes =
    input.owner.kind === 'USER'
      ? await lockWrongNotes(transaction, input.owner.userId, sortedQuestionIds)
      : []
  const latestWrongNoteTime = wrongNotes.reduce(
    (latest, note) => Math.max(latest, note.updatedAt.getTime() + 1),
    Number.NEGATIVE_INFINITY
  )
  const effectiveSubmittedAt = new Date(
    Math.max(
      input.observedAt.getTime(),
      session.startedAt.getTime(),
      guestProof?.lastSeenAt.getTime() ?? Number.NEGATIVE_INFINITY,
      latestWrongNoteTime
    )
  )

  const answerRows = grade.answers.map((answer) => ({
    id: randomUUID(),
    studySessionQuestionId: answer.studySessionQuestionId,
    questionVersionId: answer.questionVersionId,
    selectedOptionId: answer.selectedOptionId,
    isCorrect: answer.isCorrect,
    elapsedSec: answer.elapsedSec,
    gradingVersion: answer.gradingVersion,
    answeredAt: effectiveSubmittedAt,
    gradedAt: effectiveSubmittedAt
  }))
  await transaction.studyAnswer.createMany({ data: answerRows })
  await transaction.studyResult.create({
    data: {
      id: randomUUID(),
      studySessionId: input.sessionId,
      totalCount: grade.totalCount,
      correctCount: grade.correctCount,
      incorrectCount: grade.incorrectCount,
      correctRateBasisPoints: grade.correctRateBasisPoints,
      durationSec: input.durationSec,
      gradingVersion: grade.gradingVersion,
      createdAt: effectiveSubmittedAt
    }
  })

  if (input.owner.kind === 'USER') {
    await createReviewFacts(transaction, {
      answerIdBySessionQuestionId: new Map(
        answerRows.map(({ id, studySessionQuestionId }) => [
          studySessionQuestionId,
          id
        ])
      ),
      effectiveSubmittedAt,
      gradedAnswers: grade.answers,
      mode: session.mode,
      questions: session.questions,
      sessionId: input.sessionId,
      userId: input.owner.userId,
      wrongNotes
    })
  } else {
    await transaction.guestPrincipal.update({
      where: { id: input.owner.guestPrincipalId },
      data: {
        lastSeenAt: effectiveSubmittedAt,
        expiresAt: new Date(effectiveSubmittedAt.getTime() + GUEST_RENEWAL_MS)
      }
    })
  }

  await transaction.studySession.update({
    where: { id: input.sessionId },
    data: {
      status: 'SUBMITTED',
      submittedAt: effectiveSubmittedAt,
      durationSec: input.durationSec,
      submissionHash: input.requestHash
    }
  })
  if (practiceContractVersion === 2) {
    await transaction.studyDraft.delete({
      where: { studySessionId: input.sessionId }
    })
  }

  const resultRecord = await loadStudyResultRecord(
    transaction,
    input.sessionId,
    input.owner
  )
  if (!resultRecord) {
    throw new StudySubmissionRepositoryIntegrityError(
      'Committed study facts could not be projected before finalize.'
    )
  }
  const response = parseStoredStudyResult(
    toStudyResult(resultRecord),
    'Projected submit response does not satisfy the submit contract.'
  )
  await options.beforeFinalize?.()
  const finalized = await transaction.idempotencyRecord.updateMany({
    where: {
      ...idempotencyOwnerWhere(input.owner),
      operation: 'STUDY_SUBMIT',
      idempotencyKey: input.idempotencyKey,
      state: 'PROCESSING'
    },
    data: {
      state: 'SUCCEEDED',
      responseStatus: 201,
      responseBody: response as unknown as Prisma.InputJsonValue,
      completedAt: effectiveSubmittedAt,
      expiresAt: new Date(
        effectiveSubmittedAt.getTime() + IDEMPOTENCY_RETENTION_MS
      )
    }
  })
  if (finalized.count !== 1) {
    throw new StudySubmissionRepositoryIntegrityError(
      'IdempotencyRecord finalize did not update exactly one reservation.'
    )
  }

  return {
    kind: 'SUBMITTED',
    value: {
      response,
      replayed: false,
      guestProofExpiresAt:
        input.owner.kind === 'GUEST'
          ? new Date(effectiveSubmittedAt.getTime() + GUEST_RENEWAL_MS)
          : null
    }
  }
}

export const createPrismaStudySubmissionRepository = (
  client: PrismaClient,
  options: StudySubmissionRepositoryOptions = {}
): StudySubmissionRepository => {
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
    preloadOwned: (sessionId, owner, observedAt) =>
      withRepositoryErrors(async () => {
        if (owner.kind === 'GUEST') {
          await assertGuestProof(client, owner, observedAt)
        }
        const session = await client.studySession.findFirst({
          where: { id: sessionId, ...ownerWhere(owner) },
          select: {
            id: true,
            status: true,
            expiresAt: true,
            practiceContractVersion: true,
            questions: {
              orderBy: { ordinal: 'asc' },
              select: { id: true, questionId: true, ordinal: true }
            }
          }
        })
        if (!session) {
          return null
        }
        if (
          session.practiceContractVersion !== 1 &&
          session.practiceContractVersion !== 2
        ) {
          throw new StudySubmissionRepositoryIntegrityError(
            'StudySession has an unsupported practice contract version.'
          )
        }
        return {
          sessionId: session.id,
          status: session.status,
          expiresAt: session.expiresAt,
          practiceContractVersion: session.practiceContractVersion,
          orderedSessionQuestions: session.questions.map((question) => ({
            studySessionQuestionId: question.id,
            questionId: question.questionId,
            ordinal: question.ordinal
          }))
        }
      }),
    submitAtomic: (input) =>
      withRepositoryErrors(async () => {
        for (
          let attempt = 1;
          attempt <= MAX_TRANSACTION_ATTEMPTS;
          attempt += 1
        ) {
          try {
            const outcome = await client.$transaction(
              (transaction) => runAtomicSubmission(transaction, input, options),
              {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable
              }
            )
            if (outcome.kind === 'NOT_EDITABLE') {
              throw new StudySessionNotEditableError()
            }
            return outcome.value
          } catch (error: unknown) {
            if (
              (error instanceof FreshTransactionRetry ||
                isSerializableConflict(error) ||
                isFreshWrongNoteConflict(error)) &&
              attempt < MAX_TRANSACTION_ATTEMPTS
            ) {
              await retryDelay(
                attempt * RETRY_BASE_DELAY_MS + jitterMilliseconds()
              )
              continue
            }
            if (
              error instanceof FreshTransactionRetry ||
              isSerializableConflict(error) ||
              isFreshWrongNoteConflict(error)
            ) {
              throw new StudySubmissionRepositoryUnavailableError({
                cause: error
              })
            }
            throw error
          }
        }
        throw new StudySubmissionRepositoryIntegrityError(
          'Serializable transaction retry budget was exhausted.'
        )
      }),
    findOwnedResult: (sessionId, owner, observedAt) =>
      withRepositoryErrors(async () => {
        if (owner.kind === 'GUEST') {
          await assertGuestProof(client, owner, observedAt)
        }
        const session = await client.studySession.findFirst({
          where: { id: sessionId, ...ownerWhere(owner) },
          select: { status: true }
        })
        if (!session) {
          return { kind: 'NOT_FOUND' }
        }
        if (session.status !== 'SUBMITTED') {
          return { kind: 'NOT_READY' }
        }
        const record = await loadStudyResultRecord(client, sessionId, owner)
        if (!record) {
          const stillOwned = await client.studySession.findFirst({
            where: { id: sessionId, ...ownerWhere(owner) },
            select: { status: true }
          })
          if (!stillOwned) {
            return { kind: 'NOT_FOUND' }
          }
          if (stillOwned.status !== 'SUBMITTED') {
            return { kind: 'NOT_READY' }
          }
          throw new StudySubmissionRepositoryIntegrityError(
            'Submitted StudySession has no complete StudyResult.'
          )
        }
        return {
          kind: 'READY',
          response: toStudyResult(record)
        }
      })
  }
}

export const createTolerantSubmissionHash = (
  preload: OwnedStudySubmissionPreload,
  input: {
    readonly answers: readonly SubmittedStudyAnswer[]
    readonly durationSec: number
  }
): string =>
  hashStudySubmission(
    canonicalizeTolerantStudySubmission({
      sessionId: preload.sessionId,
      orderedSessionQuestions: preload.orderedSessionQuestions,
      answers: input.answers,
      durationSec: input.durationSec
    })
  )

export const createTolerantSubmissionV2Hash = (
  preload: OwnedStudySubmissionPreload,
  input: {
    readonly answers: readonly SubmittedStudyAnswer[]
    readonly durationSec: number
    readonly expectedDraftRevision: number
  }
): string =>
  hashStudySubmission(
    canonicalizeTolerantStudySubmissionV2({
      sessionId: preload.sessionId,
      orderedSessionQuestions: preload.orderedSessionQuestions,
      answers: input.answers,
      durationSec: input.durationSec,
      expectedDraftRevision: input.expectedDraftRevision
    })
  )
