import type { ReactElement, Ref } from 'react'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'

type SsoProviderButtonProps = {
  provider: SsoProviderId
  label: string
  disabled: boolean
  onClick: () => void
  buttonRef?: Ref<HTMLButtonElement>
}

export const SsoProviderButton = ({
  provider,
  label,
  disabled,
  onClick,
  buttonRef
}: SsoProviderButtonProps): ReactElement => (
  <button
    ref={buttonRef}
    className="auth-sso-button"
    data-provider={provider}
    disabled={disabled}
    onClick={onClick}
    type="button"
  >
    <img
      src={'/auth/' + provider + '-mark.svg'}
      alt=""
      aria-hidden="true"
      width={20}
      height={20}
    />
    <span>{label}</span>
  </button>
)
