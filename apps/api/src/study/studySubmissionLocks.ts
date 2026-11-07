import { randomUUID } from 'node:crypto'
import { submitStudySessionV2ResponseSchema } from '@nihongo/contracts/study/submit-study-session'
import type { StudyResult } from '@nihongo/contracts/study/study-result'
import { type WrongNoteReviewState } from '@nihongo/domain/review/apply-wrong-note-review'

import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  GuestCredentialExpiredError,
  type ExistingStudyOwner
} from './studySessionRepository.js'

import { ownerWhere, type ReservationRow } from './studyRepositorySupport.js'
import {
  type SubmitStudySessionAtomicInput,
  StudySubmissionRepositoryIntegrityError,
  type GuestProofRow,
  type LockedSessionRow,
  type LockedWrongNoteRow,
  type AtomicSession
} from './studySubmissionModel.js'

export const isFreshWrongNoteConflict = (error: unknown): boolean => {
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

export const isOwner = (
  row: { userId: string | null; guestPrincipalId: string | null },
  owner: ExistingStudyOwner
): boolean =>
  owner.kind === 'USER'
    ? row.userId === owner.userId && row.guestPrincipalId === null
    : row.guestPrincipalId === owner.guestPrincipalId && row.userId === null

export const parseStoredStudyResult = (
  value: unknown,
  message: string
): StudyResult => {
  try {
    return submitStudySessionV2ResponseSchema.parse(value)
  } catch (error: unknown) {
    throw new StudySubmissionRepositoryIntegrityError(message, {
      cause: error
    })
  }
}

export const lockGuestProof = async (
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

export const assertGuestProof = async (
  client: PrismaClient | Prisma.TransactionClient,
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

export const loadAtomicSession = async (
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
      practiceContractVersion: true
    }
  })
  if (!session) {
    return null
  }

  const draft = await transaction.studyDraft.findUnique({
    where: { studySessionId: sessionId },
    select: { revision: true }
  })
  const draftAnswers = draft
    ? await transaction.studyDraftAnswer.findMany({
        where: { studySessionId: sessionId },
        select: {
          studySessionQuestionId: true,
          selectedOptionId: true,
          elapsedSec: true
        }
      })
    : []
  const sessionQuestions = await transaction.studySessionQuestion.findMany({
    where: { studySessionId: sessionId },
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      ordinal: true,
      questionId: true,
      questionVersionId: true
    }
  })
  const questionVersionIds = sessionQuestions.map(
    ({ questionVersionId }) => questionVersionId
  )
  const questionVersions =
    questionVersionIds.length === 0
      ? []
      : await transaction.questionVersion.findMany({
          where: { id: { in: questionVersionIds } },
          select: { id: true, correctOptionId: true }
        })
  const options =
    questionVersionIds.length === 0
      ? []
      : await transaction.questionOption.findMany({
          where: { questionVersionId: { in: questionVersionIds } },
          orderBy: [{ questionVersionId: 'asc' }, { ordinal: 'asc' }],
          select: { id: true, questionVersionId: true }
        })
  const versionsById = new Map(
    questionVersions.map((version) => [version.id, version])
  )
  const optionIdsByVersionId = new Map<string, string[]>()
  for (const option of options) {
    const optionIds = optionIdsByVersionId.get(option.questionVersionId)
    if (optionIds) {
      optionIds.push(option.id)
    } else {
      optionIdsByVersionId.set(option.questionVersionId, [option.id])
    }
  }

  return {
    status: session.status,
    expiresAt: session.expiresAt,
    startedAt: session.startedAt,
    mode: session.mode,
    practiceContractVersion: session.practiceContractVersion,
    draft: draft ? { revision: draft.revision, answers: draftAnswers } : null,
    questions: sessionQuestions.map((question) => {
      const questionVersion = versionsById.get(question.questionVersionId)
      if (!questionVersion?.correctOptionId) {
        throw new StudySubmissionRepositoryIntegrityError(
          'Pinned QuestionVersion has no correct option.'
        )
      }
      return {
        studySessionQuestionId: question.id,
        questionId: question.questionId,
        questionVersionId: question.questionVersionId,
        ordinal: question.ordinal,
        correctOptionId: questionVersion.correctOptionId,
        optionIds: optionIdsByVersionId.get(question.questionVersionId) ?? []
      }
    })
  }
}

export const lockSession = async (
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

export const reserveIdempotency = async (
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
            ${input.requestHash}, ${input.practiceContractVersion ?? 2},
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
            ${input.requestHash}, ${input.practiceContractVersion ?? 2},
            'PROCESSING'::"IdempotencyState",
            ${input.observedAt}
          )
          ON CONFLICT DO NOTHING
          RETURNING "id"
        `)

  return rows.length === 1
}

export const lockWrongNotes = async (
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

export const toWrongNoteState = (
  row: LockedWrongNoteRow
): WrongNoteReviewState => ({
  wrongCount: row.wrongCount,
  correctStreak: row.correctStreak,
  status: row.status,
  lastWrongAt: row.lastWrongAt,
  lastReviewedAt: row.lastReviewedAt
})
