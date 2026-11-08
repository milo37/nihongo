import { randomUUID } from 'node:crypto'

import {
  canonicalizeStudySubmission,
  canonicalizeStudySubmissionV2,
  type OrderedSessionQuestionForSubmission
} from '@nihongo/domain/submission/canonicalize-study-submission'
import {
  gradePinnedStudySubmission,
  type PinnedStudyQuestionForGrading
} from '@nihongo/domain/grading/grade-study-submission'
import { Prisma } from '../generated/prisma/client.js'

import { hashStudySubmission } from './studySubmissionCanonicalizer.js'
import { toStudyResult } from './studySubmissionMapper.js'

import { idempotencyOwnerWhere } from './studyRepositorySupport.js'
import {
  GUEST_RENEWAL_MS,
  IDEMPOTENCY_RETENTION_MS,
  type StudySubmissionRepositoryOptions,
  type SubmitStudySessionAtomicInput,
  type SubmitStudySessionAtomicResult,
  IdempotencyKeyReusedError,
  StudySessionAlreadySubmittedError,
  StudySessionNotEditableError,
  StudySubmissionContractVersionMismatchError,
  DraftSubmissionVersionConflictError,
  DraftSubmitMismatchError,
  OwnedStudySessionNotFoundError,
  StudySubmissionRepositoryIntegrityError,
  FreshTransactionRetry
} from './studySubmissionModel.js'
import {
  isOwner,
  parseStoredStudyResult,
  lockGuestProof,
  loadAtomicSession,
  lockSession,
  reserveIdempotency,
  lockWrongNotes
} from './studySubmissionLocks.js'
import {
  loadStudyResultRecord,
  createReviewFacts,
  assertEditable,
  expireLockedSubmissionSession
} from './studySubmissionRecords.js'

export type RunAtomicSubmissionOutcome =
  | { readonly kind: 'NOT_EDITABLE' }
  | {
      readonly kind: 'SUBMITTED'
      readonly value: SubmitStudySessionAtomicResult
    }

export const runAtomicSubmission = async (
  transaction: Prisma.TransactionClient,
  input: SubmitStudySessionAtomicInput,
  options: StudySubmissionRepositoryOptions
): Promise<RunAtomicSubmissionOutcome> => {
  const practiceContractVersion = input.practiceContractVersion ?? 2
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
        input.observedAt,
        input.owner.kind === 'GUEST'
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
  if (session.practiceContractVersion !== practiceContractVersion) {
    throw new StudySubmissionContractVersionMismatchError()
  }

  // Guests keep no draft, so only members' answers are checked against it (#737).
  if (practiceContractVersion === 2 && input.owner.kind !== 'GUEST') {
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
    await transaction.studyDraft.deleteMany({
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
