import type { ReactElement, Ref } from 'react'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import { Button } from '@nihongo/browser/common/components/Button'

type SsoProviderButtonProps = {
  provider: SsoProviderId
  label: string
  disabled: boolean
  isLoading?: boolean
  loadingLabel?: string
  onClick: () => void
  buttonRef?: Ref<HTMLButtonElement>
}

export const SsoProviderButton = ({
  provider,
  label,
  disabled,
  isLoading = false,
  loadingLabel,
  onClick,
  buttonRef
}: SsoProviderButtonProps): ReactElement => (
  <>
    <Button
      ref={buttonRef}
      variant="outline"
      className="auth-sso-button"
      data-provider={provider}
      disabled={disabled}
      isLoading={isLoading}
      loadingLabel={loadingLabel ?? label}
      onClick={onClick}
    >
      <img
        src={'/auth/' + provider + '-mark.svg'}
        alt=""
        aria-hidden="true"
        width={20}
        height={20}
      />
      <span>{label}</span>
    </Button>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {isLoading ? (loadingLabel ?? label) : ''}
    </p>
  </>
)
