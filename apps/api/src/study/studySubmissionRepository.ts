import { type SubmittedStudyAnswer } from '@nihongo/domain/grading/grade-study-submission'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

import {
  canonicalizeTolerantStudySubmission,
  canonicalizeTolerantStudySubmissionV2,
  hashStudySubmission
} from './studySubmissionCanonicalizer.js'
import { toStudyResult } from './studySubmissionMapper.js'
import {
  createSerializableRetryJitterMs,
  getSerializableRetryDelayMs,
  SERIALIZABLE_MAX_ATTEMPTS
} from './serializableRetryPolicy.js'
import {
  delay,
  isDatabaseUnavailableError,
  isSerializableConflict,
  ownerWhere
} from './studyRepositorySupport.js'
import {
  type StudySubmissionRepositoryOptions,
  type OwnedStudySubmissionPreload,
  type StudySubmissionRepository,
  StudySessionNotEditableError,
  StudySubmissionRepositoryUnavailableError,
  StudySubmissionRepositoryIntegrityError,
  FreshTransactionRetry
} from './studySubmissionModel.js'
import {
  isFreshWrongNoteConflict,
  assertGuestProof
} from './studySubmissionLocks.js'
import { loadStudyResultRecord } from './studySubmissionRecords.js'
import { runAtomicSubmission } from './studySubmissionAtomic.js'

export type { StudySubmissionRepository } from './studySubmissionModel.js'
export {
  IdempotencyKeyReusedError,
  OwnedStudySessionNotFoundError,
  StudySessionAlreadySubmittedError,
  StudySessionNotEditableError,
  StudySubmissionContractVersionMismatchError,
  StudySubmissionRepositoryIntegrityError,
  StudySubmissionRepositoryUnavailableError
} from './studySubmissionModel.js'

export const createPrismaStudySubmissionRepository = (
  client: PrismaClient,
  options: StudySubmissionRepositoryOptions = {}
): StudySubmissionRepository => {
  const retryDelay = options.delay ?? delay
  const jitterMilliseconds =
    options.jitterMilliseconds ?? createSerializableRetryJitterMs

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
          attempt <= SERIALIZABLE_MAX_ATTEMPTS;
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
              attempt < SERIALIZABLE_MAX_ATTEMPTS
            ) {
              await retryDelay(
                getSerializableRetryDelayMs(attempt, jitterMilliseconds())
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
        return await client.$transaction(
          async (transaction) => {
            if (owner.kind === 'GUEST') {
              await assertGuestProof(transaction, owner, observedAt)
            }
            const session = await transaction.studySession.findFirst({
              where: {
                id: sessionId,
                practiceContractVersion: 2,
                ...ownerWhere(owner)
              },
              select: { status: true }
            })
            if (!session) {
              return { kind: 'NOT_FOUND' } as const
            }
            if (session.status !== 'SUBMITTED') {
              return { kind: 'NOT_READY' } as const
            }
            const record = await loadStudyResultRecord(
              transaction,
              sessionId,
              owner
            )
            if (!record) {
              const stillOwned = await transaction.studySession.findFirst({
                where: { id: sessionId, ...ownerWhere(owner) },
                select: { status: true }
              })
              if (!stillOwned) {
                return { kind: 'NOT_FOUND' } as const
              }
              if (stillOwned.status !== 'SUBMITTED') {
                return { kind: 'NOT_READY' } as const
              }
              throw new StudySubmissionRepositoryIntegrityError(
                'Submitted StudySession has no complete StudyResult.'
              )
            }
            return {
              kind: 'READY',
              response: toStudyResult(record)
            } as const
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
        )
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
  }
): string =>
  hashStudySubmission(
    canonicalizeTolerantStudySubmissionV2({
      sessionId: preload.sessionId,
      orderedSessionQuestions: preload.orderedSessionQuestions,
      answers: input.answers,
      durationSec: input.durationSec
    })
  )
