import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  assertPhase7ApiDatabaseBoundaryPreflight,
  type Phase7ApiBootstrapIdentity,
  type Phase7ApiDatabaseSnapshotIdentity
} from './phase7ApiDatabaseBoundary.js'

const safeBootstrap = {
  canCreateDatabase: true,
  canCreateRole: true,
  canSetOwner: true,
  currentUser: 'nihongo',
  isSuperuser: true,
  sessionUser: 'nihongo'
} satisfies Phase7ApiBootstrapIdentity

const safeSnapshot = {
  acl: [
    {
      grantor: 'nihongo'
    }
  ],
  ownerName: 'nihongo'
} satisfies Phase7ApiDatabaseSnapshotIdentity

describe('Phase 7 API database boundary preflight', () => {
  it('owner가 재현 가능한 expanded ACL만 mutation 전에 허용한다', () => {
    expect(() =>
      assertPhase7ApiDatabaseBoundaryPreflight({
        bootstrap: safeBootstrap,
        snapshot: safeSnapshot
      })
    ).not.toThrow()
  })

  it('unsupported grantor fixture는 owner/ACL mutation을 시작하지 않는다', () => {
    const mutateDatabaseBoundary = vi.fn()
    const unsupportedSnapshot = {
      ...safeSnapshot,
      acl: [...safeSnapshot.acl, { grantor: 'independent_grantor' }]
    }

    expect(() => {
      assertPhase7ApiDatabaseBoundaryPreflight({
        bootstrap: safeBootstrap,
        snapshot: unsupportedSnapshot
      })
      mutateDatabaseBoundary()
    }).toThrow('Phase 7 API bootstrap database is not attested.')
    expect(mutateDatabaseBoundary).not.toHaveBeenCalled()
    expect(unsupportedSnapshot).toEqual({
      acl: [{ grantor: 'nihongo' }, { grantor: 'independent_grantor' }],
      ownerName: 'nihongo'
    })
  })

  it.each([
    { canSetOwner: false },
    { currentUser: 'other' },
    { isSuperuser: false }
  ])('unsafe bootstrap identity %j를 거부한다', (override) => {
    expect(() =>
      assertPhase7ApiDatabaseBoundaryPreflight({
        bootstrap: { ...safeBootstrap, ...override },
        snapshot: safeSnapshot
      })
    ).toThrow('Phase 7 API bootstrap database is not attested.')
  })

  it('runner가 snapshot preflight를 첫 cluster mutation보다 먼저 실행한다', () => {
    const runner = readFileSync(
      fileURLToPath(new URL('./runPhase7ApiIntegration.ts', import.meta.url)),
      'utf8'
    )
    const snapshotIndex = runner.indexOf(
      'databaseSnapshot = await readDatabaseSnapshot()'
    )
    const attestationIndex = runner.indexOf('await attestBootstrap()')
    const provisionIndex = runner.indexOf('await provisionRoles()')
    const extensionIndex = runner.indexOf('await ensurePgcrypto()')
    const databaseMutationIndex = runner.indexOf(
      'await applyMigrationDatabaseBoundary()'
    )

    expect(snapshotIndex).toBeGreaterThanOrEqual(0)
    expect(attestationIndex).toBeGreaterThan(snapshotIndex)
    expect(provisionIndex).toBeGreaterThan(attestationIndex)
    expect(extensionIndex).toBeGreaterThan(attestationIndex)
    expect(databaseMutationIndex).toBeGreaterThan(attestationIndex)
  })
})
