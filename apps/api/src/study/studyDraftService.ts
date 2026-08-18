import type { ParsedListResumableStudySessionsQuery } from '@nihongo/contracts/study/list-resumable-study-sessions'
import type { ParsedSaveStudyDraftAnswersBody } from '@nihongo/contracts/study/save-study-draft-answers'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import type { ListResumableStudySessionsResponse } from '@nihongo/contracts/study/list-resumable-study-sessions'
import { ApplicationError } from '../errors/applicationError.js'
import { GuestCredentialExpiredError } from './studySessionRepository.js'
import type { ExistingStudyOwner } from './studySessionRepository.js'
import {
  DraftAnswerNotInSessionError,
  DraftOptionNotInVersionError,
  DraftVersionConflictError,
  OwnedStudyDraftSessionNotFoundError,
  PracticeContractVersionMismatchError,
  StudyDraftNotEditableError,
  StudyDraftRepositoryIntegrityError,
  type StudyDraftRepository
} from './studyDraftRepository.js'
import {
  IdempotencyKeyReusedError,
  StudySubmissionRepositoryUnavailableError
} from './studySubmissionRepository.js'

export interface StudyDraftService {
  cancel: (sessionId: string, owner: ExistingStudyOwner) => Promise<void>
  get: (
    sessionId: string,
    owner: ExistingStudyOwner
  ) => Promise<StudyDraftSnapshot>
  listResumable: (
    owner: ExistingStudyOwner,
    query: ParsedListResumableStudySessionsQuery
  ) => Promise<ListResumableStudySessionsResponse>
  save: (
    sessionId: string,
    idempotencyKey: string,
    body: ParsedSaveStudyDraftAnswersBody,
    owner: ExistingStudyOwner
  ) => Promise<{ replayed: boolean; response: StudyDraftSnapshot }>
}

const throwMappedRepositoryError = (error: unknown): never => {
  if (error instanceof GuestCredentialExpiredError) {
    throw new ApplicationError({
      code: 'GUEST_SESSION_EXPIRED',
      message: '게스트 세션이 만료됐습니다.',
      retryable: false
    })
  }
  if (error instanceof OwnedStudyDraftSessionNotFoundError) {
    throw new ApplicationError({
      code: 'RESOURCE_NOT_FOUND',
      message: '학습 세션을 찾을 수 없습니다.',
      retryable: false
    })
  }
  if (error instanceof PracticeContractVersionMismatchError) {
    throw new ApplicationError({
      code: 'PRACTICE_CONTRACT_VERSION_MISMATCH',
      message: '이 학습 세션은 server draft contract를 지원하지 않습니다.',
      retryable: false
    })
  }
  if (error instanceof DraftVersionConflictError) {
    throw new ApplicationError({
      code: 'DRAFT_VERSION_CONFLICT',
      message: '다른 기기에서 초안이 먼저 변경됐습니다.',
      retryable: false
    })
  }
  if (error instanceof DraftAnswerNotInSessionError) {
    throw new ApplicationError({
      code: 'ANSWER_NOT_IN_SESSION',
      message: '초안 답안이 학습 세션 문제와 일치하지 않습니다.',
      retryable: false
    })
  }
  if (error instanceof DraftOptionNotInVersionError) {
    throw new ApplicationError({
      code: 'OPTION_NOT_IN_VERSION',
      message: '선택한 보기가 고정된 문제 version에 속하지 않습니다.',
      retryable: false
    })
  }
  if (error instanceof StudyDraftNotEditableError) {
    throw new ApplicationError({
      code: 'STUDY_SESSION_NOT_EDITABLE',
      message: '현재 상태에서는 학습 초안을 변경할 수 없습니다.',
      retryable: false
    })
  }
  if (error instanceof IdempotencyKeyReusedError) {
    throw new ApplicationError({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: '같은 멱등 키를 다른 초안 요청에 사용할 수 없습니다.',
      retryable: false
    })
  }
  if (error instanceof StudySubmissionRepositoryUnavailableError) {
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: '학습 초안 저장소에 연결할 수 없습니다.',
      retryable: true,
      cause: error
    })
  }
  if (error instanceof StudyDraftRepositoryIntegrityError) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '학습 초안 무결성을 확인하지 못했습니다.',
      retryable: true,
      cause: error
    })
  }
  throw error
}

const withRepositoryErrors = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    return throwMappedRepositoryError(error)
  }
}

export const createStudyDraftService = (
  repository: StudyDraftRepository,
  now: () => Date = () => new Date()
): StudyDraftService => ({
  get: (sessionId, owner) =>
    withRepositoryErrors(async () => {
      const draft = await repository.findOwned(sessionId, owner, now())
      if (!draft) {
        throw new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '학습 세션을 찾을 수 없습니다.',
          retryable: false
        })
      }
      return draft
    }),
  listResumable: (owner, query) =>
    withRepositoryErrors(() =>
      repository.listOwnedResumable(owner, query, now())
    ),
  save: (sessionId, idempotencyKey, body, owner) =>
    withRepositoryErrors(() =>
      repository.saveAtomic({
        sessionId,
        idempotencyKey,
        body,
        owner,
        observedAt: now()
      })
    ),
  cancel: (sessionId, owner) =>
    withRepositoryErrors(async () => {
      const outcome = await repository.cancelOwned(sessionId, owner, now())
      if (outcome.kind === 'NOT_FOUND') {
        throw new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '학습 세션을 찾을 수 없습니다.',
          retryable: false
        })
      }
      if (outcome.kind === 'NOT_EDITABLE') {
        throw new ApplicationError({
          code: 'STUDY_SESSION_NOT_EDITABLE',
          message: '현재 상태에서는 학습 세션을 취소할 수 없습니다.',
          retryable: false
        })
      }
    })
})
