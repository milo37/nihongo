import type { VersionedStudySessionPayload } from '@nihongo/contracts/study/study-session'
import { ApplicationError } from '../errors/applicationError.js'
import {
  GuestCredentialExpiredError,
  NoEligibleQuestionsError,
  type ExistingStudyOwner
} from './studySessionRepository.js'
import {
  ResultRetryIdempotencyKeyReusedError,
  ResultRetrySourceNotFoundError,
  ResultRetryStudyResultNotReadyError,
  StudyResultRetryRepositoryIntegrityError,
  StudyResultRetryRepositoryUnavailableError,
  type StudyResultRetryRepository
} from './studyResultRetryRepository.js'

export interface CreateResultRetryServiceResult {
  readonly replayed: boolean
  readonly response: VersionedStudySessionPayload
}

export interface StudyResultRetryService {
  create: (
    sourceSessionId: string,
    idempotencyKey: string,
    owner: ExistingStudyOwner
  ) => Promise<CreateResultRetryServiceResult>
}

const throwMappedError = (error: unknown): never => {
  if (error instanceof GuestCredentialExpiredError) {
    throw new ApplicationError({
      code: 'GUEST_SESSION_EXPIRED',
      message: '게스트 세션이 만료됐습니다.',
      retryable: false
    })
  }
  if (error instanceof ResultRetrySourceNotFoundError) {
    throw new ApplicationError({
      code: 'RESOURCE_NOT_FOUND',
      message: '재출제할 학습 결과를 찾을 수 없습니다.',
      retryable: false
    })
  }
  if (error instanceof ResultRetryStudyResultNotReadyError) {
    throw new ApplicationError({
      code: 'STUDY_RESULT_NOT_READY',
      message: '제출 결과가 준비된 뒤 오답을 다시 풀 수 있습니다.',
      retryable: false
    })
  }
  if (error instanceof ResultRetryIdempotencyKeyReusedError) {
    throw new ApplicationError({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: '같은 멱등 키를 다른 재출제 요청에 사용할 수 없습니다.',
      retryable: false
    })
  }
  if (error instanceof NoEligibleQuestionsError) {
    throw new ApplicationError({
      code: 'NO_ELIGIBLE_QUESTIONS',
      message: '다시 풀 수 있는 오답 문제가 없습니다.',
      retryable: false
    })
  }
  if (error instanceof StudyResultRetryRepositoryUnavailableError) {
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: '오답 재출제 저장소에 연결할 수 없습니다.',
      retryable: true,
      cause: error
    })
  }
  if (error instanceof StudyResultRetryRepositoryIntegrityError) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '오답 재출제 무결성을 확인하지 못했습니다.',
      retryable: true,
      cause: error
    })
  }
  throw error
}

export const createStudyResultRetryService = (
  repository: StudyResultRetryRepository,
  now: () => Date = () => new Date()
): StudyResultRetryService => ({
  create: async (sourceSessionId, idempotencyKey, owner) => {
    try {
      return await repository.createAtomic({
        sourceSessionId,
        idempotencyKey,
        owner,
        observedAt: now()
      })
    } catch (error: unknown) {
      return throwMappedError(error)
    }
  }
})
