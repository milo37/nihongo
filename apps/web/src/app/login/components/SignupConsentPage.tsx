import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { linkConsent } from '@app/login/components/SignInCard'
import { useSignupConsent } from '@app/login/hooks/useSignupConsent'
import type { SignupConsentExit } from '@app/login/hooks/useSignupConsent'

type SignupConsentPageProps = {
  redirect: string
  onExit: (exit: SignupConsentExit) => void
}

type CheckName = 'age' | 'terms'

/**
 * #1085 r3-4 '가입 확인': two required boxes, [가입하기] and a quiet [취소].
 * The layout shows only the logo here; [취소] and going back are the only
 * ways out, and both leave no account behind.
 */
export const SignupConsentPage = ({
  redirect,
  onExit
}: SignupConsentPageProps): ReactElement | null => {
  const { t } = useTranslation('auth')
  const heading = useRef<HTMLHeadingElement>(null)
  const [checked, setChecked] = useState({ age: false, terms: false })
  const [missing, setMissing] = useState(false)
  const consent = useSignupConsent(redirect, onExit)
  const { kind, onCancel } = consent

  useEffect(() => {
    if (kind) heading.current?.focus()
  }, [kind])

  // Going back is the same as [취소]: one extra entry catches the back step.
  useEffect(() => {
    if (!kind) return
    window.history.pushState(window.history.state, '')
    const onBack = (): void => onCancel()
    window.addEventListener('popstate', onBack)
    return () => window.removeEventListener('popstate', onBack)
    // Armed once the page shows; onCancel only navigates away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  if (consent.isChecking) {
    return (
      <div className="auth-panel signup-consent">
        <p role="status">{t('sso.checkingAccount')}</p>
      </div>
    )
  }
  if (!kind) return null

  const toggle = (name: CheckName, value: boolean): void => {
    setChecked((current) => ({ ...current, [name]: value }))
    setMissing(false)
  }
  const submit = (): void => {
    const empty = (['age', 'terms'] as const).find((name) => !checked[name])
    if (empty) {
      setMissing(true)
      document.getElementById(`signup-consent-${empty}`)?.focus()
      return
    }
    consent.onAgree()
  }
  const existing = kind === 'EXISTING'
  return (
    <div className="auth-panel signup-consent">
      <h1 ref={heading} className="outline-none" tabIndex={-1}>
        {existing ? t('signup.titleExisting') : t('signup.titleNew')}
      </h1>
      <div className="signup-consent-checks">
        <label className="signup-consent-check">
          <input
            id="signup-consent-age"
            type="checkbox"
            checked={checked.age}
            aria-describedby="signup-consent-age-hint"
            onChange={(event) => toggle('age', event.currentTarget.checked)}
          />
          <span>{t('signup.age')}</span>
        </label>
        <p id="signup-consent-age-hint" className="signup-consent-hint">
          {t('signup.ageHint')}
        </p>
        <label className="signup-consent-check">
          <input
            id="signup-consent-terms"
            type="checkbox"
            checked={checked.terms}
            onChange={(event) => toggle('terms', event.currentTarget.checked)}
          />
          <span>{linkConsent(t('signup.terms'), true)}</span>
        </label>
      </div>
      {missing ? (
        <p className="signup-consent-error" role="alert">
          {t('signup.missing')}
        </p>
      ) : null}
      <Button
        className="signup-consent-submit"
        size="lg"
        fullWidth
        disabled={consent.busy}
        isLoading={consent.isAgreeing}
        onClick={submit}
      >
        {existing ? t('signup.submitExisting') : t('signup.submitNew')}
      </Button>
      <button
        type="button"
        className="signup-consent-cancel"
        disabled={consent.busy}
        onClick={onCancel}
      >
        {t('signup.cancel')}
      </button>
    </div>
  )
}
