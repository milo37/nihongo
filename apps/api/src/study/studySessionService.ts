import type { ParsedCreateStudySessionV2Body } from '@nihongo/contracts/study/create-study-session'
import type { VersionedStudySessionPayload } from '@nihongo/contracts/study/study-session'
import {
  GUEST_DAILY_SESSION_LIMIT,
  GUEST_SESSION_QUESTION_LIMIT
} from '@nihongo/contracts/study/guest-limits'
import { ApplicationError } from '../errors/applicationError.js'
import {
  GuestCredentialExpiredError,
  GuestDailyLimitReachedError,
  NoEligibleQuestionsError,
  StudySessionRepositoryUnavailableError,
  type CreateStudyOwner,
  type ExistingStudyOwner,
  type StudySessionRepository
} from './studySessionRepository.js'
import { toVersionedStudySessionPayload } from './studySessionMapper.js'

const STUDY_SESSION_TTL_MS = 24 * 60 * 60 * 1_000

export interface StudySessionService {
  create: (
    input: ParsedCreateStudySessionV2Body,
    owner: CreateStudyOwner
  ) => Promise<{
    payload: VersionedStudySessionPayload
    practiceContractVersion: 2
    issuedGuestCredential:
      | import('../auth/guestPrincipalService.js').PreparedGuestCredential
      | null
  }>
  get: (
    sessionId: string,
    owner: ExistingStudyOwner
  ) => Promise<VersionedStudySessionPayload>
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
    if (error instanceof GuestDailyLimitReachedError) {
      throw new ApplicationError({
        code: 'GUEST_LIMIT_REACHED',
        message: `비회원은 하루 ${GUEST_DAILY_SESSION_LIMIT}번까지 풀 수 있습니다. 더 풀려면 로그인해 주세요.`,
        details: { resetsAt: error.resetsAt.toISOString() },
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
  create: async (input, owner) => {
    // Guests only try short random sessions (#737).
    if (input.mode !== 'RANDOM' && owner.kind !== 'USER') {
      throw new ApplicationError({
        code: 'AUTHENTICATION_REQUIRED',
        message: '이 출제 모드는 로그인이 필요합니다.',
        retryable: false
      })
    }
    if (owner.kind !== 'USER' && input.count !== GUEST_SESSION_QUESTION_LIMIT) {
      throw new ApplicationError({
        code: 'VALIDATION_ERROR',
        message: `비회원은 ${GUEST_SESSION_QUESTION_LIMIT}문제씩 풀 수 있습니다.`,
        fieldErrors: {
          count: [`${GUEST_SESSION_QUESTION_LIMIT}이어야 합니다.`]
        },
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
        ...(input.reviewFilter ? { reviewFilter: input.reviewFilter } : {}),
        startedAt,
        expiresAt: new Date(startedAt.getTime() + STUDY_SESSION_TTL_MS),
        owner,
        practiceContractVersion: 2
      })
      return {
        payload: toVersionedStudySessionPayload(created.session),
        practiceContractVersion: 2,
        issuedGuestCredential: created.issuedGuestCredential
      }
    })
  },
  get: (sessionId, owner) =>
    withRepositoryErrors(async () => {
      const record = await repository.findOwnedById(sessionId, owner, now())
      if (!record) {
        throw new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '학습 세션을 찾을 수 없습니다.',
          retryable: false
        })
      }
      // Sessions from the retired contract 1 cannot be read.
      if ((record.practiceContractVersion ?? 1) !== 2) {
        throw new ApplicationError({
          code: 'PRACTICE_CONTRACT_VERSION_MISMATCH',
          message:
            '요청한 practice contract version과 세션이 일치하지 않습니다.',
          retryable: false
        })
      }
      return toVersionedStudySessionPayload(record)
    })
})
