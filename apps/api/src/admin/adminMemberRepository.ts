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

/** Only the masked email ever leaves this repository. */
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

interface MemberRow extends Omit<AdminMemberRecord, 'maskedEmail'> {
  readonly email: string
  readonly total?: bigint
}

/** `minsu1@example.com` -> `mi****@e******.com`. */
export const maskMemberEmail = (address: string): string => {
  const chars = Array.from(address)
  const at = chars.lastIndexOf('@')
  const local = at < 0 ? chars : chars.slice(0, at)
  const domain = at < 0 ? [] : chars.slice(at + 1)
  const dot = domain.lastIndexOf('.')
  const host = dot > 0 ? domain.slice(0, dot) : domain
  const suffix = dot > 0 ? domain.slice(dot).join('') : ''
  const mask = (part: readonly string[], keep: number): string => {
    const shown = Math.min(keep, Math.max(part.length - 1, 0))
    return part.slice(0, shown).join('') + '*'.repeat(part.length - shown)
  }
  return `${mask(local, 2)}@${mask(host, 1)}${suffix}`
}

const toRecord = ({
  email,
  total: _total,
  ...row
}: MemberRow): AdminMemberRecord => ({
  ...row,
  maskedEmail: maskMemberEmail(email)
})

const OUTCOMES = new Set<AdminMemberRestrictionOutcome>([
  'OK',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'INVALID_STATE_TRANSITION'
])

const SORT_COLUMNS: Record<ParsedListAdminMembersQuery['sort'], string> = {
  joinedAt: 'member."joinedAt"',
  lastStudiedAt: 'member."lastStudiedAt"',
  solvedCount: 'member."solvedCount"',
  reportCount: 'member."reportCount"',
  status: '(member."restrictedAt" IS NOT NULL)'
}

type Queryable = Pick<PrismaClient, '$queryRaw' | 'user'>

const assertActiveAdministrator = async (
  client: Queryable,
  actorId: string
): Promise<void> => {
  const actor = await client.user.findFirst({
    where: {
      id: actorId,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      deletedAt: null
    },
    select: { id: true }
  })
  if (!actor) {
    throw new Error('Member console actor is not an active administrator.')
  }
}

// Learner accounts that still exist; administrators are not members.
const selectMembers = (
  client: Queryable,
  filter: Prisma.Sql,
  tail: Prisma.Sql
): Promise<MemberRow[]> => client.$queryRaw<MemberRow[]>`
  WITH member AS (
    SELECT
      u."id" AS "memberId",
      u."email" AS "email",
      u."createdAt" AS "joinedAt",
      study.last_studied_at AS "lastStudiedAt",
      COALESCE(study.solved_count, 0)::INTEGER AS "solvedCount",
      (
        (SELECT COUNT(*) FROM "QuestionReport" AS report
          WHERE report."reporterUserId" = u."id")
        + (SELECT COUNT(*) FROM "UserReport" AS report
          WHERE report."reporterUserId" = u."id")
      )::INTEGER AS "reportCount",
      restriction."restrictedAt" AS "restrictedAt",
      restriction."reason" AS "restrictionReason",
      (1 + (SELECT COUNT(*) FROM "UserAccountRestrictionEvent" AS event
        WHERE event."userId" = u."id"))::INTEGER AS "rowVersion"
    FROM "User" AS u
    LEFT JOIN "UserAccountRestriction" AS restriction
      ON restriction."userId" = u."id"
    LEFT JOIN LATERAL (
      SELECT MAX(answer."answeredAt") AS last_studied_at,
        COUNT(*) AS solved_count
      FROM "StudySession" AS session
      JOIN "StudySessionQuestion" AS item
        ON item."studySessionId" = session."id"
      JOIN "StudyAnswer" AS answer
        ON answer."studySessionQuestionId" = item."id"
      WHERE session."userId" = u."id"
    ) AS study ON TRUE
    WHERE u."role" = 'USER'
      AND u."deletedAt" IS NULL
      AND u."accountStatus" <> 'DELETED'
      AND ${filter}
  )
  SELECT member.*, COUNT(*) OVER () AS "total"
  FROM member
  ${tail}
`

const listPage = (
  client: Queryable,
  email: string | null,
  query: ParsedListAdminMembersQuery,
  pageSize: number,
  offset: number
): Promise<MemberRow[]> => {
  const direction = query.order === 'desc' ? 'DESC' : 'ASC'
  const nulls = query.sort === 'lastStudiedAt' ? ' NULLS LAST' : ''
  return selectMembers(
    client,
    email === null ? Prisma.sql`TRUE` : Prisma.sql`u."email" = ${email}`,
    Prisma.sql`ORDER BY ${Prisma.raw(
      `${SORT_COLUMNS[query.sort]} ${direction}${nulls}`
    )}, member."memberId" ASC
      LIMIT ${pageSize} OFFSET ${offset}`
  )
}

export const createPrismaAdminMemberRepository = (
  client: PrismaClient
): AdminMemberRepository => ({
  listMembers: (actorId, query) =>
    execute(async () => {
      await assertActiveAdministrator(client, actorId)
      const byEmail = query.email !== undefined
      const pageSize = byEmail ? 1 : query.pageSize
      const offset = byEmail ? 0 : (query.page - 1) * query.pageSize
      const rows = await listPage(
        client,
        query.email ?? null,
        query,
        pageSize,
        offset
      )
      if (rows.length > 0 || byEmail) {
        return {
          items: rows.map(toRecord),
          total: Number(rows[0]?.total ?? 0n)
        }
      }
      // An out-of-range page still reports the real total.
      const [first] = await listPage(client, null, query, 1, 0)
      return { items: [], total: Number(first?.total ?? 0n) }
    }),
  getMember: (actorId, memberId) =>
    execute(async () => {
      await assertActiveAdministrator(client, actorId)
      const [row] = await selectMembers(
        client,
        Prisma.sql`u."id" = ${memberId}::uuid`,
        Prisma.empty
      )
      return row ? toRecord(row) : null
    }),
  setRestriction: ({ actorId, memberId, expectedRowVersion, reason }) =>
    execute(() =>
      client.$transaction(async (transaction) => {
        await assertActiveAdministrator(transaction, actorId)
        // Serializes concurrent commands for one member.
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtext(${memberId}))::text
        `
        const member = await transaction.user.findFirst({
          where: {
            id: memberId,
            role: 'USER',
            deletedAt: null,
            accountStatus: { not: 'DELETED' }
          },
          select: { id: true }
        })
        if (!member) return 'NOT_FOUND'
        const events = await transaction.userAccountRestrictionEvent.count({
          where: { userId: memberId }
        })
        if (1 + events !== expectedRowVersion) return 'VERSION_CONFLICT'
        const restricted =
          (await transaction.userAccountRestriction.count({
            where: { userId: memberId }
          })) > 0
        if ((reason !== null) === restricted) {
          return 'INVALID_STATE_TRANSITION'
        }
        if (reason === null) {
          await transaction.userAccountRestriction.delete({
            where: { userId: memberId }
          })
        } else {
          await transaction.userAccountRestriction.create({
            data: { userId: memberId, reason }
          })
        }
        await transaction.userAccountRestrictionEvent.create({
          data: {
            userId: memberId,
            action: reason === null ? 'RELEASE' : 'RESTRICT',
            actorUserId: actorId,
            reason
          },
          select: { id: true }
        })
        return 'OK' as const
      })
    ).then((outcome) => {
      if (!OUTCOMES.has(outcome)) {
        throw new Error('Unexpected member restriction outcome.')
      }
      return outcome
    })
})
