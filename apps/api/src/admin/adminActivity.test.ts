import { describe, expect, it, vi } from 'vitest'
import {
  ADMIN_ACTIVITY_COMMANDS,
  ADMIN_ACTIVITY_RETENTION_MS,
  toAdminActivityItem
} from './adminActivity.js'
import type {
  AdminAuditRecord,
  AdminQuestionRepository
} from './adminQuestionRepository.js'
import { createAdminQuestionService } from './adminQuestionService.js'

const now = new Date('2026-11-03T00:00:00.000Z')
const record = (
  overrides: Partial<AdminAuditRecord> & Pick<AdminAuditRecord, 'id'>
): AdminAuditRecord =>
  ({
    command: 'PUBLICATION',
    targetType: 'QUESTION_VERSION',
    targetId: '33333333-3333-4333-8333-333333333333',
    occurredAt: new Date('2026-11-02T00:00:00.000Z'),
    ...overrides
  }) as AdminAuditRecord

describe('admin activity log', () => {
  it('maps commands to the six reduced actions only', () => {
    expect(
      toAdminActivityItem(record({ id: 'a', command: 'QUESTION_ARCHIVE' }))
        .action
    ).toBe('DELETE_OR_ARCHIVE')
    expect(
      toAdminActivityItem(record({ id: 'a', command: 'IMPORT_APPLY' })).action
    ).toBe('UPDATE')
    expect(() =>
      toAdminActivityItem(record({ id: 'a', command: 'APPROVAL' }))
    ).toThrow('outside the activity log')
  })

  it('never exposes an admin session id', () => {
    const item = toAdminActivityItem(
      record({
        id: 'a',
        command: 'REAUTHENTICATION',
        targetType: 'ADMIN_SESSION'
      })
    )
    expect(item).toEqual({
      occurredAt: '2026-11-02T00:00:00.000Z',
      action: 'ADMIN_SIGN_IN',
      targetLabel: '관리자 로그인',
      targetId: null,
      result: 'SUCCESS'
    })
  })

  it('reads one year of mapped commands and pages with a cursor', async () => {
    const listAuditLog = vi.fn(async () => [
      record({ id: '11111111-1111-4111-8111-111111111111' }),
      record({ id: '22222222-2222-4222-8222-222222222222' })
    ])
    const service = createAdminQuestionService(
      { listAuditLog } as unknown as AdminQuestionRepository,
      () => now
    )
    const page = await service.listActivity({ limit: 1 })
    expect(listAuditLog).toHaveBeenCalledWith({
      commands: ADMIN_ACTIVITY_COMMANDS,
      occurredFrom: new Date(now.getTime() - ADMIN_ACTIVITY_RETENTION_MS),
      limit: 1
    })
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).not.toBeNull()
  })
})

describe('admin console route gate', () => {
  it('admits only the canonical GET activity log path', async () => {
    const { isCanonicalAdminConsoleReadRequest } = await import(
      '../app/protectedRouteExclusion.js'
    )
    const admitted = (method: string, requestTarget: string) =>
      isCanonicalAdminConsoleReadRequest({ method, requestTarget })
    expect(admitted('GET', '/api/v1/admin/activity-log?limit=20')).toBe(true)
    expect(admitted('POST', '/api/v1/admin/activity-log')).toBe(false)
    expect(admitted('GET', '/api/v1/admin/activity-log/x')).toBe(false)
    expect(admitted('GET', '/api/v1/admin/%61ctivity-log')).toBe(false)
  })
})
