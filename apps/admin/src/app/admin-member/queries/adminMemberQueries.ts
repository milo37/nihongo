import { queryOptions } from '@tanstack/react-query'
import type {
  ListAdminMembersQuery,
  ReleaseAdminMemberRestrictionRequest,
  RestrictAdminMemberRequest
} from '@nihongo/contracts/admin/members'
import {
  getAdminMember,
  listAdminMembers,
  releaseAdminMemberRestriction,
  restrictAdminMember
} from '@nihongo/browser/api/admin-member/index'

export const adminMemberQueries = {
  allKey: () => ['admin-members'] as const,
  list: (actorId: string | null, epoch: number, query: ListAdminMembersQuery) =>
    queryOptions({
      queryKey: [
        ...adminMemberQueries.allKey(),
        'list',
        actorId,
        epoch,
        query
      ] as const,
      queryFn: () => listAdminMembers(query),
      staleTime: 15_000,
      retry: false
    }),
  detail: (actorId: string | null, epoch: number, memberId: string) =>
    queryOptions({
      queryKey: [
        ...adminMemberQueries.allKey(),
        'detail',
        actorId,
        epoch,
        memberId
      ] as const,
      queryFn: () => getAdminMember(memberId),
      staleTime: 15_000,
      retry: false
    })
} as const

export const adminMemberMutations = {
  restrict: (memberId: string) => ({
    mutationKey: [...adminMemberQueries.allKey(), 'restrict', memberId],
    mutationFn: (input: RestrictAdminMemberRequest) =>
      restrictAdminMember(memberId, input)
  }),
  release: (memberId: string) => ({
    mutationKey: [...adminMemberQueries.allKey(), 'release', memberId],
    mutationFn: (input: ReleaseAdminMemberRestrictionRequest) =>
      releaseAdminMemberRestriction(memberId, input)
  })
} as const
