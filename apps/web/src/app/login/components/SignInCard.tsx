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

type ConsentLinkName = keyof typeof CONSENT_LINKS

const consentLinkNames = Object.keys(CONSENT_LINKS) as ConsentLinkName[]

/**
 * Turns the <terms>…</terms> and <privacy>…</privacy> marks in the consent
 * text into links with plain string search, no regular expression, so every
 * browser reads it the same way. A mark without its end is dropped, never
 * shown. (react-i18next's Trans would add an HTML parser to the bundle.)
 */
export const linkConsent = (text: string): ReactNode[] => {
  const parts: ReactNode[] = []
  let rest = text
  while (rest) {
    const next = consentLinkNames
      .map((name) => ({ name, start: rest.indexOf(`<${name}>`) }))
      .filter(({ start }) => start >= 0)
      .sort((left, right) => left.start - right.start)[0]
    if (!next) {
      parts.push(rest)
      break
    }
    const open = `<${next.name}>`
    const close = `</${next.name}>`
    const end = rest.indexOf(close, next.start + open.length)
    if (next.start > 0) parts.push(rest.slice(0, next.start))
    const label = rest.slice(
      next.start + open.length,
      end < 0 ? undefined : end
    )
    parts.push(
      end < 0 ? (
        label
      ) : (
        <Link key={parts.length} to={CONSENT_LINKS[next.name]}>
          {label}
        </Link>
      )
    )
    rest = end < 0 ? '' : rest.slice(end + close.length)
  }
  return parts
}

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
      <Heading
        ref={headingRef}
        className="outline-none"
        tabIndex={headingRef ? -1 : undefined}
      >
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
