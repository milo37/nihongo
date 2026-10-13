import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'
import { assertSafePhase7MigrationDatabase } from './src/db/databaseTargetGuard.js'

dotenv.config({
  path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
  override: false,
  quiet: true
})

const databaseUrl = process.env.PHASE7_MIGRATION_DATABASE_URL

assertSafePhase7MigrationDatabase({
  nodeEnvironment: process.env.NODE_ENV,
  migrationDatabaseUrl: databaseUrl,
  runtimeDatabaseUrl: process.env.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

if (!databaseUrl) {
  throw new Error('PHASE7_MIGRATION_DATABASE_URL is required.')
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
