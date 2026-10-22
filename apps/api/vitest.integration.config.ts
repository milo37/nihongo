import dotenv from 'dotenv'
import { defineConfig } from 'vitest/config'

const explicitTestDatabaseUrl = process.env.PRISMA_TEST_DATABASE_URL

dotenv.config({ path: '.env.test', override: true, quiet: true })

if (explicitTestDatabaseUrl) {
  process.env.DATABASE_URL = explicitTestDatabaseUrl
}

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    fileParallelism: false,
    restoreMocks: true
  }
})
