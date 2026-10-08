import {
  createAdapterFactory,
  type CleanedWhere,
  type CustomAdapter,
  type JoinConfig
} from 'better-auth/adapters'
import { z } from 'zod'
import type { PrismaClient } from '../generated/prisma/client.js'

interface ReauthenticationSessionRow {
  readonly id: string
  readonly expiresAt: Date
  readonly token: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly ipAddress: string | null
  readonly userAgent: string | null
  readonly userId: string
  readonly userName: string
  readonly userEmail: string
  readonly userEmailVerified: boolean
  readonly userImage: string | null
  readonly userCreatedAt: Date
  readonly userUpdatedAt: Date
  readonly userRole: 'USER' | 'ADMIN'
  readonly userTargetLevel: 'N5' | 'N4' | 'N3' | 'N2' | 'N1' | null
  readonly userAccountStatus: 'ACTIVE' | 'DELETION_PENDING' | 'DELETED'
  readonly userDeletedAt: Date | null
}

interface ReauthenticationAccountRow {
  readonly id: string
  readonly accountId: string
  readonly providerId: string
  readonly userId: string
  readonly password: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

interface ReauthenticationSubjectRow {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly emailVerified: boolean
  readonly image: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly role: 'USER' | 'ADMIN'
  readonly targetLevel: 'N5' | 'N4' | 'N3' | 'N2' | 'N1' | null
  readonly accountStatus: 'ACTIVE' | 'DELETION_PENDING' | 'DELETED'
  readonly deletedAt: Date | null
  readonly accountId: string
  readonly credentialAccountId: string
  readonly credentialProviderId: string
  readonly credentialPassword: string
  readonly accountCreatedAt: Date
  readonly accountUpdatedAt: Date
}

interface StagedSessionRow {
  readonly id: string
  readonly expiresAt: Date
  readonly token: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly ipAddress: string | null
  readonly userAgent: string | null
  readonly userId: string
}

const sessionCreateSchema = z
  .object({
    id: z.uuid(),
    expiresAt: z.date(),
    token: z.string().min(1).max(4_096),
    createdAt: z.date(),
    updatedAt: z.date(),
    ipAddress: z.string().max(512).nullish(),
    userAgent: z.string().max(512).nullish(),
    userId: z.uuid()
  })
  .strict()

const denied = (operation: string): never => {
  throw new Error(`Reauthentication adapter operation is denied: ${operation}`)
}

const equalityValue = (
  where: readonly CleanedWhere[],
  field: string
): CleanedWhere['value'] | undefined => {
  if (
    where.length !== 1 ||
    where[0]?.field !== field ||
    where[0].operator !== 'eq' ||
    where[0].connector !== 'AND' ||
    where[0].mode !== 'sensitive'
  ) {
    return undefined
  }
  return where[0].value
}

const hasOnlyKeys = (value: object, allowedKeys: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowedKeys.includes(key))

const hasExactJoin = ({
  expectedFrom,
  expectedLimit,
  expectedRelation,
  expectedTo,
  join,
  model
}: {
  expectedFrom: string
  expectedLimit: number
  expectedRelation: 'one-to-one' | 'one-to-many'
  expectedTo: string
  join: JoinConfig | undefined
  model: string
}): boolean => {
  if (
    join === undefined ||
    Object.keys(join).length !== 1 ||
    !Object.hasOwn(join, model)
  ) {
    return false
  }
  const descriptor = join[model]
  return (
    descriptor !== undefined &&
    hasOnlyKeys(descriptor, ['limit', 'on', 'relation']) &&
    descriptor.limit === expectedLimit &&
    descriptor.relation === expectedRelation &&
    hasOnlyKeys(descriptor.on, ['from', 'to']) &&
    descriptor.on.from === expectedFrom &&
    descriptor.on.to === expectedTo
  )
}

const accountProjection = (row: ReauthenticationAccountRow) => ({
  id: row.id,
  accountId: row.accountId,
  providerId: row.providerId,
  userId: row.userId,
  password: row.password,
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  scope: null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

export const createPhase7ReauthenticationCustomAdapter = ({
  client,
  getIntentId
}: {
  client: Pick<PrismaClient, '$queryRawUnsafe'>
  getIntentId: () => string
}): CustomAdapter => {
  const create: CustomAdapter['create'] = async (input) => {
    const { model, data, select } = input
    if (
      !hasOnlyKeys(input, ['data', 'model', 'select']) ||
      select !== undefined
    ) {
      return denied(`create:${model}:select-or-shape`)
    }
    if (model !== 'session') return denied(`create:${model}`)
    const parsed = sessionCreateSchema.safeParse(data)
    if (!parsed.success) {
      return denied(
        `create:session:shape:${Object.keys(data).sort().join(',')}`
      )
    }
    const rows = await client.$queryRawUnsafe<StagedSessionRow[]>(
      `SELECT * FROM "phase7_stage_reauthentication_session"(
        $1, $2, $3, $4, $5, $6, $7
      )`,
      getIntentId(),
      parsed.data.id,
      parsed.data.token,
      parsed.data.userId,
      parsed.data.expiresAt,
      parsed.data.ipAddress ?? '',
      parsed.data.userAgent ?? ''
    )
    if (rows.length !== 1) return denied('create:session:stale-intent')
    return rows[0]! as unknown as typeof data
  }

  const findOne: CustomAdapter['findOne'] = async (input) => {
    const { model, where, select, join } = input
    if (
      !hasOnlyKeys(input, ['join', 'model', 'select', 'where']) ||
      select !== undefined
    ) {
      return denied(`findOne:${model}:select-or-shape`)
    }
    const intentId = getIntentId()
    if (model === 'session') {
      const token = equalityValue(where, 'token')
      if (
        typeof token !== 'string' ||
        !hasExactJoin({
          expectedFrom: 'userId',
          expectedLimit: 1,
          expectedRelation: 'one-to-one',
          expectedTo: 'id',
          join,
          model: 'user'
        })
      ) {
        return denied('findOne:session:shape')
      }
      const rows = await client.$queryRawUnsafe<ReauthenticationSessionRow[]>(
        'SELECT * FROM "phase7_reauthentication_adapter_session"($1, $2)',
        intentId,
        token
      )
      if (rows.length > 1) return denied('findOne:session:cardinality')
      const row = rows[0]
      if (!row) return null
      return {
        id: row.id,
        expiresAt: row.expiresAt,
        token: row.token,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        userId: row.userId,
        user: {
          id: row.userId,
          name: row.userName,
          email: row.userEmail,
          emailVerified: row.userEmailVerified,
          image: row.userImage,
          createdAt: row.userCreatedAt,
          updatedAt: row.userUpdatedAt,
          role: row.userRole,
          targetLevel: row.userTargetLevel,
          accountStatus: row.userAccountStatus,
          deletedAt: row.userDeletedAt
        }
      } as never
    }
    if (model === 'user') {
      const email = equalityValue(where, 'email')
      if (
        typeof email !== 'string' ||
        !hasExactJoin({
          expectedFrom: 'id',
          expectedLimit: 100,
          expectedRelation: 'one-to-many',
          expectedTo: 'userId',
          join,
          model: 'account'
        })
      ) {
        return denied('findOne:user:shape')
      }
      const rows = await client.$queryRawUnsafe<ReauthenticationSubjectRow[]>(
        'SELECT * FROM "phase7_reauthentication_adapter_subject"($1, $2)',
        intentId,
        email
      )
      if (rows.length > 1) return denied('findOne:user:cardinality')
      const row = rows[0]
      if (!row) return null
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        emailVerified: row.emailVerified,
        image: row.image,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        role: row.role,
        targetLevel: row.targetLevel,
        accountStatus: row.accountStatus,
        deletedAt: row.deletedAt,
        account: [
          accountProjection({
            id: row.accountId,
            accountId: row.credentialAccountId,
            providerId: row.credentialProviderId,
            userId: row.id,
            password: row.credentialPassword,
            createdAt: row.accountCreatedAt,
            updatedAt: row.accountUpdatedAt
          })
        ]
      } as never
    }
    return denied(`findOne:${model}`)
  }

  const findMany: CustomAdapter['findMany'] = async (input) => {
    const { model, where, limit, select, join, sortBy, offset } = input
    if (
      !hasOnlyKeys(input, [
        'join',
        'limit',
        'model',
        'offset',
        'select',
        'sortBy',
        'where'
      ]) ||
      model !== 'account' ||
      limit !== 100 ||
      select !== undefined ||
      join !== undefined ||
      sortBy !== undefined ||
      offset !== undefined ||
      where === undefined
    ) {
      return denied(`findMany:${model}:shape`)
    }
    const userId = equalityValue(where, 'userId')
    if (typeof userId !== 'string') {
      return denied('findMany:account:where')
    }
    const rows = await client.$queryRawUnsafe<ReauthenticationAccountRow[]>(
      'SELECT * FROM "phase7_reauthentication_adapter_accounts"($1, $2)',
      getIntentId(),
      userId
    )
    if (rows.length > 1) return denied('findMany:account:cardinality')
    return rows.map(accountProjection) as never
  }

  return {
    create,
    findOne,
    findMany,
    update: async ({ model }) => denied(`update:${model}`),
    updateMany: async ({ model }) => denied(`updateMany:${model}`),
    delete: async ({ model }) => denied(`delete:${model}`),
    deleteMany: async ({ model }) => denied(`deleteMany:${model}`),
    count: async ({ model }) => denied(`count:${model}`)
  } satisfies CustomAdapter
}

export const createPhase7ReauthenticationAdapter = ({
  client,
  getIntentId
}: {
  client: Pick<PrismaClient, '$queryRawUnsafe'>
  getIntentId: () => string
}) =>
  createAdapterFactory({
    config: {
      adapterId: 'phase7-reauthentication',
      adapterName: 'Phase 7 owned reauthentication adapter',
      // The restricted facade accepts an explicit Better Auth UUID. It never
      // delegates identity generation to PostgreSQL.
      supportsUUIDs: false,
      supportsDates: true,
      supportsBooleans: true,
      transaction: false
    },
    adapter: () =>
      createPhase7ReauthenticationCustomAdapter({
        client,
        getIntentId
      })
  })
