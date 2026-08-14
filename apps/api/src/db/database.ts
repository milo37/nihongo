import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import {
  assertMigrationCompatibility,
  createSingleFlightReadiness,
  loadExpectedMigrationManifest,
  type AppliedMigration
} from './readiness.js'
import { getPostgresSchema } from './databaseOptions.js'

export interface DatabaseRuntime {
  client: PrismaClient
  checkReadiness: () => Promise<void>
  disconnect: () => Promise<void>
}

export const createDatabaseRuntime = (
  connectionString: string
): DatabaseRuntime => {
  const expectedMigrations = loadExpectedMigrationManifest()
  const schema = getPostgresSchema(connectionString)
  const adapter = new PrismaPg(
    {
      connectionString,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 30_000,
      max: 10,
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
      query_timeout: 2_500,
      statement_timeout: 2_500
    },
    schema ? { schema } : {}
  )
  const prisma = new PrismaClient({ adapter })
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
    disconnect: () => prisma.$disconnect()
  }
}
