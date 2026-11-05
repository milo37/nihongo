import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  createContentTextSchema,
  nonNegativeSafeIntegerSchema,
  rowVersionSchema
} from '../common/content-validation.js'
import { createPageResponseSchema } from '../common/pagination.js'

const adminMemberStatusSchema = z.enum(['ACTIVE', 'RESTRICTED'])

export const adminMemberSortSchema = z.enum([
  'joinedAt',
  'lastStudiedAt',
  'solvedCount',
  'reportCount',
  'status'
])

const adminMemberPageSizeSchema = z.union([
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
const adminMemberSummarySchema = z
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
    restrictionReason: createContentTextSchema({
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
    reason: createContentTextSchema({ maxScalars: 500, multiline: true })
  })
  .strict()

export const releaseAdminMemberRestrictionRequestSchema = z
  .object({ expectedRowVersion: rowVersionSchema })
  .strict()

export const restrictAdminMemberResponseSchema = adminMemberDetailSchema
export const releaseAdminMemberRestrictionResponseSchema =
  adminMemberDetailSchema

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
