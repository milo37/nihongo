import { describe, expect, it, vi } from 'vitest'
import {
  AdminMemberRepositoryUnavailableError,
  type AdminMemberRecord,
  type AdminMemberRepository
} from './adminMemberRepository.js'
import { createAdminMemberService } from './adminMemberService.js'

const actorId = '00000000-0000-4000-8000-0000000000aa'
const memberId = '00000000-0000-4000-8000-000000000001'
const record: AdminMemberRecord = {
  memberId,
  maskedEmail: 'mi****@e******.com',
  joinedAt: new Date('2026-11-01T00:00:00.000Z'),
  lastStudiedAt: null,
  solvedCount: 3,
  reportCount: 1,
  restrictedAt: null,
  restrictionReason: null,
  rowVersion: 1
}

const repositoryWith = (
  overrides: Partial<AdminMemberRepository>
): AdminMemberRepository => ({
  listMembers: vi.fn(async () => ({ items: [record], total: 1 })),
  getMember: vi.fn(async () => record),
  setRestriction: vi.fn(async () => 'OK' as const),
  ...overrides
})

describe('admin member service', () => {
  it('maps a restriction row to RESTRICTED with its time and reason', async () => {
    const restricted = {
      ...record,
      restrictedAt: new Date('2026-11-04T00:00:00.000Z'),
      restrictionReason: '사유',
      rowVersion: 2
    }
    const service = createAdminMemberService(
      repositoryWith({ getMember: vi.fn(async () => restricted) })
    )
    await expect(service.getMember(actorId, memberId)).resolves.toMatchObject({
      status: 'RESTRICTED',
      restrictedAt: '2026-11-04T00:00:00.000Z',
      restrictionReason: '사유',
      rowVersion: 2
    })
  })

  it('reports page 1 for an exact email lookup', async () => {
    const service = createAdminMemberService(repositoryWith({}))
    await expect(
      service.listMembers(actorId, {
        email: 'a@example.com',
        sort: 'joinedAt',
        order: 'desc',
        page: 3,
        pageSize: 25
      })
    ).resolves.toMatchObject({ page: 1, total: 1 })
  })

  it.each([
    ['NOT_FOUND', 'RESOURCE_NOT_FOUND'],
    ['VERSION_CONFLICT', 'VERSION_CONFLICT'],
    ['INVALID_STATE_TRANSITION', 'INVALID_STATE_TRANSITION']
  ] as const)('maps %s to %s', async (outcome, code) => {
    const service = createAdminMemberService(
      repositoryWith({ setRestriction: vi.fn(async () => outcome) })
    )
    await expect(
      service.restrict({
        actorId,
        memberId,
        expectedRowVersion: 1,
        reason: '사유'
      })
    ).rejects.toMatchObject({ code })
  })

  it('sends a null reason when releasing', async () => {
    const setRestriction = vi.fn(async () => 'OK' as const)
    const service = createAdminMemberService(repositoryWith({ setRestriction }))
    await service.releaseRestriction({
      actorId,
      memberId,
      expectedRowVersion: 2
    })
    expect(setRestriction).toHaveBeenCalledWith({
      actorId,
      memberId,
      expectedRowVersion: 2,
      reason: null
    })
  })

  it('turns an unavailable repository into SERVICE_UNAVAILABLE', async () => {
    const service = createAdminMemberService(
      repositoryWith({
        getMember: vi.fn(async () => {
          throw new AdminMemberRepositoryUnavailableError({ cause: 'down' })
        })
      })
    )
    await expect(service.getMember(actorId, memberId)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE'
    })
  })
})
