import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  assertStudyGuestCleanupRole,
  verifyStudyGuestCleanupRole,
  type GuestCleanupRoleEvidence
} from './studyGuestCleanupRole.js'

const isolated: GuestCleanupRoleEvidence = {
  currentRole: 'nihongo_app',
  workerIsSuperuser: false,
  workerCanBypassRls: false,
  workerCanCreateRoles: false,
  workerCanCreateDatabases: false,
  sessionIsSuperuser: false,
  sessionCanBypassRls: false,
  sessionCanCreateRoles: false,
  sessionCanCreateDatabases: false,
  sessionHasApplicationRole: true,
  workerCanCreateInSchema: false,
  sessionCanCreateInSchema: false
}

describe('guest cleanup role', () => {
  it('accepts only the isolated application role', () => {
    expect(() => assertStudyGuestCleanupRole(isolated)).not.toThrow()
  })

  it('checks the live database role evidence and fails closed on missing rows', async () => {
    const query = vi.fn().mockResolvedValue([])
    const client = { $queryRaw: query } as unknown as Pick<
      PrismaClient,
      '$queryRaw'
    >
    await expect(verifyStudyGuestCleanupRole(client)).rejects.toThrow()
    query.mockResolvedValue([isolated])
    await expect(verifyStudyGuestCleanupRole(client)).resolves.toBeUndefined()
    query.mockResolvedValue([{ ...isolated, sessionHasApplicationRole: false }])
    await expect(verifyStudyGuestCleanupRole(client)).rejects.toThrow()
  })

  it.each([
    { currentRole: 'nihongo_guest_cleanup_worker' },
    { workerIsSuperuser: true },
    { workerCanBypassRls: true },
    { workerCanCreateRoles: true },
    { workerCanCreateDatabases: true },
    { sessionIsSuperuser: true },
    { sessionCanBypassRls: true },
    { sessionCanCreateRoles: true },
    { sessionCanCreateDatabases: true },
    { sessionHasApplicationRole: false },
    { workerCanCreateInSchema: true },
    { sessionCanCreateInSchema: true }
  ])('refuses an unsafe role: %o', (change) => {
    expect(() =>
      assertStudyGuestCleanupRole({ ...isolated, ...change })
    ).toThrow()
  })
})
