import { randomInt, randomUUID } from 'node:crypto'
import {
  selectBookmarkStudyCandidates,
  selectDailyReviewStudyCandidates,
  selectRandomStudyCandidates,
  selectWeaknessStudyCandidates,
  selectWrongNoteStudyCandidates
} from '@nihongo/domain/selection/select-study-candidates'
import {
  Prisma,
  type PrismaClient,
  type StudyMode,
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
  afterOwnedSessionLocked?: () => Promise<void>
  afterSelectionLocked?: (
    selected: readonly {
      questionId: string
      questionVersionId: string
    }[]
  ) => Promise<void>
  delay?: (milliseconds: number) => Promise<void>
  jitterMilliseconds?: () => number
  random?: () => number
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

export interface CreateStudySessionInput {
  expiresAt: Date
  level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  mode: StudyMode
  owner: CreateStudyOwner
  practiceContractVersion?: 1 | 2
  requestedCount: number
  startedAt: Date
  subject: 'VOCABULARY' | 'GRAMMAR' | 'READING'
}

export type CreateRandomStudySessionInput = Omit<
  CreateStudySessionInput,
  'mode'
>

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
  level: CreateStudySessionInput['level']
  mode: 'RANDOM' | 'WRONG_NOTE' | 'WEAKNESS' | 'BOOKMARK' | 'DAILY_REVIEW'
  practiceContractVersion?: 1 | 2
  questions: readonly StudySessionQuestionRecord[]
  requestedCount: number
  startedAt: Date
  status: StudySessionStatus
  subject: CreateStudySessionInput['subject']
  submittedAt: Date | null
  usedFallback: boolean
  userId: string | null
}

export interface StudySessionRepository {
  create: (input: CreateStudySessionInput) => Promise<{
    session: StudySessionRecord
    issuedGuestCredential: PreparedGuestCredential | null
  }>
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

class StudySelectionChangedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudySelectionChangedError'
  }
}

const isSerializableConflict = (error: unknown): boolean => {
  if (error instanceof StudySelectionChangedError) {
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

export const loadStudySessionRecord = async (
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
      practiceContractVersion: true,
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
    session.practiceContractVersion !== 1 &&
    session.practiceContractVersion !== 2
  ) {
    throw new StudySessionRepositoryIntegrityError(
      'StudySession contains an unsupported practice contract version.'
    )
  }
  const practiceContractVersion = session.practiceContractVersion as 1 | 2
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
    practiceContractVersion,
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

type ExistingSelectionOwner =
  | { kind: 'USER'; id: string }
  | { kind: 'GUEST'; id: string }
  | null

type ExistingGuestRecord = {
  expiresAt: Date
  id: string
}

type RandomCandidateRow = SelectedQuestion

type BookmarkCandidateRow = SelectedQuestion & {
  createdAt: Date
}

type WrongNoteCandidateRow = SelectedQuestion & {
  lastWrongAt: Date
  wrongCount: number
  wrongNoteId: string
}

type DailyReviewCandidateRow = SelectedQuestion & {
  nextReviewAt: Date
  status: 'NEW' | 'REVIEWING' | 'AGAIN' | 'SOLVED'
  wrongNoteId: string
}

type WeaknessCandidateRow = SelectedQuestion & {
  answeredCount: number
  incorrectCount: number
  lastAnsweredAt: Date
}

const findExistingGuest = async (
  transaction: Prisma.TransactionClient,
  input: CreateStudySessionInput
): Promise<ExistingGuestRecord | null> => {
  if (input.owner.kind !== 'GUEST' && input.owner.kind !== 'GUEST_OR_NEW') {
    return null
  }

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
  return guest
}

const toSelectionOwner = (
  input: CreateStudySessionInput,
  existingGuest: ExistingGuestRecord | null
): ExistingSelectionOwner =>
  input.owner.kind === 'USER'
    ? { kind: 'USER', id: input.owner.userId }
    : existingGuest
      ? { kind: 'GUEST', id: existingGuest.id }
      : null

const loadEligibleCatalog = async (
  transaction: Prisma.TransactionClient,
  input: CreateStudySessionInput
): Promise<RandomCandidateRow[]> =>
  await transaction.$queryRaw<RandomCandidateRow[]>(Prisma.sql`
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
    ORDER BY question."id" ASC
  `)

const loadRecentQuestionIds = async (
  transaction: Prisma.TransactionClient,
  input: CreateStudySessionInput,
  owner: Exclude<ExistingSelectionOwner, null>
): Promise<Set<string>> => {
  const ownerPredicate =
    owner.kind === 'USER'
      ? Prisma.sql`session."userId" = ${owner.id}::uuid`
      : Prisma.sql`session."guestPrincipalId" = ${owner.id}::uuid`
  const recentSince = new Date(
    input.startedAt.getTime() - 7 * 24 * 60 * 60 * 1_000
  )
  const rows = await transaction.$queryRaw<Array<{ questionId: string }>>(
    Prisma.sql`
      WITH recent_sessions AS MATERIALIZED (
        SELECT session."id"
        FROM "StudySession" AS session
        WHERE ${ownerPredicate}
          AND session."status" = 'SUBMITTED'
          AND session."submittedAt" >= ${recentSince}
          AND session."submittedAt" <= ${input.startedAt}
        ORDER BY session."submittedAt" DESC, session."id" ASC
        LIMIT 3
      )
      SELECT DISTINCT item."questionId"
      FROM recent_sessions AS recent
      JOIN "StudySessionQuestion" AS item
        ON item."studySessionId" = recent."id"
      ORDER BY item."questionId" ASC
    `
  )
  return new Set(rows.map(({ questionId }) => questionId))
}

const loadBookmarkCandidates = async (
  transaction: Prisma.TransactionClient,
  input: CreateStudySessionInput,
  userId: string
): Promise<BookmarkCandidateRow[]> =>
  await transaction.$queryRaw<BookmarkCandidateRow[]>(Prisma.sql`
    SELECT
      bookmark."questionId",
      version."id" AS "questionVersionId",
      bookmark."createdAt"
    FROM "Bookmark" AS bookmark
    JOIN "Question" AS question
      ON question."id" = bookmark."questionId"
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
      AND version."id" = question."currentPublishedVersionId"
    WHERE bookmark."userId" = ${userId}::uuid
      AND question."lifecycleStatus" = 'ACTIVE'
      AND version."status" = 'PUBLISHED'
      AND version."level" = ${input.level}::"JlptLevel"
      AND version."subject" = ${input.subject}::"QuestionSubject"
    ORDER BY bookmark."createdAt" DESC, bookmark."questionId" ASC
    LIMIT ${input.requestedCount}
    FOR SHARE OF bookmark, question, version
  `)

const loadWrongNoteCandidates = async (
  transaction: Prisma.TransactionClient,
  input: CreateStudySessionInput,
  userId: string
): Promise<WrongNoteCandidateRow[]> =>
  await transaction.$queryRaw<WrongNoteCandidateRow[]>(Prisma.sql`
    SELECT
      note."id" AS "wrongNoteId",
      note."questionId",
      version."id" AS "questionVersionId",
      note."lastWrongAt",
      note."wrongCount"
    FROM "WrongNote" AS note
    JOIN "Question" AS question
      ON question."id" = note."questionId"
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
      AND version."id" = question."currentPublishedVersionId"
    WHERE note."userId" = ${userId}::uuid
      AND note."status" IN ('NEW', 'REVIEWING', 'AGAIN')
      AND question."lifecycleStatus" = 'ACTIVE'
      AND version."status" = 'PUBLISHED'
      AND version."level" = ${input.level}::"JlptLevel"
      AND version."subject" = ${input.subject}::"QuestionSubject"
    ORDER BY
      note."lastWrongAt" DESC,
      note."wrongCount" DESC,
      note."questionId" ASC
    LIMIT ${input.requestedCount}
  `)

const loadDailyReviewCandidates = async (
  transaction: Prisma.TransactionClient,
  input: CreateStudySessionInput,
  userId: string
): Promise<DailyReviewCandidateRow[]> =>
  await transaction.$queryRaw<DailyReviewCandidateRow[]>(Prisma.sql`
    SELECT
      note."id" AS "wrongNoteId",
      note."questionId",
      version."id" AS "questionVersionId",
      schedule."nextReviewAt",
      note."status"
    FROM "ReviewSchedule" AS schedule
    JOIN "WrongNote" AS note
      ON note."id" = schedule."wrongNoteId"
    JOIN "Question" AS question
      ON question."id" = note."questionId"
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
      AND version."id" = question."currentPublishedVersionId"
    WHERE note."userId" = ${userId}::uuid
      AND note."status" IN ('NEW', 'REVIEWING', 'AGAIN', 'SOLVED')
      AND schedule."nextReviewAt" <= ${input.startedAt}
      AND question."lifecycleStatus" = 'ACTIVE'
      AND version."status" = 'PUBLISHED'
      AND version."level" = ${input.level}::"JlptLevel"
      AND version."subject" = ${input.subject}::"QuestionSubject"
    ORDER BY
      schedule."nextReviewAt" ASC,
      CASE note."status"
        WHEN 'AGAIN'::"WrongNoteStatus" THEN 1
        WHEN 'NEW'::"WrongNoteStatus" THEN 2
        WHEN 'REVIEWING'::"WrongNoteStatus" THEN 3
        WHEN 'SOLVED'::"WrongNoteStatus" THEN 4
      END,
      note."questionId" ASC
    LIMIT ${input.requestedCount}
  `)

const loadWeaknessCandidates = async (
  transaction: Prisma.TransactionClient,
  input: CreateStudySessionInput,
  owner: Exclude<ExistingSelectionOwner, null>
): Promise<WeaknessCandidateRow[]> => {
  const ownerPredicate =
    owner.kind === 'USER'
      ? Prisma.sql`session."userId" = ${owner.id}::uuid`
      : Prisma.sql`session."guestPrincipalId" = ${owner.id}::uuid`

  return await transaction.$queryRaw<WeaknessCandidateRow[]>(Prisma.sql`
    WITH recent_sessions AS MATERIALIZED (
      SELECT session."id"
      FROM "StudySession" AS session
      WHERE ${ownerPredicate}
        AND session."level" = ${input.level}::"JlptLevel"
        AND session."subject" = ${input.subject}::"QuestionSubject"
        AND session."status" = 'SUBMITTED'
        AND session."submittedAt" IS NOT NULL
      ORDER BY session."submittedAt" DESC, session."id" ASC
      LIMIT 10
    )
    SELECT
      item."questionId",
      version."id" AS "questionVersionId",
      COUNT(*)::INTEGER AS "answeredCount",
      COUNT(*) FILTER (WHERE answer."isCorrect" = false)::INTEGER
        AS "incorrectCount",
      MAX(answer."answeredAt") AS "lastAnsweredAt"
    FROM recent_sessions AS recent
    JOIN "StudySessionQuestion" AS item
      ON item."studySessionId" = recent."id"
    JOIN "StudyAnswer" AS answer
      ON answer."studySessionQuestionId" = item."id"
      AND answer."questionVersionId" = item."questionVersionId"
    JOIN "Question" AS question
      ON question."id" = item."questionId"
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
      AND version."id" = question."currentPublishedVersionId"
    WHERE question."lifecycleStatus" = 'ACTIVE'
      AND version."status" = 'PUBLISHED'
      AND version."level" = ${input.level}::"JlptLevel"
      AND version."subject" = ${input.subject}::"QuestionSubject"
    GROUP BY item."questionId", version."id"
    HAVING COUNT(*) >= 3
      AND COUNT(*) FILTER (WHERE answer."isCorrect" = false) >= 1
    ORDER BY item."questionId" ASC
  `)
}

const selectStudyQuestions = async (
  transaction: Prisma.TransactionClient,
  input: CreateStudySessionInput,
  owner: ExistingSelectionOwner,
  random: () => number
): Promise<SelectedQuestion[]> => {
  if (input.mode === 'RANDOM') {
    const catalog = await loadEligibleCatalog(transaction, input)
    const recentQuestionIds = owner
      ? await loadRecentQuestionIds(transaction, input, owner)
      : new Set<string>()
    return selectRandomStudyCandidates(
      catalog.map((candidate) => ({
        ...candidate,
        isRecent: recentQuestionIds.has(candidate.questionId)
      })),
      input.requestedCount,
      random
    ).map(({ questionId, questionVersionId }) => ({
      questionId,
      questionVersionId
    }))
  }

  if (input.mode === 'WEAKNESS') {
    if (!owner) {
      return []
    }
    return selectWeaknessStudyCandidates(
      await loadWeaknessCandidates(transaction, input, owner),
      input.requestedCount
    ).map(({ questionId, questionVersionId }) => ({
      questionId,
      questionVersionId
    }))
  }

  if (input.mode === 'WRONG_NOTE') {
    if (owner?.kind !== 'USER') {
      return []
    }
    return selectWrongNoteStudyCandidates(
      await loadWrongNoteCandidates(transaction, input, owner.id),
      input.requestedCount
    ).map(({ questionId, questionVersionId }) => ({
      questionId,
      questionVersionId
    }))
  }

  if (input.mode === 'DAILY_REVIEW') {
    if (owner?.kind !== 'USER') {
      return []
    }
    return selectDailyReviewStudyCandidates(
      await loadDailyReviewCandidates(transaction, input, owner.id),
      input.requestedCount
    ).map(({ questionId, questionVersionId }) => ({
      questionId,
      questionVersionId
    }))
  }

  if (input.mode === 'BOOKMARK') {
    if (owner?.kind !== 'USER') {
      return []
    }
    return selectBookmarkStudyCandidates(
      await loadBookmarkCandidates(transaction, input, owner.id),
      input.requestedCount
    ).map(({ questionId, questionVersionId }) => ({
      questionId,
      questionVersionId
    }))
  }

  throw new StudySessionRepositoryIntegrityError(
    'Study selection mode is not supported.'
  )
}

const lockAndValidateSelectedQuestions = async (
  transaction: Prisma.TransactionClient,
  input: CreateStudySessionInput,
  selected: readonly SelectedQuestion[]
): Promise<void> => {
  const questionIds = selected.map(({ questionId }) => questionId).toSorted()
  const locked = await transaction.$queryRaw<SelectedQuestion[]>(Prisma.sql`
    SELECT
      question."id" AS "questionId",
      version."id" AS "questionVersionId"
    FROM "Question" AS question
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
      AND version."id" = question."currentPublishedVersionId"
    WHERE question."id" IN (${Prisma.join(questionIds)})
      AND question."lifecycleStatus" = 'ACTIVE'
      AND version."status" = 'PUBLISHED'
      AND version."level" = ${input.level}::"JlptLevel"
      AND version."subject" = ${input.subject}::"QuestionSubject"
    ORDER BY question."id" ASC
    FOR SHARE OF question, version
  `)
  const selectedById = new Map(
    selected.map(({ questionId, questionVersionId }) => [
      questionId,
      questionVersionId
    ])
  )
  if (
    locked.length !== selected.length ||
    locked.some(
      ({ questionId, questionVersionId }) =>
        selectedById.get(questionId) !== questionVersionId
    )
  ) {
    throw new StudySelectionChangedError(
      'Selected question availability changed during session creation.'
    )
  }
}

const updateReviewPointers = async (
  transaction: Prisma.TransactionClient,
  input: Pick<CreateStudySessionInput, 'mode' | 'startedAt'>,
  userId: string,
  selected: readonly SelectedQuestion[]
): Promise<void> => {
  const ordered = selected.toSorted((left, right) =>
    left.questionId.localeCompare(right.questionId)
  )

  for (const { questionId } of ordered) {
    await transaction.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
      SELECT 1 AS "locked"
      FROM (
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${userId}:${questionId}`}, 0)
        )
      ) AS acquired
    `)
  }

  const questionIds = ordered.map(({ questionId }) => questionId)
  const lockedNotes =
    input.mode === 'DAILY_REVIEW'
      ? await transaction.$queryRaw<
          Array<{ id: string; questionId: string }>
        >(Prisma.sql`
          SELECT note."id", note."questionId"
          FROM "WrongNote" AS note
          JOIN "ReviewSchedule" AS schedule
            ON schedule."wrongNoteId" = note."id"
          WHERE note."userId" = ${userId}::uuid
            AND note."questionId" IN (${Prisma.join(questionIds)})
            AND note."status" IN ('NEW', 'REVIEWING', 'AGAIN', 'SOLVED')
            AND schedule."nextReviewAt" <= ${input.startedAt}
          ORDER BY note."questionId" ASC
          FOR UPDATE OF note, schedule
        `)
      : await transaction.$queryRaw<
          Array<{ id: string; questionId: string }>
        >(Prisma.sql`
          SELECT note."id", note."questionId"
          FROM "WrongNote" AS note
          WHERE note."userId" = ${userId}::uuid
            AND note."questionId" IN (${Prisma.join(questionIds)})
            AND note."status" IN ('NEW', 'REVIEWING', 'AGAIN')
          ORDER BY note."questionId" ASC
          FOR UPDATE OF note
        `)
  if (lockedNotes.length !== selected.length) {
    throw new StudySelectionChangedError(
      'Selected review candidate changed during session creation.'
    )
  }
  const noteIdByQuestionId = new Map(
    lockedNotes.map(({ id, questionId }) => [questionId, id])
  )

  for (const candidate of ordered) {
    const wrongNoteId = noteIdByQuestionId.get(candidate.questionId)
    if (!wrongNoteId) {
      throw new StudySessionRepositoryIntegrityError(
        'Locked review candidate is missing its WrongNote.'
      )
    }
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "WrongNote" AS note
      SET "currentReviewQuestionVersionId" = ${candidate.questionVersionId}::uuid
      WHERE note."id" = ${wrongNoteId}::uuid
        AND (
          note."currentReviewQuestionVersionId" IS NULL
          OR EXISTS (
            SELECT 1
            FROM "QuestionVersion" AS old_version
            JOIN "QuestionVersion" AS new_version
              ON new_version."questionId" = old_version."questionId"
            WHERE old_version."id" = note."currentReviewQuestionVersionId"
              AND new_version."id" = ${candidate.questionVersionId}::uuid
              AND new_version."versionNumber" > old_version."versionNumber"
          )
        )
    `)
  }
}

export const createPrismaStudySessionRepository = (
  client: PrismaClient,
  {
    afterOwnedSessionLocked,
    afterSelectionLocked,
    delay: retryDelay = delay,
    jitterMilliseconds = () => randomInt(0, RETRY_JITTER_MAX_MS + 1),
    random = Math.random
  }: StudySessionRepositoryOptions = {}
): StudySessionRepository => {
  const create = (input: CreateStudySessionInput) =>
    executeRepositoryOperation(async () => {
      for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
          return await client.$transaction(
            async (transaction) => {
              const existingGuest = await findExistingGuest(transaction, input)
              const selectionOwner = toSelectionOwner(input, existingGuest)
              const selected = await selectStudyQuestions(
                transaction,
                input,
                selectionOwner,
                random
              )

              if (selected.length === 0) {
                throw new NoEligibleQuestionsError()
              }

              await lockAndValidateSelectedQuestions(
                transaction,
                input,
                selected
              )

              await afterSelectionLocked?.(
                selected.map(({ questionId, questionVersionId }) => ({
                  questionId,
                  questionVersionId
                }))
              )

              if (
                input.owner.kind === 'USER' &&
                (input.mode === 'WRONG_NOTE' || input.mode === 'DAILY_REVIEW')
              ) {
                await updateReviewPointers(
                  transaction,
                  input,
                  input.owner.userId,
                  selected
                )
              }

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
                if (existingGuest) {
                  guestPrincipalId = existingGuest.id
                  expiresAt =
                    existingGuest.expiresAt < expiresAt
                      ? existingGuest.expiresAt
                      : expiresAt
                  await transaction.guestPrincipal.update({
                    where: { id: existingGuest.id },
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
                  mode: input.mode,
                  status: 'IN_PROGRESS',
                  requestedCount: input.requestedCount,
                  actualCount: selected.length,
                  usedFallback: false,
                  fallbackReason: null,
                  practiceContractVersion: input.practiceContractVersion ?? 1,
                  startedAt: input.startedAt,
                  expiresAt
                },
                select: { id: true }
              })
              const sessionQuestions = selected.map((question, index) => ({
                id: randomUUID(),
                studySessionId: session.id,
                questionId: question.questionId,
                questionVersionId: question.questionVersionId,
                ordinal: index + 1,
                createdAt: input.startedAt
              }))
              await transaction.studySessionQuestion.createMany({
                data: sessionQuestions.map((question) => ({
                  id: question.id,
                  studySessionId: session.id,
                  questionId: question.questionId,
                  questionVersionId: question.questionVersionId,
                  ordinal: question.ordinal,
                  createdAt: input.startedAt
                }))
              })
              if ((input.practiceContractVersion ?? 1) === 2) {
                await transaction.studyDraft.create({
                  data: {
                    studySessionId: session.id,
                    revision: 0,
                    currentOrdinal: 1,
                    savedAt: null,
                    createdAt: input.startedAt,
                    updatedAt: input.startedAt,
                    answers: {
                      createMany: {
                        data: sessionQuestions.map((question) => ({
                          studySessionQuestionId: question.id,
                          questionVersionId: question.questionVersionId,
                          selectedOptionId: null,
                          elapsedSec: 0,
                          updatedAt: input.startedAt
                        }))
                      }
                    }
                  }
                })
              }
              const created = await loadStudySessionRecord(
                transaction,
                session.id
              )
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
    })

  return {
    create,
    createRandom: (input) => create({ ...input, mode: 'RANDOM' }),
    findOwnedById: (sessionId, owner, now) =>
      executeRepositoryOperation(async () => {
        return await client.$transaction(
          async (transaction) => {
            if (owner.kind === 'GUEST') {
              const credential = await transaction.guestPrincipal.findFirst({
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

            const ownerPredicate =
              owner.kind === 'USER'
                ? Prisma.sql`AND "userId" = ${owner.userId}::uuid`
                : Prisma.sql`AND "guestPrincipalId" = ${owner.guestPrincipalId}::uuid`
            const locked = await transaction.$queryRaw<
              { expiresAt: Date; status: StudySessionStatus }[]
            >(Prisma.sql`
            SELECT "status", "expiresAt"
            FROM "StudySession"
            WHERE "id" = ${sessionId}::uuid
              ${ownerPredicate}
            FOR UPDATE`)
            const lifecycle = locked[0]
            if (!lifecycle) {
              return null
            }
            await afterOwnedSessionLocked?.()
            if (
              lifecycle.status === 'IN_PROGRESS' &&
              lifecycle.expiresAt <= now
            ) {
              await transaction.studySession.update({
                where: { id: sessionId },
                data: { status: 'EXPIRED', updatedAt: now }
              })
              await transaction.studyDraft.deleteMany({
                where: { studySessionId: sessionId }
              })
            }
            return await loadStudySessionRecord(transaction, sessionId, owner)
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        )
      })
  }
}
