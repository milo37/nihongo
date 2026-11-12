import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createJsonLogger } from '../observability/logger.js'
import { requestSsoAccountErasure } from './accountErasureAuthority.js'
import { createSsoAccountRepository } from './ssoAccountRepository.js'

vi.mock('./accountErasureAuthority.js', async (original) => ({
  ...(await original<typeof import('./accountErasureAuthority.js')>()),
  requestSsoAccountErasure: vi.fn()
}))

const USER_ID = '00000000-0000-4000-8000-000000000001'
const request = vi.mocked(requestSsoAccountErasure)
const client = {} as Parameters<typeof createSsoAccountRepository>[0]

beforeEach(() => {
  request.mockReset()
})

describe('erasure request log (#669)', () => {
  it('reports the User id once the request is accepted', async () => {
    request.mockResolvedValue({
      appStatus: 'DELETION_PENDING',
      deletionScheduledAt: '2026-11-19T10:00:00.000Z',
      providerCleanup: [{ provider: 'google', status: 'PENDING' }],
      userId: USER_ID
    })
    const requested = vi.fn()
    const repo = createSsoAccountRepository(client, requested)
    await expect(
      repo.requestErasure('private', 'proof', 'd'.repeat(64))
    ).resolves.toEqual({
      appStatus: 'DELETION_PENDING',
      deletionScheduledAt: '2026-11-19T10:00:00.000Z',
      providerCleanup: [{ provider: 'google', status: 'PENDING' }]
    })
    expect(requested).toHaveBeenCalledExactlyOnceWith(USER_ID)
  })

  it('reports nothing when the request is refused', async () => {
    request.mockResolvedValue({ code: 'SSO_FRESH_REQUIRED' })
    const requested = vi.fn()
    const repo = createSsoAccountRepository(client, requested)
    await expect(
      repo.requestErasure('private', null, 'd'.repeat(64))
    ).resolves.toEqual({ code: 'SSO_FRESH_REQUIRED' })
    expect(requested).not.toHaveBeenCalled()
  })

  it('writes the User id and time and drops anything else', () => {
    const lines: string[] = []
    const logger = createJsonLogger('info', (line) => lines.push(line))
    logger.info('auth.account_erasure.requested', {
      userId: USER_ID,
      occurredAt: '2026-11-07T00:00:00.000Z'
    })
    logger.info('auth.account_erasure.requested', {
      userId: USER_ID,
      occurredAt: '2026-11-07T00:00:00.000Z',
      email: 'learner@example.com'
    })
    logger.info('auth.account_erasure.requested', {
      userId: 'learner@example.com',
      occurredAt: '2026-11-07T00:00:00.000Z'
    })
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'info',
      event: 'auth.account_erasure.requested',
      userId: USER_ID,
      occurredAt: '2026-11-07T00:00:00.000Z'
    })
  })
})
