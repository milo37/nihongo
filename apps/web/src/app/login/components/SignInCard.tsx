import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { AuthFlowError } from '@nihongo/browser/app/login/authFlowErrors'
import { SsoProviderButton } from '@app/login/components/SsoProviderButton'
import { useStartSocialSignIn } from '@app/login/hooks/useStartSocialSignIn'

const CONSENT_LINKS = {
  terms: '/legal#terms',
  privacy: '/legal#privacy'
} as const

// Turns the <terms>…</terms> and <privacy>…</privacy> marks in the consent
// text into links. (react-i18next's Trans would add an HTML parser package
// to the production bundle.)
const linkConsent = (text: string): ReactNode[] =>
  text
    .split(/(<(?:terms|privacy)>.*?<\/(?:terms|privacy)>)/u)
    .map((part, index) => {
      const match = /^<(terms|privacy)>(.*)<\/\1>$/u.exec(part)
      if (!match) return part
      const name = match[1] as keyof typeof CONSENT_LINKS
      return (
        <Link key={index} to={CONSENT_LINKS[name]}>
          {match[2]}
        </Link>
      )
    })

export type SignInNotice = { message: string; tone: 'error' | 'info' }

type SignInCardProps = {
  title: string
  description: string
  redirect: string
  notice?: SignInNotice | null
  headingRef?: RefObject<HTMLHeadingElement | null>
  onStart?: () => void
  /** h2 when the page has its own (screen-reader) h1, as in GuestGate. */
  headingLevel?: 'h1' | 'h2'
  icon?: ReactNode
  footer?: ReactNode
  /** The Google button's words; '로그인' on a tab's card (GuestGate). */
  buttonLabel?: string
}

// One Google sign-in card for /login and the signed-out account page.
export const SignInCard = ({
  title,
  description,
  redirect,
  notice = null,
  headingRef,
  onStart,
  headingLevel: Heading = 'h1',
  icon,
  footer,
  buttonLabel
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
    <div className={icon ? 'auth-panel guest-gate' : 'auth-panel'}>
      {icon ? (
        <span className="guest-gate-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <Heading ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
        {title}
      </Heading>
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
          label={buttonLabel ?? t('sso.continueGoogle')}
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
      <p className="auth-consent">{linkConsent(t('sso.consentNotice'))}</p>
      {footer}
    </div>
  )
}
