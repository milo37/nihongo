import {
  getAdminMemberResponseSchema,
  listAdminMembersResponseSchema,
  releaseAdminMemberRestrictionResponseSchema,
  restrictAdminMemberResponseSchema,
  type ListAdminMembersQuery,
  type ReleaseAdminMemberRestrictionRequest,
  type RestrictAdminMemberRequest
} from '@nihongo/contracts/admin/members'
import { safeGet, safePost } from '../http'

const MEMBERS_PATH = '/v1/admin/members'
const memberPath = (memberId: string): string =>
  `${MEMBERS_PATH}/${encodeURIComponent(memberId)}`

const requestMembers = safeGet(listAdminMembersResponseSchema)
const requestMember = safeGet(getAdminMemberResponseSchema)
const requestRestriction = safePost(restrictAdminMemberResponseSchema)
const requestRestrictionRelease = safePost(
  releaseAdminMemberRestrictionResponseSchema
)

export const listAdminMembers = (query: ListAdminMembersQuery) =>
  requestMembers(MEMBERS_PATH, query)

export const getAdminMember = (memberId: string) =>
  requestMember(memberPath(memberId))

export const restrictAdminMember = (
  memberId: string,
  body: RestrictAdminMemberRequest
) => requestRestriction(`${memberPath(memberId)}/restriction`, body)

export const releaseAdminMemberRestriction = (
  memberId: string,
  body: ReleaseAdminMemberRestrictionRequest
) =>
  requestRestrictionRelease(`${memberPath(memberId)}/restriction-release`, body)
