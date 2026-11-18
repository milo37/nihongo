import { readFileSync } from 'node:fs'
import { z } from 'zod'

/**
 * #674: the one pinned list of repository migrations, in order, with the
 * SHA-256 of each migration.sql (Prisma's checksum). Checks that used to pin
 * the list, its count or its digest in several files read it from here; a
 * new migration adds one entry (migrationManifest.test.ts names the value).
 */
export const PINNED_MIGRATIONS = z
  .object({
    migrations: z
      .array(
        z
          .object({
            name: z.string().regex(/^\d{14}_[a-z0-9_]+$/u),
            checksum: z.string().regex(/^[0-9a-f]{64}$/u)
          })
          .strict()
      )
      .min(1)
  })
  .strict()
  .parse(
    JSON.parse(
      readFileSync(
        new URL('../../prisma/migration-manifest.json', import.meta.url),
        'utf8'
      )
    )
  ).migrations

export const PINNED_MIGRATION_NAMES = PINNED_MIGRATIONS.map(({ name }) => name)
