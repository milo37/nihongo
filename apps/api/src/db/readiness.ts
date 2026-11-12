import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface ExpectedMigration {
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
// #504 P8-1: one profile since the baseline; the legacy pre-baseline schema
// is gone.
export type MigrationCompatibilityProfile = 'current'

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

const compareMigrationNames = (left: string, right: string): number =>
  left.localeCompare(right)

/**
 * The database must hold every repository migration, in the same order with
 * the same checksum. JLP-857: it may also hold newer migrations after them, so
 * the previous image still becomes ready after deploy.sh rolls the image back
 * and keeps the migration a release applied. A missing, reordered, renamed or
 * changed migration still fails closed.
 */
export const assertMigrationCompatibility = (
  expected: readonly ExpectedMigration[],
  applied: readonly AppliedMigration[]
): void => {
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

  if (activeByName.size < expected.length) {
    throw new Error('Database migration count does not match the repository.')
  }

  const activeNames = [...activeByName.keys()].toSorted(compareMigrationNames)
  const expectedNames = expected
    .map(({ name }) => name)
    .toSorted(compareMigrationNames)

  expectedNames.forEach((name, index) => {
    const active = activeByName.get(name)
    const expectedMigration = expected.find(
      (migration) => migration.name === name
    )

    if (
      activeNames[index] !== name ||
      active?.length !== 1 ||
      active[0]?.checksum !== expectedMigration?.checksum
    ) {
      throw new Error('Database migration state is not compatible.')
    }
  })

  for (const name of activeNames.slice(expectedNames.length)) {
    if (activeByName.get(name)?.length !== 1) {
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
