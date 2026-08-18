import type {
  ParsedSubmitStudySessionBody,
  ParsedSubmitStudySessionV2Body
} from '@nihongo/contracts/study/submit-study-session'
import type { StudyResult } from '@nihongo/contracts/study/study-result'
import {
  StudyGradingError,
  type StudyGradingErrorCode
} from '@nihongo/domain/grading/grade-study-submission'
import { WrongNoteReviewError } from '@nihongo/domain/review/apply-wrong-note-review'
import {
  StudySubmissionCanonicalizationError,
  type StudySubmissionCanonicalizationErrorCode
} from '@nihongo/domain/submission/canonicalize-study-submission'
import { ApplicationError } from '../errors/applicationError.js'
import {
  GuestCredentialExpiredError,
  type ExistingStudyOwner
} from './studySessionRepository.js'
import {
  createTolerantSubmissionHash,
  createTolerantSubmissionV2Hash,
  DraftSubmissionVersionConflictError,
  DraftSubmitMismatchError,
  IdempotencyKeyReusedError,
  OwnedStudySessionNotFoundError,
  StudySessionAlreadySubmittedError,
  StudySessionNotEditableError,
  StudySubmissionContractVersionMismatchError,
  StudySubmissionRepositoryIntegrityError,
  StudySubmissionRepositoryUnavailableError,
  type StudySubmissionRepository
} from './studySubmissionRepository.js'

interface SubmitStudySessionServiceResult {
  readonly guestProofExpiresAt: Date | null
  readonly replayed: boolean
  readonly response: StudyResult
}

export interface StudySubmissionService {
  getResult: (
    sessionId: string,
    owner: ExistingStudyOwner
  ) => Promise<StudyResult>
  submit: (
    sessionId: string,
    idempotencyKey: string,
    input: ParsedSubmitStudySessionBody | ParsedSubmitStudySessionV2Body,
    owner: ExistingStudyOwner,
    practiceContractVersion?: 1 | 2
  ) => Promise<SubmitStudySessionServiceResult>
}

const answerErrorCode = (
  code: StudyGradingErrorCode | StudySubmissionCanonicalizationErrorCode
):
  | 'ANSWER_NOT_IN_SESSION'
  | 'DUPLICATE_ANSWER'
  | 'INVALID_DURATION'
  | 'OPTION_NOT_IN_VERSION'
  | null => {
  switch (code) {
    case 'ANSWER_NOT_IN_SESSION':
    case 'DUPLICATE_ANSWER':
    case 'INVALID_DURATION':
    case 'OPTION_NOT_IN_VERSION':
      return code
    default:
      return null
  }
}

const throwMappedRepositoryError = (
  error: unknown,
  sessionId: string
): never => {
  if (error instanceof GuestCredentialExpiredError) {
    throw new ApplicationError({
      code: 'GUEST_SESSION_EXPIRED',
      message: '게스트 세션이 만료됐습니다.',
      retryable: false
    })
  }
  if (error instanceof OwnedStudySessionNotFoundError) {
    throw new ApplicationError({
      code: 'RESOURCE_NOT_FOUND',
      message: '학습 세션을 찾을 수 없습니다.',
      retryable: false
    })
  }
  if (error instanceof IdempotencyKeyReusedError) {
    throw new ApplicationError({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: '같은 멱등 키를 다른 제출 요청에 사용할 수 없습니다.',
      retryable: false
    })
  }
  if (error instanceof StudySessionAlreadySubmittedError) {
    throw new ApplicationError({
      code: 'SESSION_ALREADY_SUBMITTED',
      message: '이미 제출된 학습 세션입니다.',
      retryable: false,
      location: `/api/v1/study-sessions/${sessionId}/result`
    })
  }
  if (error instanceof StudySessionNotEditableError) {
    throw new ApplicationError({
      code: 'STUDY_SESSION_NOT_EDITABLE',
      message: '현재 상태에서는 학습 세션을 제출할 수 없습니다.',
      retryable: false
    })
  }
  if (error instanceof StudySubmissionContractVersionMismatchError) {
    throw new ApplicationError({
      code: 'PRACTICE_CONTRACT_VERSION_MISMATCH',
      message: '요청한 practice contract version과 세션이 일치하지 않습니다.',
      retryable: false
    })
  }
  if (error instanceof DraftSubmissionVersionConflictError) {
    throw new ApplicationError({
      code: 'DRAFT_VERSION_CONFLICT',
      message: '제출 전 초안 revision이 변경됐습니다.',
      retryable: false
    })
  }
  if (error instanceof DraftSubmitMismatchError) {
    throw new ApplicationError({
      code: 'DRAFT_SUBMIT_MISMATCH',
      message: '제출 답안이 저장된 초안과 일치하지 않습니다.',
      retryable: false
    })
  }
  if (
    error instanceof StudyGradingError ||
    error instanceof StudySubmissionCanonicalizationError
  ) {
    const code = answerErrorCode(error.code)
    if (code) {
      throw new ApplicationError({
        code,
        message: '제출한 답안이 학습 세션과 일치하지 않습니다.',
        retryable: false
      })
    }
  }
  if (error instanceof StudySubmissionRepositoryUnavailableError) {
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: '학습 제출 저장소에 연결할 수 없습니다.',
      retryable: true,
      cause: error
    })
  }
  if (
    error instanceof StudySubmissionRepositoryIntegrityError ||
    error instanceof WrongNoteReviewError ||
    error instanceof StudyGradingError ||
    error instanceof StudySubmissionCanonicalizationError
  ) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '학습 제출 무결성을 확인하지 못했습니다.',
      retryable: true,
      cause: error
    })
  }
  throw error
}

const withRepositoryErrors = async <Result>(
  sessionId: string,
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    return throwMappedRepositoryError(error, sessionId)
  }
}

export const createStudySubmissionService = (
  repository: StudySubmissionRepository,
  now: () => Date = () => new Date()
): StudySubmissionService => ({
  submit: (
    sessionId,
    idempotencyKey,
    input,
    owner,
    requestedContractVersion = 1
  ) =>
    withRepositoryErrors(sessionId, async () => {
      const observedAt = now()
      const preload = await repository.preloadOwned(
        sessionId,
        owner,
        observedAt
      )
      if (!preload) {
        throw new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '학습 세션을 찾을 수 없습니다.',
          retryable: false
        })
      }
      const expectedDraftRevision =
        'expectedDraftRevision' in input ? input.expectedDraftRevision : null
      const requestHash =
        requestedContractVersion === 2 && expectedDraftRevision !== null
          ? createTolerantSubmissionV2Hash(preload, {
              answers: input.answers,
              durationSec: input.durationSec,
              expectedDraftRevision
            })
          : createTolerantSubmissionHash(preload, input)
      return await repository.submitAtomic({
        sessionId,
        owner,
        idempotencyKey,
        requestHash,
        answers: input.answers,
        durationSec: input.durationSec,
        expectedDraftRevision,
        practiceContractVersion: requestedContractVersion,
        observedAt
      })
    }),
  getResult: (sessionId, owner) =>
    withRepositoryErrors(sessionId, async () => {
      const outcome = await repository.findOwnedResult(sessionId, owner, now())
      if (outcome.kind === 'NOT_FOUND') {
        throw new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '학습 세션을 찾을 수 없습니다.',
          retryable: false
        })
      }
      if (outcome.kind === 'NOT_READY') {
        throw new ApplicationError({
          code: 'STUDY_RESULT_NOT_READY',
          message: '아직 제출 결과가 준비되지 않았습니다.',
          retryable: false
        })
      }
      return outcome.response
    })
})
