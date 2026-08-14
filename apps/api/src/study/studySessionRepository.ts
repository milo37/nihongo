import { randomInt, randomUUID } from 'node:crypto'
import {
  Prisma,
  type PrismaClient,
  type StudySessionStatus
} from '../generated/prisma/client.js'
import type { PreparedGuestCredential } from '../auth/guestPrincipalService.js'
import type {
  PublishedQuestionDetailRecord,
  QuestionOptionRecord,
  QuestionTagRecord
} from '../question/questionRepository.js'

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])
const MAX_TRANSACTION_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 5
const RETRY_JITTER_MAX_MS = 5

interface StudySessionRepositoryOptions {
  afterSelectionLocked?: (
    selected: readonly {
      questionId: string
      questionVersionId: string
    }[]
  ) => Promise<void>
  delay?: (milliseconds: number) => Promise<void>
  jitterMilliseconds?: () => number
}

const delay = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds))

export type ExistingStudyOwner =
  | { kind: 'USER'; userId: string }
  | { kind: 'GUEST'; guestPrincipalId: string; tokenDigest: string }

export type CreateStudyOwner =
  | ExistingStudyOwner
  | { kind: 'NEW_GUEST'; credential: PreparedGuestCredential }
  | {
      kind: 'GUEST_OR_NEW'
      guestPrincipalId: string
      tokenDigest: string
      replacement: PreparedGuestCredential
    }

export interface CreateRandomStudySessionInput {
  expiresAt: Date
  level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  owner: CreateStudyOwner
  requestedCount: number
  startedAt: Date
  subject: 'VOCABULARY' | 'GRAMMAR' | 'READING'
}

export interface StudySessionQuestionRecord {
  ordinal: number
  question: PublishedQuestionDetailRecord
  sessionQuestionId: string
}

export interface StudySessionRecord {
  actualCount: number
  durationSec: number | null
  expiresAt: Date
  fallbackReason: 'INSUFFICIENT_MODE_CANDIDATES' | null
  guestPrincipalId: string | null
  id: string
  level: CreateRandomStudySessionInput['level']
  mode: 'RANDOM' | 'WRONG_NOTE' | 'WEAKNESS' | 'BOOKMARK' | 'DAILY_REVIEW'
  questions: readonly StudySessionQuestionRecord[]
  requestedCount: number
  startedAt: Date
  status: StudySessionStatus
  subject: CreateRandomStudySessionInput['subject']
  submittedAt: Date | null
  usedFallback: boolean
  userId: string | null
}

export interface StudySessionRepository {
  createRandom: (input: CreateRandomStudySessionInput) => Promise<{
    session: StudySessionRecord
    issuedGuestCredential: PreparedGuestCredential | null
  }>
  findOwnedById: (
    sessionId: string,
    owner: ExistingStudyOwner,
    now: Date
  ) => Promise<StudySessionRecord | null>
}

export class NoEligibleQuestionsError extends Error {
  constructor() {
    super('No eligible questions exist.')
    this.name = 'NoEligibleQuestionsError'
  }
}

export class GuestCredentialExpiredError extends Error {
  constructor() {
    super('Guest credential is invalid or expired.')
    this.name = 'GuestCredentialExpiredError'
  }
}

export class StudySessionRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Study session repository is unavailable.', options)
    this.name = 'StudySessionRepositoryUnavailableError'
  }
}

export class StudySessionRepositoryIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudySessionRepositoryIntegrityError'
  }
}

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

const isSerializableConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2034'

const executeRepositoryOperation = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (isDatabaseUnavailableError(error)) {
      throw new StudySessionRepositoryUnavailableError({ cause: error })
    }
    throw error
  }
}

const toTags = (
  tags: readonly { tagId: string; labelSnapshot: string }[]
): readonly QuestionTagRecord[] =>
  tags.map(({ labelSnapshot, tagId }) => ({ id: tagId, label: labelSnapshot }))

const toOptions = (
  options: readonly { id: string; label: string; text: string }[]
): readonly QuestionOptionRecord[] =>
  options.map(({ id, label, text }) => ({ id, label, text }))

const loadStudySession = async (
  client: Prisma.TransactionClient | PrismaClient,
  sessionId: string,
  owner?: ExistingStudyOwner
): Promise<StudySessionRecord | null> => {
  const session = await client.studySession.findFirst({
    where: {
      id: sessionId,
      ...(owner?.kind === 'USER'
        ? { userId: owner.userId }
        : owner?.kind === 'GUEST'
          ? { guestPrincipalId: owner.guestPrincipalId }
          : {})
    },
    select: {
      id: true,
      userId: true,
      guestPrincipalId: true,
      level: true,
      subject: true,
      mode: true,
      status: true,
      requestedCount: true,
      actualCount: true,
      usedFallback: true,
      fallbackReason: true,
      startedAt: true,
      expiresAt: true,
      submittedAt: true,
      durationSec: true,
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
              options: {
                orderBy: { ordinal: 'asc' },
                select: { id: true, label: true, text: true }
              },
              tags: {
                orderBy: { labelSnapshot: 'asc' },
                select: { tagId: true, labelSnapshot: true }
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
  const fallbackReason = session.fallbackReason
  if (
    fallbackReason !== null &&
    fallbackReason !== 'INSUFFICIENT_MODE_CANDIDATES'
  ) {
    throw new StudySessionRepositoryIntegrityError(
      'StudySession contains a retired fallback reason.'
    )
  }

  return {
    ...session,
    fallbackReason,
    questions: session.questions.map((item) => ({
      sessionQuestionId: item.id,
      ordinal: item.ordinal,
      question: {
        id: item.questionId,
        questionVersionId: item.questionVersion.id,
        level: item.questionVersion.level,
        subject: item.questionVersion.subject,
        questionType: item.questionVersion.questionType,
        passage: item.questionVersion.passage,
        questionText: item.questionVersion.questionText,
        difficulty: item.questionVersion.difficulty,
        options: toOptions(item.questionVersion.options),
        tags: toTags(item.questionVersion.tags)
      }
    }))
  }
}

type SelectedQuestion = {
  questionId: string
  questionVersionId: string
}

export const createPrismaStudySessionRepository = (
  client: PrismaClient,
  {
    afterSelectionLocked,
    delay: retryDelay = delay,
    jitterMilliseconds = () => randomInt(0, RETRY_JITTER_MAX_MS + 1)
  }: StudySessionRepositoryOptions = {}
): StudySessionRepository => ({
  createRandom: (input) =>
    executeRepositoryOperation(async () => {
      for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
          return await client.$transaction(
            async (transaction) => {
              const selected = await transaction.$queryRaw<
                SelectedQuestion[]
              >(Prisma.sql`
                SELECT
                  question."id" AS "questionId",
                  version."id" AS "questionVersionId"
                FROM "Question" AS question
                JOIN "QuestionVersion" AS version
                  ON version."questionId" = question."id"
                  AND version."id" = question."currentPublishedVersionId"
                WHERE question."lifecycleStatus" = 'ACTIVE'
                  AND version."status" = 'PUBLISHED'
                  AND version."level" = ${input.level}::"JlptLevel"
                  AND version."subject" = ${input.subject}::"QuestionSubject"
                ORDER BY random()
                LIMIT ${input.requestedCount}
                FOR SHARE OF question, version`)

              if (selected.length === 0) {
                throw new NoEligibleQuestionsError()
              }

              await afterSelectionLocked?.(
                selected.map(({ questionId, questionVersionId }) => ({
                  questionId,
                  questionVersionId
                }))
              )

              let userId: string | null = null
              let guestPrincipalId: string | null = null
              let expiresAt = input.expiresAt

              let issuedGuestCredential: PreparedGuestCredential | null = null

              if (input.owner.kind === 'USER') {
                userId = input.owner.userId
              } else if (
                input.owner.kind === 'GUEST' ||
                input.owner.kind === 'GUEST_OR_NEW'
              ) {
                const guest = await transaction.guestPrincipal.findFirst({
                  where: {
                    id: input.owner.guestPrincipalId,
                    tokenDigest: input.owner.tokenDigest,
                    expiresAt: { gt: input.startedAt }
                  },
                  select: { id: true, expiresAt: true }
                })
                if (!guest && input.owner.kind === 'GUEST') {
                  throw new GuestCredentialExpiredError()
                }
                if (guest) {
                  guestPrincipalId = guest.id
                  expiresAt =
                    guest.expiresAt < expiresAt ? guest.expiresAt : expiresAt
                  await transaction.guestPrincipal.update({
                    where: { id: guest.id },
                    data: { lastSeenAt: input.startedAt }
                  })
                } else if (input.owner.kind === 'GUEST_OR_NEW') {
                  const credential = input.owner.replacement
                  await transaction.guestPrincipal.create({
                    data: {
                      id: credential.id,
                      tokenDigest: credential.tokenDigest,
                      createdAt: credential.createdAt,
                      lastSeenAt: input.startedAt,
                      expiresAt: credential.expiresAt
                    }
                  })
                  guestPrincipalId = credential.id
                  expiresAt =
                    credential.expiresAt < expiresAt
                      ? credential.expiresAt
                      : expiresAt
                  issuedGuestCredential = credential
                }
              } else {
                const { credential } = input.owner
                await transaction.guestPrincipal.create({
                  data: {
                    id: credential.id,
                    tokenDigest: credential.tokenDigest,
                    createdAt: credential.createdAt,
                    lastSeenAt: input.startedAt,
                    expiresAt: credential.expiresAt
                  }
                })
                guestPrincipalId = credential.id
                expiresAt =
                  credential.expiresAt < expiresAt
                    ? credential.expiresAt
                    : expiresAt
                issuedGuestCredential = credential
              }

              const session = await transaction.studySession.create({
                data: {
                  userId,
                  guestPrincipalId,
                  level: input.level,
                  subject: input.subject,
                  mode: 'RANDOM',
                  status: 'IN_PROGRESS',
                  requestedCount: input.requestedCount,
                  actualCount: selected.length,
                  usedFallback: false,
                  fallbackReason: null,
                  startedAt: input.startedAt,
                  expiresAt
                },
                select: { id: true }
              })
              await transaction.studySessionQuestion.createMany({
                data: selected.map((question, index) => ({
                  id: randomUUID(),
                  studySessionId: session.id,
                  questionId: question.questionId,
                  questionVersionId: question.questionVersionId,
                  ordinal: index + 1,
                  createdAt: input.startedAt
                }))
              })
              const created = await loadStudySession(transaction, session.id)
              if (!created) {
                throw new StudySessionRepositoryIntegrityError(
                  'Created StudySession could not be projected.'
                )
              }
              return { session: created, issuedGuestCredential }
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
          )
        } catch (error: unknown) {
          if (isSerializableConflict(error)) {
            if (attempt < MAX_TRANSACTION_ATTEMPTS) {
              await retryDelay(
                attempt * RETRY_BASE_DELAY_MS + jitterMilliseconds()
              )
              continue
            }
            throw new StudySessionRepositoryUnavailableError({ cause: error })
          }
          throw error
        }
      }
      throw new StudySessionRepositoryIntegrityError(
        'Serializable transaction retry budget was exhausted.'
      )
    }),
  findOwnedById: (sessionId, owner, now) =>
    executeRepositoryOperation(async () => {
      if (owner.kind === 'GUEST') {
        const credential = await client.guestPrincipal.findFirst({
          where: {
            id: owner.guestPrincipalId,
            tokenDigest: owner.tokenDigest,
            expiresAt: { gt: now }
          },
          select: { id: true }
        })
        if (!credential) {
          throw new GuestCredentialExpiredError()
        }
      }

      const session = await loadStudySession(client, sessionId, owner)
      return session?.status === 'IN_PROGRESS' && session.expiresAt <= now
        ? { ...session, status: 'EXPIRED' }
        : session
    })
})
