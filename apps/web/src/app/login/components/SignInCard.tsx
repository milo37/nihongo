import { useEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import { AuthFlowError } from '@nihongo/browser/app/login/authFlowErrors'
import { SsoProviderButton } from '@app/login/components/SsoProviderButton'
import { useStartSocialSignIn } from '@app/login/hooks/useStartSocialSignIn'

export type SignInNotice = { message: string; tone: 'error' | 'info' }

type SignInCardProps = {
  title: string
  description: string
  redirect: string
  notice?: SignInNotice | null
  headingRef?: RefObject<HTMLHeadingElement | null>
  onStart?: () => void
}

// One Google sign-in card for /login and the signed-out account page.
export const SignInCard = ({
  title,
  description,
  redirect,
  notice = null,
  headingRef,
  onStart
}: SignInCardProps): ReactElement => {
  const { t } = useTranslation('auth')
  const start = useStartSocialSignIn()
  const google = useRef<HTMLButtonElement>(null)
  const busy = start.isPending || start.isRedirecting
  // An error, from the start request or the returned result, puts focus
  // on the button that recovers from it.
  const noticeIsError = notice?.tone === 'error'
  useEffect(() => {
    if (start.isError || noticeIsError) google.current?.focus()
  }, [noticeIsError, start.isError])
  const error = start.isError
    ? t(
        start.error instanceof AuthFlowError && start.error.unavailable
          ? 'sso.unavailableProvider'
          : 'sso.failedProvider',
        { provider: 'Google' }
      )
    : null
  const shown: SignInNotice | null = error
    ? { message: error, tone: 'error' }
    : notice
  return (
    <div className="auth-panel">
      <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
        {title}
      </h1>
      <p className="auth-description">{description}</p>
      {shown ? (
        <p
          className={
            'auth-notice' + (shown.tone === 'error' ? ' auth-error' : '')
          }
          role={shown.tone === 'error' ? 'alert' : 'status'}
        >
          {shown.message}
        </p>
      ) : null}
      <div
        className={shown ? 'auth-actions auth-actions-tight' : 'auth-actions'}
      >
        <SsoProviderButton
          provider="google"
          label={t('sso.continueGoogle')}
          disabled={busy}
          isLoading={busy}
          loadingLabel={t('sso.redirecting', { provider: 'Google' })}
          buttonRef={google}
          onClick={() => {
            if (busy) return
            onStart?.()
            start.mutate({ provider: 'google', callbackURL: redirect })
          }}
        />
      </div>
      <p className="auth-consent">
        <Trans
          t={t}
          i18nKey="sso.consentNotice"
          components={{
            terms: <Link to="/legal#terms" />,
            privacy: <Link to="/legal#privacy" />
          }}
        />
      </p>
    </div>
  )
}
