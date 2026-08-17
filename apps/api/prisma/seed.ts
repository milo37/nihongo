import dotenv from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  assertSafeDevelopmentDatabase,
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

const databaseUrl =
  target === 'test'
    ? (process.env.PRISMA_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
    : process.env.DATABASE_URL

if (target === 'test') {
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

const schema = getPostgresSchema(databaseUrl)
const adapter = new PrismaPg(
  {
    connectionString: databaseUrl,
    options: createPostgresStartupOptions(schema)
  },
  schema ? { schema } : {}
)
const client = new PrismaClient({ adapter })

try {
  const result = await seedQuestionCatalog(client)
  process.stdout.write(
    `Question catalog seed completed: ${result.insertedCount} inserted, ${result.verifiedCount} verified.\n`
  )
} finally {
  await client.$disconnect()
}
