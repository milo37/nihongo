import { MockSsoAccountRepository } from '@mocks/repository/ssoAccountRepository'
import { mockDatabase } from '@mocks/repository/mockDatabase'
describe('Mock 계정 repository 소유 경계', () => {
  it('타인 신원·generation 변경·재사용을 거부한다', () => {
    const actor = mockDatabase.loginAs('USER')
    const repository = new MockSsoAccountRepository(
      () => actor,
      () => {}
    )
    const fresh = {
      purpose: 'ACCOUNT_FRESH' as const,
      provider: 'google' as const
    }
    repository.prepare(fresh)
    expect(() => repository.complete(fresh, 'synthetic-other-owner')).toThrow()
    expect(repository.capabilities().freshVerified).toBe(false)
    repository.prepare(fresh)
    repository.clearProof()
    expect(() => repository.complete(fresh, actor.id)).toThrow()
    repository.prepare(fresh)
    repository.complete(fresh, actor.id)
    expect(() => repository.complete(fresh, actor.id)).toThrow()
  })
  it('fresh 뒤 LINK는 ID/role을 바꾸지 않고 증명을 소진하며 마지막 해제를 금지한다', () => {
    const actor = mockDatabase.loginAs('USER')
    const signOut = vi.fn()
    const repository = new MockSsoAccountRepository(() => actor, signOut)
    expect(() => repository.unlink('google')).toThrow()
    const link = {
      purpose: 'ACCOUNT_LINK' as const,
      provider: 'apple' as const
    }
    expect(() => repository.prepare(link)).toThrow()
    const fresh = {
      purpose: 'ACCOUNT_FRESH' as const,
      provider: 'google' as const
    }
    repository.prepare(fresh)
    repository.complete(fresh, actor.id)
    repository.prepare(link)
    repository.complete(link, actor.id)
    expect(repository.capabilities().providers).toHaveLength(2)
    expect(repository.capabilities().freshVerified).toBe(false)
    repository.unlink('apple')
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(() => repository.unlink('google')).toThrow()
    expect(repository.capabilities().providers.map((p) => p.provider)).toEqual([
      'google'
    ])
    expect(actor.role).toBe('USER')
  })
  it('탈퇴 접수는 외부 완료를 만들지 않으며 정상 새 로그인은 receipt를 제거한다', () => {
    const actor = mockDatabase.loginAs('USER')
    let current: typeof actor | null = actor
    const repository = new MockSsoAccountRepository(
      () => current,
      () => {
        current = null
      }
    )
    expect(() => repository.deletion()).toThrow()
    expect(() => repository.deleteAccount()).toThrow()
    const fresh = {
      purpose: 'ACCOUNT_FRESH' as const,
      provider: 'google' as const
    }
    repository.prepare(fresh)
    repository.complete(fresh, actor.id)
    const accepted = repository.deleteAccount()
    expect(accepted).toEqual({
      appStatus: 'DELETION_PENDING',
      deletionScheduledAt: expect.any(String),
      providerCleanup: [{ provider: 'google', status: 'PENDING' }]
    })
    // JLP-845: the first whole hour after 7 days.
    const scheduled = Date.parse(accepted.deletionScheduledAt ?? '')
    expect(scheduled - Date.now()).toBeGreaterThan(7 * 24 * 60 * 60 * 1000)
    expect(new Date(scheduled).getUTCMinutes()).toBe(0)
    expect(current).toBeNull()
    expect(repository.deletion().appStatus).toBe('DELETION_PENDING')
    repository.newSession()
    expect(() => repository.deletion()).toThrow()
    // A sign-in in the grace period offers restore once; decline keeps it.
    expect(repository.erasurePending(actor.id)).toBe(true)
    expect(() => repository.restoreState()).toThrow()
    repository.offerRestore(actor.id)
    expect(repository.restoreState()).toEqual({
      deletionScheduledAt: accepted.deletionScheduledAt
    })
    expect(repository.decline()).toEqual({
      declined: true,
      deletionScheduledAt: accepted.deletionScheduledAt
    })
    expect(() => repository.restore()).toThrow()
    repository.offerRestore(actor.id)
    expect(repository.restore()).toBe(actor.id)
    expect(repository.erasurePending(actor.id)).toBe(false)
  })
})
