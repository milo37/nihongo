import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

type UserReportKind = 'QUESTION' | 'APP_ERROR'
type UserReportStatus = 'RECEIVED' | 'ANSWERED' | 'CLOSED'

export interface UserReportRecord {
  readonly id: string
  readonly kind: UserReportKind
  readonly status: UserReportStatus
  readonly location: string
  readonly questionId: string | null
  readonly questionVersionId: string | null
  readonly description: string
  readonly reporterUserId: string | null
  readonly reporterReply: string | null
  readonly repliedAt: Date | null
  readonly internalNote: string | null
  readonly closedAt: Date | null
  readonly rowVersion: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

interface UserReportPage {
  readonly items: readonly UserReportRecord[]
  readonly total: number
}

interface CreateUserReportInput {
  readonly kind: UserReportKind
  readonly location: string
  readonly questionId: string | null
  readonly questionVersionId: string | null
  readonly description: string
  readonly reporterUserId: string
}

/** Admin commands; `null` note fields keep the stored value. */
export type UserReportCommand =
  | {
      readonly kind: 'REPLY_AND_CLOSE'
      readonly reporterReply: string
      readonly internalNote: string | null | undefined
    }
  | { readonly kind: 'SAVE_NOTE'; readonly internalNote: string | null }
  | {
      readonly kind: 'CLOSE'
      readonly internalNote: string | null | undefined
    }

export type UserReportCommandOutcome =
  | { readonly kind: 'UPDATED'; readonly record: UserReportRecord }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'VERSION_CONFLICT' }
  | { readonly kind: 'CLOSED' }

type CreateUserReportOutcome =
  | { readonly kind: 'CREATED'; readonly record: UserReportRecord }
  | { readonly kind: 'QUESTION_NOT_AVAILABLE' }
  | { readonly kind: 'DUPLICATE' }

export interface UserReportRepository {
  readonly create: (
    input: CreateUserReportInput
  ) => Promise<CreateUserReportOutcome>
  readonly listByReporter: (input: {
    readonly reporterUserId: string
    readonly page: number
    readonly pageSize: number
  }) => Promise<UserReportPage>
  readonly listForAdmin: (input: {
    readonly status: UserReportStatus | undefined
    readonly kind: UserReportKind | undefined
    readonly page: number
    readonly pageSize: number
  }) => Promise<UserReportPage>
  readonly get: (reportId: string) => Promise<UserReportRecord | null>
  readonly applyCommand: (input: {
    readonly reportId: string
    readonly expectedRowVersion: number
    readonly command: UserReportCommand
  }) => Promise<UserReportCommandOutcome>
}

export class UserReportRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('User report repository is unavailable.', options)
    this.name = 'UserReportRepositoryUnavailableError'
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
      throw new UserReportRepositoryUnavailableError({ cause: error })
    }
    throw error
  }
}

const COLUMNS = Prisma.sql`
  "id", "kind", "status", "location", "questionId", "questionVersionId",
  "description", "reporterUserId", "reporterReply", "repliedAt",
  "internalNote", "closedAt", "rowVersion", "createdAt", "updatedAt"`

interface PageRow extends UserReportRecord {
  readonly total: bigint
}

const toPage = (rows: readonly PageRow[]): UserReportPage => ({
  items: rows.map(({ total: _total, ...record }) => record),
  total: Number(rows[0]?.total ?? 0n)
})

const countRows = async (
  client: PrismaClient,
  filter: Prisma.Sql
): Promise<number> => {
  const [row] = await client.$queryRaw<{ total: bigint }[]>`
    SELECT COUNT(*) AS "total" FROM "UserReport" WHERE ${filter}`
  return Number(row?.total ?? 0n)
}

const readPage = async (
  client: PrismaClient,
  filter: Prisma.Sql,
  order: Prisma.Sql,
  page: number,
  pageSize: number
): Promise<UserReportPage> => {
  const rows = await client.$queryRaw<PageRow[]>`
    SELECT ${COLUMNS}, COUNT(*) OVER () AS "total"
    FROM "UserReport" WHERE ${filter}
    ORDER BY ${order}
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
  if (rows.length > 0) return toPage(rows)
  return { items: [], total: await countRows(client, filter) }
}

// Question reports may target any version learners could have seen.
const REPORTABLE_VERSION_STATUSES = ['PUBLISHED', 'RETIRED'] as const

// Raw queries surface PostgreSQL 23505 inside adapter metadata.
const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === 'P2002' ||
    /23505|UniqueConstraintViolation/u.test(JSON.stringify(error.meta ?? {})))

export const createPrismaUserReportRepository = (
  client: PrismaClient
): UserReportRepository => ({
  create: (input) =>
    execute(async () => {
      if (input.questionVersionId !== null) {
        const [version] = await client.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "QuestionVersion"
          WHERE "id" = ${input.questionVersionId}::uuid
            AND "questionId" = ${input.questionId}::uuid
            AND "status"::text IN (${Prisma.join(REPORTABLE_VERSION_STATUSES)})`
        if (!version) return { kind: 'QUESTION_NOT_AVAILABLE' }
      }
      try {
        const [record] = await client.$queryRaw<UserReportRecord[]>`
          INSERT INTO "UserReport" (
            "kind", "location", "questionId", "questionVersionId",
            "description", "reporterUserId"
          ) VALUES (
            ${input.kind}, ${input.location}, ${input.questionId}::uuid,
            ${input.questionVersionId}::uuid, ${input.description},
            ${input.reporterUserId}::uuid
          )
          RETURNING ${COLUMNS}`
        return { kind: 'CREATED', record: record! }
      } catch (error: unknown) {
        if (isUniqueViolation(error)) return { kind: 'DUPLICATE' }
        throw error
      }
    }),
  listByReporter: ({ reporterUserId, page, pageSize }) =>
    execute(() =>
      readPage(
        client,
        Prisma.sql`"reporterUserId" = ${reporterUserId}::uuid`,
        Prisma.sql`"createdAt" DESC, "id" DESC`,
        page,
        pageSize
      )
    ),
  listForAdmin: ({ status, kind, page, pageSize }) =>
    execute(() =>
      readPage(
        client,
        Prisma.sql`(${status ?? null}::text IS NULL OR "status" = ${status ?? null})
          AND (${kind ?? null}::text IS NULL OR "kind" = ${kind ?? null})`,
        Prisma.sql`("status" = 'RECEIVED') DESC, "createdAt" DESC, "id" DESC`,
        page,
        pageSize
      )
    ),
  get: (reportId) =>
    execute(async () => {
      const [record] = await client.$queryRaw<UserReportRecord[]>`
        SELECT ${COLUMNS} FROM "UserReport" WHERE "id" = ${reportId}::uuid`
      return record ?? null
    }),
  applyCommand: ({ reportId, expectedRowVersion, command }) =>
    execute(async () => {
      const keepNote = command.internalNote === undefined
      const note = command.internalNote ?? null
      const assignment =
        command.kind === 'SAVE_NOTE'
          ? Prisma.sql`"internalNote" = ${note}`
          : command.kind === 'REPLY_AND_CLOSE'
            ? Prisma.sql`"status" = 'ANSWERED',
                "reporterReply" = ${command.reporterReply},
                "repliedAt" = clock_timestamp(), "closedAt" = clock_timestamp(),
                "internalNote" = CASE WHEN ${keepNote} THEN "internalNote" ELSE ${note} END`
            : Prisma.sql`"status" = 'CLOSED', "closedAt" = clock_timestamp(),
                "internalNote" = CASE WHEN ${keepNote} THEN "internalNote" ELSE ${note} END`
      const [record] = await client.$queryRaw<UserReportRecord[]>`
        UPDATE "UserReport"
        SET ${assignment}, "rowVersion" = "rowVersion" + 1,
          "updatedAt" = clock_timestamp()
        WHERE "id" = ${reportId}::uuid
          AND "rowVersion" = ${expectedRowVersion}
          AND "status" = 'RECEIVED'
        RETURNING ${COLUMNS}`
      if (record) return { kind: 'UPDATED', record }
      const [current] = await client.$queryRaw<
        { status: UserReportStatus; rowVersion: number }[]
      >`SELECT "status", "rowVersion" FROM "UserReport" WHERE "id" = ${reportId}::uuid`
      if (!current) return { kind: 'NOT_FOUND' }
      if (current.status !== 'RECEIVED') return { kind: 'CLOSED' }
      return { kind: 'VERSION_CONFLICT' }
    })
})
