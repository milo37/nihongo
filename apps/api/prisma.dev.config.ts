import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'
import { assertSafeDevelopmentDatabase } from './src/db/databaseTargetGuard.js'

dotenv.config({ path: '.env', quiet: true })

const databaseUrl = process.env.DATABASE_URL
assertSafeDevelopmentDatabase({
  nodeEnvironment: process.env.NODE_ENV,
  databaseUrl,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

if (!databaseUrl) {
  throw new Error('Development DATABASE_URL is required.')
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
