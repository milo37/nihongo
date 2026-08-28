import dotenv from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  assertSafeDevelopmentDatabase,
  assertSafePhase7MigrationDatabase,
  assertSafeTestDatabase
} from '../src/db/databaseTargetGuard.js'
import { PrismaClient } from '../src/generated/prisma/client.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../src/db/databaseOptions.js'
import { seedQuestionCatalog } from './seedQuestionCatalog.js'

const target = process.env.SEED_TARGET

if (target !== 'development' && target !== 'test') {
  throw new Error('SEED_TARGET must be development or test.')
}

dotenv.config({
  path: target === 'test' ? '.env.test' : '.env',
  override: false,
  quiet: true
})

const isTechnicalAdminCms = process.env.ADMIN_CMS_MODE === 'technical'
const databaseUrl = isTechnicalAdminCms
  ? process.env.PHASE7_MIGRATION_DATABASE_URL
  : target === 'test'
    ? (process.env.PRISMA_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
    : process.env.DATABASE_URL

if (isTechnicalAdminCms) {
  assertSafePhase7MigrationDatabase({
    nodeEnvironment: process.env.NODE_ENV,
    migrationDatabaseUrl: databaseUrl,
    runtimeDatabaseUrl: process.env.DATABASE_URL,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
} else if (target === 'test') {
  assertSafeTestDatabase({
    nodeEnvironment: process.env.NODE_ENV,
    databaseUrl,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
} else {
  assertSafeDevelopmentDatabase({
    nodeEnvironment: process.env.NODE_ENV,
    databaseUrl,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
}

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}

const connectionUrl = new URL(databaseUrl)
if (isTechnicalAdminCms) {
  connectionUrl.searchParams.delete('options')
}
const adapterConnectionString = connectionUrl.toString()
const schema = getPostgresSchema(adapterConnectionString)
const adapter = new PrismaPg(
  {
    connectionString: adapterConnectionString,
    options: createPostgresStartupOptions(
      schema,
      isTechnicalAdminCms ? 'nihongo_phase7_migration' : undefined
    )
  },
  schema ? { schema } : {}
)
const client = new PrismaClient({ adapter })

try {
  if (isTechnicalAdminCms) {
    const expectedSessionUser =
      target === 'test'
        ? 'nihongo_test_phase7_migration_login'
        : 'nihongo_development_phase7_migration_login'
    const roleEvidence = await client.$queryRawUnsafe<
      Array<{ currentRole: string; sessionUser: string }>
    >(
      `SELECT current_user AS "currentRole",
              session_user AS "sessionUser"`
    )

    if (
      roleEvidence.length !== 1 ||
      roleEvidence[0]?.sessionUser !== expectedSessionUser ||
      roleEvidence[0]?.currentRole !== 'nihongo_phase7_migration'
    ) {
      throw new Error('Phase 7 seed migration role attestation failed.')
    }
  }

  const result = isTechnicalAdminCms
    ? await client.$transaction(
        async (transaction) => {
          await transaction.$executeRawUnsafe(
            'SET LOCAL ROLE nihongo_phase7_owner'
          )
          const ownerEvidence = await transaction.$queryRawUnsafe<
            Array<{ currentRole: string; sessionUser: string }>
          >(
            `SELECT current_user AS "currentRole",
                    session_user AS "sessionUser"`
          )
          const expectedSessionUser =
            target === 'test'
              ? 'nihongo_test_phase7_migration_login'
              : 'nihongo_development_phase7_migration_login'
          if (
            ownerEvidence.length !== 1 ||
            ownerEvidence[0]?.sessionUser !== expectedSessionUser ||
            ownerEvidence[0]?.currentRole !== 'nihongo_phase7_owner'
          ) {
            throw new Error('Phase 7 seed owner role attestation failed.')
          }

          // The signed Phase 6 seed helper owns its inner transaction shape.
          // This facade makes that inner callback reuse the one explicit outer
          // transaction, so SET LOCAL authority cannot escape its boundary.
          const scopedSeedClient = new Proxy(transaction, {
            get(targetClient, property, receiver) {
              if (property === '$transaction') {
                return async (
                  callback: (
                    innerTransaction: typeof transaction
                  ) => Promise<unknown>
                ): Promise<unknown> => await callback(transaction)
              }
              return Reflect.get(targetClient, property, receiver)
            }
          }) as unknown as PrismaClient

          return await seedQuestionCatalog(scopedSeedClient)
        },
        { isolationLevel: 'Serializable' }
      )
    : await seedQuestionCatalog(client)

  if (isTechnicalAdminCms) {
    const restoredRole = await client.$queryRawUnsafe<
      Array<{ currentRole: string }>
    >(`SELECT current_user AS "currentRole"`)
    if (
      restoredRole.length !== 1 ||
      restoredRole[0]?.currentRole !== 'nihongo_phase7_migration'
    ) {
      throw new Error('Phase 7 seed role boundary did not close.')
    }
  }
  process.stdout.write(
    `Question catalog seed completed: ${result.insertedCount} inserted, ${result.verifiedCount} verified.\n`
  )
} finally {
  await client.$disconnect()
}
