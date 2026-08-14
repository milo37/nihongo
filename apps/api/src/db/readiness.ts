import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ExpectedMigration {
  name: string
  checksum: string
}

export interface AppliedMigration {
  migrationName: string
  checksum: string
  finishedAt: Date | null
  rolledBackAt: Date | null
  logs: string | null
}

const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL('../../prisma/migrations/', import.meta.url)
)

const calculateChecksum = (sql: Buffer): string =>
  createHash('sha256').update(sql).digest('hex')

export const loadExpectedMigrationManifest = (
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY
): readonly ExpectedMigration[] => {
  const migrations = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      name: entry.name,
      checksum: calculateChecksum(
        readFileSync(join(migrationsDirectory, entry.name, 'migration.sql'))
      )
    }))

  if (migrations.length === 0) {
    throw new Error('Repository migration manifest is empty.')
  }

  return migrations
}

export const assertMigrationCompatibility = (
  expected: readonly ExpectedMigration[],
  applied: readonly AppliedMigration[]
): void => {
  const expectedByName = new Map(
    expected.map((migration) => [migration.name, migration])
  )
  const activeByName = new Map<string, AppliedMigration[]>()

  for (const migration of applied) {
    const hasFailureLogs =
      migration.logs !== null && migration.logs.trim().length > 0
    if (
      migration.rolledBackAt === null &&
      (migration.finishedAt === null || hasFailureLogs)
    ) {
      throw new Error('Database contains a pending or failed migration.')
    }

    if (migration.finishedAt === null || migration.rolledBackAt !== null) {
      continue
    }

    const active = activeByName.get(migration.migrationName) ?? []
    active.push(migration)
    activeByName.set(migration.migrationName, active)
  }

  if (activeByName.size !== expectedByName.size) {
    throw new Error('Database migration count does not match the repository.')
  }

  for (const [name, expectedMigration] of expectedByName) {
    const active = activeByName.get(name)

    if (
      active?.length !== 1 ||
      active[0]?.checksum !== expectedMigration.checksum
    ) {
      throw new Error('Database migration state is not compatible.')
    }
  }
}

export const createSingleFlightReadiness = (
  check: () => Promise<void>
): (() => Promise<void>) => {
  let inFlight: Promise<void> | undefined

  return () => {
    if (inFlight) {
      return inFlight
    }

    const checkPromise = Promise.resolve().then(check)
    const sharedPromise = checkPromise.finally(() => {
      if (inFlight === sharedPromise) {
        inFlight = undefined
      }
    })

    inFlight = sharedPromise
    return sharedPromise
  }
}
