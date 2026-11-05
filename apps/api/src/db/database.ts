import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import {
  assertMigrationCompatibility,
  createSingleFlightReadiness,
  loadExpectedMigrationManifest,
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
  readonly startupRole?:
    | 'nihongo_app'
    | 'nihongo_guest_cleanup_worker'
  /** Test fixture population only; request paths keep the 2.5s default. */
  readonly statementTimeoutMs?: number
}

const createPrismaClient = (
  connectionString: string,
  {
    startupRole,
    statementTimeoutMs = 2_500
  }: CreateDatabaseRuntimeOptions = {}
): PrismaClient => {
  const schema = getPostgresSchema(connectionString)
  const adapter = new PrismaPg(
    {
      connectionString,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 30_000,
      max: 10,
      options: createPostgresStartupOptions(schema, startupRole),
      query_timeout: statementTimeoutMs,
      statement_timeout: statementTimeoutMs
    },
    schema ? { schema } : {}
  )

  return new PrismaClient({ adapter })
}

export const createRoleDatabaseRuntime = (
  connectionString: string,
  startupRole:
    | 'nihongo_app'
    | 'nihongo_guest_cleanup_worker'
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
  const expectedMigrations = loadExpectedMigrationManifest()
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
