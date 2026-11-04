import type { ParsedListAdminMembersQuery } from '@nihongo/contracts/admin/members'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

export interface AdminMemberRecord {
  readonly memberId: string
  readonly maskedEmail: string
  readonly joinedAt: Date
  readonly lastStudiedAt: Date | null
  readonly solvedCount: number
  readonly reportCount: number
  readonly restrictedAt: Date | null
  readonly restrictionReason: string | null
  readonly rowVersion: number
}

export interface AdminMemberPage {
  readonly items: readonly AdminMemberRecord[]
  readonly total: number
}

export type AdminMemberRestrictionOutcome =
  | 'OK'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'INVALID_STATE_TRANSITION'

export interface AdminMemberRestrictionChange {
  readonly actorId: string
  readonly memberId: string
  readonly expectedRowVersion: number
  /** `null` lifts the restriction. */
  readonly reason: string | null
}

/**
 * Reads and writes go through SECURITY DEFINER functions (JLP-691):
 * nihongo_app cannot read "User" and only ever sees the masked email.
 */
export interface AdminMemberRepository {
  readonly listMembers: (
    actorId: string,
    query: ParsedListAdminMembersQuery
  ) => Promise<AdminMemberPage>
  readonly getMember: (
    actorId: string,
    memberId: string
  ) => Promise<AdminMemberRecord | null>
  readonly setRestriction: (
    change: AdminMemberRestrictionChange
  ) => Promise<AdminMemberRestrictionOutcome>
}

export class AdminMemberRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Admin member repository is unavailable.', options)
    this.name = 'AdminMemberRepositoryUnavailableError'
  }
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

const execute = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientInitializationError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        UNAVAILABLE_PRISMA_CODES.has(error.code))
    ) {
      throw new AdminMemberRepositoryUnavailableError({ cause: error })
    }
    throw error
  }
}

interface MemberRow extends AdminMemberRecord {
  readonly total?: bigint
}

const toRecord = ({ total: _total, ...row }: MemberRow): AdminMemberRecord =>
  row

const OUTCOMES = new Set<AdminMemberRestrictionOutcome>([
  'OK',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'INVALID_STATE_TRANSITION'
])

export const createPrismaAdminMemberRepository = (
  client: PrismaClient
): AdminMemberRepository => ({
  listMembers: (actorId, query) =>
    execute(async () => {
      const byEmail = query.email !== undefined
      const pageSize = byEmail ? 1 : query.pageSize
      const offset = byEmail ? 0 : (query.page - 1) * query.pageSize
      const rows = await client.$queryRaw<MemberRow[]>`
        SELECT * FROM "admin_list_members"(
          ${actorId}::uuid, ${query.email ?? null}::text, ${query.sort}::text,
          ${query.order === 'desc'}::boolean, ${pageSize}::int, ${offset}::int
        )
      `
      if (rows.length > 0 || byEmail) {
        return {
          items: rows.map(toRecord),
          total: Number(rows[0]?.total ?? 0n)
        }
      }
      // An out-of-range page still reports the real total.
      const [first] = await client.$queryRaw<MemberRow[]>`
        SELECT * FROM "admin_list_members"(
          ${actorId}::uuid, NULL::text, ${query.sort}::text,
          ${query.order === 'desc'}::boolean, 1, 0
        )
      `
      return { items: [], total: Number(first?.total ?? 0n) }
    }),
  getMember: (actorId, memberId) =>
    execute(async () => {
      const [row] = await client.$queryRaw<MemberRow[]>`
        SELECT * FROM "admin_get_member"(${actorId}::uuid, ${memberId}::uuid)
      `
      return row ? toRecord(row) : null
    }),
  setRestriction: ({ actorId, memberId, expectedRowVersion, reason }) =>
    execute(async () => {
      const [row] = await client.$queryRaw<{ outcome: string }[]>`
        SELECT "admin_set_member_restriction"(
          ${actorId}::uuid, ${memberId}::uuid, ${expectedRowVersion}::int,
          ${reason !== null}::boolean, ${reason}::text
        ) AS "outcome"
      `
      const outcome = row?.outcome as AdminMemberRestrictionOutcome | undefined
      if (!outcome || !OUTCOMES.has(outcome)) {
        throw new Error('Unexpected member restriction outcome.')
      }
      return outcome
    })
})
