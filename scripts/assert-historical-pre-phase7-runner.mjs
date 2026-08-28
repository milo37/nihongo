import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PHASE7_MIGRATION_DIRECTORIES = Object.freeze([
  '20260827100000_phase7_admin_cms_enums',
  '20260827101000_phase7_admin_cms_foundation'
])

export const HISTORICAL_RUNNER_ERROR =
  'Historical Slice 2/3/5 runners are only valid on a pre-Phase 7 source ref. Use `pnpm test:phase7:db` for the current source.'

export const assertHistoricalPrePhase7Runner = (migrationsDirectory) => {
  const phase7Migrations = PHASE7_MIGRATION_DIRECTORIES.filter(
    (directoryName) => existsSync(path.join(migrationsDirectory, directoryName))
  )

  if (phase7Migrations.length > 0) {
    throw new Error(
      `${HISTORICAL_RUNNER_ERROR} Found: ${phase7Migrations.join(', ')}.`
    )
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isDirectExecution) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  )
  assertHistoricalPrePhase7Runner(
    path.join(repositoryRoot, 'apps/api/prisma/migrations')
  )
}
