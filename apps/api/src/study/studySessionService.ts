import type { ParsedCreateStudySessionBody } from '@nihongo/contracts/study/create-study-session'
import type {
  StudySessionPayload,
  VersionedStudySessionPayload
} from '@nihongo/contracts/study/study-session'
import { ApplicationError } from '../errors/applicationError.js'
import {
  GuestCredentialExpiredError,
  NoEligibleQuestionsError,
  StudySessionRepositoryUnavailableError,
  type CreateStudyOwner,
  type ExistingStudyOwner,
  type StudySessionRepository
} from './studySessionRepository.js'
import {
  toStudySessionPayload,
  toVersionedStudySessionPayload
} from './studySessionMapper.js'

const STUDY_SESSION_TTL_MS = 24 * 60 * 60 * 1_000

export interface StudySessionService {
  create: (
    input: ParsedCreateStudySessionBody,
    owner: CreateStudyOwner,
    practiceContractVersion?: 1 | 2
  ) => Promise<{
    payload: StudySessionPayload | VersionedStudySessionPayload
    practiceContractVersion?: 1 | 2
    issuedGuestCredential:
      | import('../auth/guestPrincipalService.js').PreparedGuestCredential
      | null
  }>
  get: (
    sessionId: string,
    owner: ExistingStudyOwner,
    requestedContractVersion?: 1 | 2
  ) => Promise<StudySessionPayload | VersionedStudySessionPayload>
}

const withRepositoryErrors = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof NoEligibleQuestionsError) {
      throw new ApplicationError({
        code: 'NO_ELIGIBLE_QUESTIONS',
        message: '선택한 조건에 출제 가능한 문제가 없습니다.',
        retryable: false
      })
    }
    if (error instanceof GuestCredentialExpiredError) {
      throw new ApplicationError({
        code: 'GUEST_SESSION_EXPIRED',
        message: '게스트 세션이 만료됐습니다.',
        retryable: false
      })
    }
    if (error instanceof StudySessionRepositoryUnavailableError) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '학습 세션 저장소에 연결할 수 없습니다.',
        retryable: true,
        cause: error
      })
    }
    throw error
  }
}

export const createStudySessionService = (
  repository: StudySessionRepository,
  now: () => Date = () => new Date()
): StudySessionService => ({
  create: async (input, owner, requestedContractVersion = 1) => {
    if (requestedContractVersion === 1 && input.mode !== 'RANDOM') {
      throw new ApplicationError({
        code: 'VALIDATION_ERROR',
        message: 'v1 practice contract는 RANDOM 모드만 지원합니다.',
        fieldErrors: { mode: ['v1에서는 RANDOM 모드만 지원합니다.'] },
        retryable: false
      })
    }
    if (input.mode === 'BOOKMARK') {
      throw new ApplicationError({
        code: 'VALIDATION_ERROR',
        message: 'BOOKMARK 모드는 Slice 4에서 활성화됩니다.',
        fieldErrors: { mode: ['BOOKMARK 모드는 아직 사용할 수 없습니다.'] },
        retryable: false
      })
    }
    if (
      (input.mode === 'WRONG_NOTE' || input.mode === 'DAILY_REVIEW') &&
      owner.kind !== 'USER'
    ) {
      throw new ApplicationError({
        code: 'AUTHENTICATION_REQUIRED',
        message: '이 출제 모드는 로그인이 필요합니다.',
        retryable: false
      })
    }
    return await withRepositoryErrors(async () => {
      const startedAt = now()
      const created = await repository.create({
        level: input.level,
        subject: input.subject,
        mode: input.mode,
        requestedCount: input.count,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + STUDY_SESSION_TTL_MS),
        owner,
        ...(requestedContractVersion === 2
          ? { practiceContractVersion: 2 as const }
          : {})
      })
      return {
        payload:
          requestedContractVersion === 2
            ? toVersionedStudySessionPayload(created.session)
            : toStudySessionPayload(created.session),
        practiceContractVersion: requestedContractVersion,
        issuedGuestCredential: created.issuedGuestCredential
      }
    })
  },
  get: (sessionId, owner, requestedContractVersion = 1) =>
    withRepositoryErrors(async () => {
      const record = await repository.findOwnedById(sessionId, owner, now())
      if (!record) {
        throw new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '학습 세션을 찾을 수 없습니다.',
          retryable: false
        })
      }
      if (
        requestedContractVersion === 1 &&
        (record.practiceContractVersion ?? 1) !== 1
      ) {
        throw new ApplicationError({
          code: 'PRACTICE_CONTRACT_VERSION_MISMATCH',
          message:
            '요청한 practice contract version과 세션이 일치하지 않습니다.',
          retryable: false
        })
      }
      return requestedContractVersion === 2
        ? toVersionedStudySessionPayload(record)
        : toStudySessionPayload(record)
    })
})
