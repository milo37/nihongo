import type {
  CreateQuestionReportRequest,
  ListAdminQuestionReportsQuery,
  ListAdminQuestionReportsResponse,
  QuestionReportDetail,
  QuestionReportMutationResult
} from '@nihongo/contracts/admin/phase7'
import { ApplicationError } from '../errors/applicationError.js'
import type { QuestionReportRateLimiter } from './questionReportRateLimiter.js'
import {
  QuestionReportRepositoryError,
  type QuestionReportCreateAuthority,
  type QuestionReportRepository
} from './questionReportRepository.js'

export interface QuestionReportService {
  readonly createReport: (
    authority: QuestionReportCreateAuthority,
    request: CreateQuestionReportRequest
  ) => Promise<QuestionReportMutationResult>
  readonly listReports: (
    query: ListAdminQuestionReportsQuery
  ) => Promise<ListAdminQuestionReportsResponse>
  readonly getReport: (reportId: string) => Promise<QuestionReportDetail>
}

const execute = async <Result>(operation: () => Promise<Result>) => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof ApplicationError) throw error
    if (error instanceof QuestionReportRepositoryError) {
      throw new ApplicationError({
        code: error.code,
        message: error.message,
        retryable: error.code === 'SERVICE_UNAVAILABLE',
        ...(error.code === 'SERVICE_UNAVAILABLE'
          ? { retryAfterSeconds: 5 }
          : {}),
        phase7Disposition: error.disposition,
        cause: error
      })
    }
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: '문제 신고 저장소에 연결할 수 없습니다.',
      retryable: true,
      retryAfterSeconds: 5,
      phase7Disposition: 'NO_TX',
      cause: error
    })
  }
}

export const createQuestionReportService = ({
  rateLimiter,
  repository
}: {
  readonly rateLimiter: QuestionReportRateLimiter
  readonly repository: QuestionReportRepository
}): QuestionReportService => ({
  createReport: (authority, request) =>
    execute(async () => {
      const target = await repository.findEntitledTarget(
        authority.actorId,
        request.questionVersionId
      )
      if (!target) {
        throw new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '신고할 수 있는 문제 버전을 찾을 수 없습니다.',
          retryable: false,
          phase7Disposition: 'NO_TX'
        })
      }
      await rateLimiter.consume({
        group: 'REPORT_VERSION',
        value: request.questionVersionId
      })
      const duplicateState = await repository.findEntitledDuplicateState(
        authority.actorId,
        request.questionVersionId,
        request.reason
      )
      if (!duplicateState) {
        throw new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '신고할 수 있는 문제 버전을 찾을 수 없습니다.',
          retryable: false,
          phase7Disposition: 'NO_TX'
        })
      }
      if (duplicateState.hasOpenDuplicate) {
        throw new ApplicationError({
          code: 'QUESTION_REPORT_DUPLICATE',
          message: '같은 문제 버전과 사유의 처리 중 신고가 이미 있습니다.',
          retryable: false,
          phase7Disposition: 'NO_TX'
        })
      }
      return repository.create(authority, duplicateState.questionId, request)
    }),
  listReports: (query) => execute(() => repository.list(query)),
  getReport: (reportId) =>
    execute(async () => {
      const report = await repository.get(reportId)
      if (!report) {
        throw new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '문제 신고를 찾을 수 없습니다.',
          retryable: false,
          phase7Disposition: 'NO_TX'
        })
      }
      return report
    })
})
