import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Prisma } from '../generated/prisma/client.js'
import {
  assertMigrationCompatibility,
  createSingleFlightReadiness,
  loadExpectedMigrationManifest,
  selectExpectedMigrationManifest,
  type MigrationCompatibilityProfile,
  type AppliedMigration
} from './readiness.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from './databaseOptions.js'
import { checkPracticeCompatibilityFence } from './practiceCompatibilityFence.js'

export interface DatabaseRuntime {
  client: PrismaClient
  checkReadiness: () => Promise<void>
  checkV1Compatibility: () => Promise<void>
  disconnect: () => Promise<void>
}

export interface RoleDatabaseRuntime {
  client: PrismaClient
  disconnect: () => Promise<void>
}

interface CreateDatabaseRuntimeOptions {
  readonly migrationProfile?: MigrationCompatibilityProfile
  readonly startupRole?: 'nihongo_app' | 'nihongo_auth_gateway'
}

export const selectDatabaseGlobalOmit = (
  migrationProfile?: MigrationCompatibilityProfile
): Prisma.GlobalOmitConfig | undefined =>
  migrationProfile === 'pre-phase7'
    ? {
        question: {
          createdByActorId: true,
          createdByRoleSnapshot: true,
          rowVersion: true
        },
        questionVersion: {
          contentFingerprint: true,
          createdByActorId: true,
          createdByRoleSnapshot: true,
          retirementKind: true
        },
        questionVersionTag: { normalizedNameSnapshot: true },
        session: {
          authorityGeneration: true,
          authorizationState: true,
          issuerProtocolVersion: true,
          sessionFamilyId: true
        },
        user: { authorityGeneration: true },
        verification: {
          capturedGeneration: true,
          purpose: true,
          resetUserId: true,
          tokenSelector: true
        }
      }
    : undefined

const createPrismaClient = (
  connectionString: string,
  { migrationProfile, startupRole }: CreateDatabaseRuntimeOptions = {}
): PrismaClient => {
  const schema = getPostgresSchema(connectionString)
  const adapter = new PrismaPg(
    {
      connectionString,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 30_000,
      max: startupRole === 'nihongo_auth_gateway' ? 5 : 10,
      options: createPostgresStartupOptions(schema, startupRole),
      query_timeout: 2_500,
      statement_timeout: 2_500
    },
    schema ? { schema } : {}
  )

  const omit = selectDatabaseGlobalOmit(migrationProfile)
  return new PrismaClient({ adapter, ...(omit ? { omit } : {}) })
}

export const createRoleDatabaseRuntime = (
  connectionString: string,
  startupRole: 'nihongo_app' | 'nihongo_auth_gateway'
): RoleDatabaseRuntime => {
  const client = createPrismaClient(connectionString, { startupRole })
  return {
    client,
    disconnect: () => client.$disconnect()
  }
}

export const createDatabaseRuntime = (
  connectionString: string,
  options: CreateDatabaseRuntimeOptions = {}
): DatabaseRuntime => {
  const expectedMigrations = selectExpectedMigrationManifest(
    loadExpectedMigrationManifest(),
    options.migrationProfile ?? 'current'
  )
  const prisma = createPrismaClient(connectionString, options)
  const checkReadiness = createSingleFlightReadiness(async () => {
    await prisma.$queryRaw`SELECT 1`

    const appliedMigrations = await prisma.$queryRaw<AppliedMigration[]>`
      SELECT
        migration_name AS "migrationName",
        checksum,
        finished_at AS "finishedAt",
        rolled_back_at AS "rolledBackAt",
        logs
      FROM "_prisma_migrations"
      ORDER BY started_at`

    assertMigrationCompatibility(expectedMigrations, appliedMigrations)
  })

  return {
    client: prisma,
    checkReadiness,
    checkV1Compatibility: () => checkPracticeCompatibilityFence(prisma),
    disconnect: () => prisma.$disconnect()
  }
}
