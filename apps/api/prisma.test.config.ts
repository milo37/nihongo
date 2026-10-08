import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'
import { assertSafeTestDatabase } from './src/db/databaseTargetGuard.js'

const explicitTestDatabaseUrl = process.env.PRISMA_TEST_DATABASE_URL

dotenv.config({ path: '.env.test', override: true, quiet: true })

const databaseUrl = explicitTestDatabaseUrl ?? process.env.DATABASE_URL

assertSafeTestDatabase({
  nodeEnvironment: process.env.NODE_ENV,
  databaseUrl,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

if (!databaseUrl) {
  throw new Error('Test DATABASE_URL is required.')
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    url: databaseUrl
  }
})
