import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'

dotenv.config({ path: '.env', quiet: true })

// Code generation and static schema validation must not require a migration
// credential. Every command that can write migrations uses an explicit guarded
// config instead of this non-operational fallback.
const generationDatabaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://prisma_codegen:invalid@127.0.0.1:1/nihongo_codegen?schema=public'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    url: generationDatabaseUrl
  }
})
