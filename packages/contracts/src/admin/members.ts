import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  createPhase7TextSchema,
  nonNegativeSafeIntegerSchema,
  rowVersionSchema
} from '../common/content-validation.js'
import { createPageResponseSchema } from '../common/pagination.js'

export const listAdminMembersOperationId = 'admin.listAdminMembers' as const
export const getAdminMemberOperationId = 'admin.getAdminMember' as const
export const restrictAdminMemberOperationId =
  'admin.restrictAdminMember' as const
export const releaseAdminMemberRestrictionOperationId =
  'admin.releaseAdminMemberRestriction' as const

export const adminMemberStatusSchema = z.enum(['ACTIVE', 'RESTRICTED'])

export const adminMemberSortSchema = z.enum([
  'joinedAt',
  'lastStudiedAt',
  'solvedCount',
  'reportCount',
  'status'
])

export const adminMemberPageSizeSchema = z.union([
  z.literal(25),
  z.literal(50),
  z.literal(100)
])

// Exact full-address match only; the server normalizes case and outer spaces.
export const adminMemberEmailQuerySchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(320))

/**
 * Server sorted list. `lastStudiedAt` nulls are always last in both orders and
 * ties are broken by `memberId` ascending. With `email`, the result has 0..1
 * item and sort/page are ignored.
 */
export const listAdminMembersQuerySchema = z
  .object({
    email: adminMemberEmailQuerySchema.optional(),
    sort: adminMemberSortSchema.default('joinedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().pipe(adminMemberPageSizeSchema).default(25)
  })
  .strict()

/** Raw email is never part of the response. */
export const adminMemberSummarySchema = z
  .object({
    memberId: opaqueIdSchema,
    maskedEmail: z.string().min(1).max(320),
    joinedAt: isoDateTimeSchema,
    lastStudiedAt: isoDateTimeSchema.nullable(),
    solvedCount: nonNegativeSafeIntegerSchema,
    reportCount: nonNegativeSafeIntegerSchema,
    status: adminMemberStatusSchema,
    rowVersion: rowVersionSchema
  })
  .strict()

export const listAdminMembersResponseSchema = createPageResponseSchema(
  adminMemberSummarySchema
)

export const getAdminMemberParamsSchema = z
  .object({ memberId: opaqueIdSchema })
  .strict()

export const adminMemberDetailSchema = adminMemberSummarySchema
  .extend({
    restrictedAt: isoDateTimeSchema.nullable(),
    restrictionReason: createPhase7TextSchema({
      maxScalars: 500,
      multiline: true
    }).nullable()
  })
  .strict()
  .refine(
    (member) =>
      (member.status === 'RESTRICTED') ===
      (member.restrictedAt !== null && member.restrictionReason !== null),
    {
      path: ['status'],
      message: 'RESTRICTED일 때만 제한 시각과 사유가 있어야 합니다.'
    }
  )

export const getAdminMemberResponseSchema = adminMemberDetailSchema

export const restrictAdminMemberRequestSchema = z
  .object({
    expectedRowVersion: rowVersionSchema,
    reason: createPhase7TextSchema({ maxScalars: 500, multiline: true })
  })
  .strict()

export const releaseAdminMemberRestrictionRequestSchema = z
  .object({ expectedRowVersion: rowVersionSchema })
  .strict()

export const restrictAdminMemberResponseSchema = adminMemberDetailSchema
export const releaseAdminMemberRestrictionResponseSchema =
  adminMemberDetailSchema

const adminReadErrorCodes = [
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ADMIN_REQUIRED',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
] as const

export const listAdminMembersErrorSchema = createApiFailureSchema(
  z.enum(adminReadErrorCodes)
)
export const getAdminMemberErrorSchema = createApiFailureSchema(
  z.enum([...adminReadErrorCodes, 'RESOURCE_NOT_FOUND'])
)

/** Restriction commands require a fresh (5 minute) admin sign-in. */
export const adminMemberRestrictionErrorCodeSchema = z.enum([
  ...adminReadErrorCodes,
  'FRESH_ASSURANCE_REQUIRED',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'RESOURCE_NOT_FOUND',
  'VERSION_CONFLICT',
  'INVALID_STATE_TRANSITION'
])
export const adminMemberRestrictionErrorSchema = createApiFailureSchema(
  adminMemberRestrictionErrorCodeSchema
)

export type AdminMemberStatus = z.output<typeof adminMemberStatusSchema>
export type AdminMemberSort = z.output<typeof adminMemberSortSchema>
export type ListAdminMembersQuery = z.input<typeof listAdminMembersQuerySchema>
export type ParsedListAdminMembersQuery = z.output<
  typeof listAdminMembersQuerySchema
>
export type AdminMemberSummary = z.output<typeof adminMemberSummarySchema>
export type ListAdminMembersResponse = z.output<
  typeof listAdminMembersResponseSchema
>
export type AdminMemberDetail = z.output<typeof adminMemberDetailSchema>
export type RestrictAdminMemberRequest = z.input<
  typeof restrictAdminMemberRequestSchema
>
export type ReleaseAdminMemberRestrictionRequest = z.input<
  typeof releaseAdminMemberRestrictionRequestSchema
>
export type AdminMemberRestrictionError = z.output<
  typeof adminMemberRestrictionErrorSchema
>
