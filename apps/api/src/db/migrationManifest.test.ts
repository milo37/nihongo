import { describe, expect, it } from 'vitest'
import { PINNED_MIGRATIONS } from './migrationManifest.js'
import { loadExpectedMigrationManifest } from './readiness.js'

describe('#674 pinned migration manifest', () => {
  it('matches every migration directory, its order and its checksum', () => {
    // A new or changed migration: add or fix its entry in
    // apps/api/prisma/migration-manifest.json with the values below.
    expect(loadExpectedMigrationManifest()).toEqual(PINNED_MIGRATIONS)
  })
})
