import type {
  AdminMemberDetail,
  AdminMemberSummary,
  ListAdminMembersResponse,
  ParsedListAdminMembersQuery
} from '@nihongo/contracts/admin/members'
import { ApplicationError } from '../errors/applicationError.js'
import {
  AdminMemberRepositoryUnavailableError,
  type AdminMemberRecord,
  type AdminMemberRepository,
  type AdminMemberRestrictionOutcome
} from './adminMemberRepository.js'

export interface AdminMemberService {
  readonly listMembers: (
    actorId: string,
    query: ParsedListAdminMembersQuery
  ) => Promise<ListAdminMembersResponse>
  readonly getMember: (
    actorId: string,
    memberId: string
  ) => Promise<AdminMemberDetail>
  readonly restrict: (input: {
    readonly actorId: string
    readonly memberId: string
    readonly expectedRowVersion: number
    readonly reason: string
  }) => Promise<AdminMemberDetail>
  readonly releaseRestriction: (input: {
    readonly actorId: string
    readonly memberId: string
    readonly expectedRowVersion: number
  }) => Promise<AdminMemberDetail>
}

const toSummary = (record: AdminMemberRecord): AdminMemberSummary => ({
  memberId: record.memberId,
  maskedEmail: record.maskedEmail,
  joinedAt: record.joinedAt.toISOString(),
  lastStudiedAt: record.lastStudiedAt?.toISOString() ?? null,
  solvedCount: record.solvedCount,
  reportCount: record.reportCount,
  status: record.restrictedAt === null ? 'ACTIVE' : 'RESTRICTED',
  rowVersion: record.rowVersion
})

const toDetail = (record: AdminMemberRecord): AdminMemberDetail => ({
  ...toSummary(record),
  restrictedAt: record.restrictedAt?.toISOString() ?? null,
  restrictionReason:
    record.restrictedAt === null ? null : record.restrictionReason
})

const notFound = (): ApplicationError =>
  new ApplicationError({
    code: 'RESOURCE_NOT_FOUND',
    message: '회원을 찾을 수 없습니다.',
    retryable: false
  })

const OUTCOME_ERRORS: Record<
  Exclude<AdminMemberRestrictionOutcome, 'OK'>,
  () => ApplicationError
> = {
  NOT_FOUND: notFound,
  VERSION_CONFLICT: () =>
    new ApplicationError({
      code: 'VERSION_CONFLICT',
      message: '다른 관리자가 먼저 회원 상태를 바꿨습니다. 새로 불러와 주세요.',
      retryable: false
    }),
  INVALID_STATE_TRANSITION: () =>
    new ApplicationError({
      code: 'INVALID_STATE_TRANSITION',
      message: '현재 회원 상태에서는 이 작업을 할 수 없습니다.',
      retryable: false
    })
}

const withRepositoryErrors = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof AdminMemberRepositoryUnavailableError) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '회원 저장소에 연결할 수 없습니다.',
        retryable: true,
        retryAfterSeconds: 5,
        cause: error
      })
    }
    throw error
  }
}

export const createAdminMemberService = (
  repository: AdminMemberRepository
): AdminMemberService => {
  const getMember = (actorId: string, memberId: string) =>
    withRepositoryErrors(async () => {
      const record = await repository.getMember(actorId, memberId)
      if (!record) throw notFound()
      return toDetail(record)
    })

  const change = (
    actorId: string,
    memberId: string,
    expectedRowVersion: number,
    reason: string | null
  ) =>
    withRepositoryErrors(async () => {
      const outcome = await repository.setRestriction({
        actorId,
        memberId,
        expectedRowVersion,
        reason
      })
      if (outcome !== 'OK') throw OUTCOME_ERRORS[outcome]()
      return getMember(actorId, memberId)
    })

  return {
    listMembers: (actorId, query) =>
      withRepositoryErrors(async () => {
        const page = await repository.listMembers(actorId, query)
        return {
          items: page.items.map(toSummary),
          page: query.email === undefined ? query.page : 1,
          pageSize: query.pageSize,
          total: page.total
        }
      }),
    getMember,
    restrict: ({ actorId, memberId, expectedRowVersion, reason }) =>
      change(actorId, memberId, expectedRowVersion, reason),
    releaseRestriction: ({ actorId, memberId, expectedRowVersion }) =>
      change(actorId, memberId, expectedRowVersion, null)
  }
}
