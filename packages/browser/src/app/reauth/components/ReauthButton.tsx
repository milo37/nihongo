import { useTranslation } from 'react-i18next'
import type { ReactElement, Ref } from 'react'
import { Button } from '../../../common/components/Button'
import type {
  ButtonSize,
  ButtonVariant
} from '../../../common/components/Button'

type ReauthButtonProps = {
  /** Visible label; defaults to "Google로 본인 확인". */
  label?: string
  busy: boolean
  disabled?: boolean
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  className?: string
  buttonRef?: Ref<HTMLButtonElement>
  onClick: () => void
}

/** The one re-verification button: Google mark, label, busy while leaving. */
export const ReauthButton = ({
  label,
  busy,
  disabled = false,
  variant = 'outline',
  size = 'md',
  fullWidth = false,
  className,
  buttonRef,
  onClick
}: ReauthButtonProps): ReactElement => {
  const { t } = useTranslation('auth')
  return (
    <Button
      ref={buttonRef}
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      className={className}
      data-provider="google"
      disabled={busy || disabled}
      isLoading={busy}
      loadingLabel={t('reauth.redirecting')}
      onClick={onClick}
    >
      <img
        src="/auth/google-mark.svg"
        alt=""
        aria-hidden="true"
        width={18}
        height={18}
      />
      <span>{label ?? t('reauth.go')}</span>
    </Button>
  )
}
