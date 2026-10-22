import type {
  AccountSsoRequest,
  SsoAccountCapabilities,
  SsoAccountDeletion,
  SsoAccountErrorCode
} from '@nihongo/contracts/auth/sso-account-management'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import type { User } from '@common/types/domain'

export class MockSsoAccountError extends Error {
  constructor(
    readonly status: number,
    readonly code: SsoAccountErrorCode
  ) {
    super('The Mock account operation could not be confirmed.')
  }
}
/** Dev/test repository state only. Never claims real provider proof or physical erasure. */
export class MockSsoAccountRepository {
  private links = new Map<string, Set<SsoProviderId>>()
  private fresh: string | null = null
  private generation = 0
  private pending: {
    userId: string
    generation: number
    input: AccountSsoRequest
  } | null = null
  private receipt: SsoAccountDeletion | null = null
  constructor(
    private readonly current: () => User | null,
    private readonly signOut: () => void
  ) {}
  reset(): void {
    this.links.clear()
    this.receipt = null
    this.clearProof()
  }
  clearProof(): void {
    this.generation += 1
    this.fresh = null
    this.pending = null
  }
  newSession(): void {
    this.clearProof()
    this.receipt = null
  }
  noteLogin(provider: SsoProviderId, id: string): void {
    const linked = this.links.get(id)
    if (linked && !linked.has(provider))
      throw new MockSsoAccountError(409, 'SSO_ACCOUNT_NOT_LINKED')
    if (!linked) this.links.set(id, new Set([provider]))
  }
  private actor(): User {
    const user = this.current()
    if (!user) throw new MockSsoAccountError(401, 'AUTHENTICATION_REQUIRED')
    return user
  }
  private connected(id: string): Set<SsoProviderId> {
    if (!this.links.has(id)) this.links.set(id, new Set(['google']))
    return this.links.get(id)!
  }
  capabilities(): SsoAccountCapabilities {
    const actor = this.actor()
    const links = this.connected(actor.id)
    return {
      providers: (['apple', 'google'] as const)
        .filter((p) => links.has(p))
        .map((provider) => ({
          provider,
          reauthAvailable: true,
          canUnlink: links.size > 1,
          unlinkBlockedReason: links.size > 1 ? null : 'LAST_SIGN_IN_METHOD'
        })),
      linkableProviders: (['apple', 'google'] as const).filter(
        (p) => !links.has(p)
      ),
      unlinkRequiresFresh: actor.role === 'ADMIN',
      canDelete: true,
      deletionBlockedReason: null,
      deleteRequiresFresh: true,
      freshVerified: this.fresh === actor.id
    }
  }
  prepare(input: AccountSsoRequest): void {
    const actor = this.actor()
    const linked = this.connected(actor.id)
    if (input.purpose === 'ACCOUNT_FRESH' && !linked.has(input.provider))
      throw new MockSsoAccountError(409, 'SSO_ACCOUNT_NOT_LINKED')
    if (input.purpose === 'ACCOUNT_LINK') {
      if (this.fresh !== actor.id)
        throw new MockSsoAccountError(403, 'SSO_FRESH_REQUIRED')
      if (linked.has(input.provider))
        throw new MockSsoAccountError(409, 'SSO_ACCOUNT_NOT_LINKED')
    }
    this.pending = { userId: actor.id, generation: this.generation, input }
  }
  complete(
    input: AccountSsoRequest,
    providerOwner: string
  ): SsoAccountCapabilities {
    const actor = this.actor()
    const pending = this.pending
    this.pending = null
    if (
      !pending ||
      pending.userId !== actor.id ||
      pending.generation !== this.generation ||
      pending.input.provider !== input.provider ||
      pending.input.purpose !== input.purpose ||
      providerOwner !== actor.id
    )
      throw new MockSsoAccountError(409, 'SSO_ACCOUNT_NOT_LINKED')
    if (input.purpose === 'ACCOUNT_FRESH') this.fresh = actor.id
    else {
      if (this.fresh !== actor.id)
        throw new MockSsoAccountError(403, 'SSO_FRESH_REQUIRED')
      this.connected(actor.id).add(input.provider)
      this.fresh = null
    }
    return this.capabilities()
  }
  unlink(provider: SsoProviderId) {
    const actor = this.actor()
    const linked = this.connected(actor.id)
    if (!linked.has(provider))
      throw new MockSsoAccountError(409, 'SSO_ACCOUNT_NOT_LINKED')
    if (linked.size < 2)
      throw new MockSsoAccountError(409, 'SSO_LAST_SIGN_IN_METHOD')
    if (actor.role === 'ADMIN' && this.fresh !== actor.id)
      throw new MockSsoAccountError(403, 'SSO_FRESH_REQUIRED')
    linked.delete(provider)
    this.clearProof()
    this.signOut()
    return { unlinked: true, sessionRevoked: true } as const
  }
  deleteAccount(): SsoAccountDeletion {
    const actor = this.actor()
    if (this.fresh !== actor.id)
      throw new MockSsoAccountError(403, 'SSO_FRESH_REQUIRED')
    this.receipt = {
      appStatus: 'DELETION_PENDING',
      providerCleanup: [...this.connected(actor.id)].map((provider) => ({
        provider,
        status: 'PENDING'
      }))
    }
    this.clearProof()
    this.signOut()
    return structuredClone(this.receipt)
  }
  deletion(): SsoAccountDeletion {
    if (!this.receipt)
      throw new MockSsoAccountError(404, 'SSO_DELETION_RECEIPT_UNAVAILABLE')
    return structuredClone(this.receipt)
  }
}
