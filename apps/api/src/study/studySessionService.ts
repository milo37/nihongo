import type { ParsedCreateStudySessionBody } from '@nihongo/contracts/study/create-study-session'
import type { StudySessionPayload } from '@nihongo/contracts/study/study-session'
import { ApplicationError } from '../errors/applicationError.js'
import {
  GuestCredentialExpiredError,
  NoEligibleQuestionsError,
  StudySessionRepositoryUnavailableError,
  type CreateStudyOwner,
  type ExistingStudyOwner,
  type StudySessionRepository
} from './studySessionRepository.js'
import { toStudySessionPayload } from './studySessionMapper.js'

const STUDY_SESSION_TTL_MS = 24 * 60 * 60 * 1_000

export interface StudySessionService {
  create: (
    input: ParsedCreateStudySessionBody,
    owner: CreateStudyOwner
  ) => Promise<{
    payload: StudySessionPayload
    issuedGuestCredential:
      | import('../auth/guestPrincipalService.js').PreparedGuestCredential
      | null
  }>
  get: (
    sessionId: string,
    owner: ExistingStudyOwner
  ) => Promise<StudySessionPayload>
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
  create: async (input, owner) => {
    if (input.mode !== 'RANDOM') {
      throw new ApplicationError({
        code: 'VALIDATION_ERROR',
        message: '현재 RANDOM 출제 모드만 사용할 수 있습니다.',
        fieldErrors: { mode: ['현재 RANDOM 모드만 지원합니다.'] },
        retryable: false
      })
    }
    if (input.explicitQuestionIds) {
      throw new ApplicationError({
        code: 'VALIDATION_ERROR',
        message: '명시 문제 출제는 아직 사용할 수 없습니다.',
        fieldErrors: {
          explicitQuestionIds: ['명시 문제 출제는 아직 지원하지 않습니다.']
        },
        retryable: false
      })
    }

    return await withRepositoryErrors(async () => {
      const startedAt = now()
      const created = await repository.createRandom({
        level: input.level,
        subject: input.subject,
        requestedCount: input.count,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + STUDY_SESSION_TTL_MS),
        owner
      })
      return {
        payload: toStudySessionPayload(created.session),
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
      return toStudySessionPayload(record)
    })
})
