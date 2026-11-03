import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import type { useSsoAccountManagement } from '@app/login/hooks/useSsoAccountManagement'

type SsoAccountFlow = ReturnType<typeof useSsoAccountManagement>
export type SsoCapabilities = NonNullable<
  SsoAccountFlow['capabilities']['data']
>

export const providerName = (provider: SsoProviderId): string =>
  provider === 'apple' ? 'Apple' : 'Google'

// Maps the provider round-trip result to the status message key shown after return.
export const getSsoResultKey = (
  result: SsoAccountFlow['returnEvent'],
  caps: SsoCapabilities | undefined
): string | null =>
  !result
    ? null
    : result.outcome === 'CANCELLED'
      ? 'cancelledAccount'
      : result.outcome === 'INVALID_CALLBACK'
        ? 'expired'
        : result.outcome === 'FAILED'
          ? 'actionFailed'
          : result.kind === 'fresh'
            ? caps?.freshVerified
              ? 'freshConfirmed'
              : 'checkingAccount'
            : caps?.providers.length === 2
              ? 'linked'
              : 'checkingAccount'
