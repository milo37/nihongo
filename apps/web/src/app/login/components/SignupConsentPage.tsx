import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { linkConsent } from '@app/login/components/linkConsent'
import { isNickname, NicknameField } from '@app/login/components/NicknameField'
import { useSignupConsent } from '@app/login/hooks/useSignupConsent'
import type { SignupConsentExit } from '@app/login/hooks/useSignupConsent'

type SignupConsentPageProps = {
  redirect: string
  onExit: (exit: SignupConsentExit) => void
}

type CheckName = 'age' | 'terms'

/**
 * #1085 r3-4 '가입 확인': two required boxes, [가입하기] and a quiet [취소].
 * #1096 r6: the nickname above the boxes, prefilled from the server.
 * The layout shows only the logo here; [취소] and going back are the only
 * ways out, and both leave no account behind.
 */
export const SignupConsentPage = ({
  redirect,
  onExit
}: SignupConsentPageProps): ReactElement | null => {
  const { i18n, t } = useTranslation('auth')
  const heading = useRef<HTMLHeadingElement>(null)
  const [checked, setChecked] = useState({ age: false, terms: false })
  const { addToast } = useToast()
  const [typed, setTyped] = useState<string | null>(null)
  const [nicknameInvalid, setNicknameInvalid] = useState(false)
  const nicknameInput = useRef<HTMLInputElement>(null)
  const consent = useSignupConsent(redirect, onExit)
  const { kind, onCancel } = consent
  const nickname = typed ?? consent.nicknameDefault

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
  }
  const showNicknameInvalid = (): void => {
    setNicknameInvalid(true)
    nicknameInput.current?.focus()
  }
  // Both errors show at once; the focus goes to the upper one (N-4).
  const submit = (): void => {
    const badNickname = !isNickname(nickname)
    const empty = (['age', 'terms'] as const).find((name) => !checked[name])
    setNicknameInvalid(badNickname)
    // #1292: an unticked required box is a toast, not a line; [가입하기]
    // stays pressable and the focus goes to the box.
    if (empty)
      addToast({
        key: 'signup-missing',
        title: t('signup.missing'),
        variant: 'warning'
      })
    if (badNickname) nicknameInput.current?.focus()
    else if (empty) document.getElementById(`signup-consent-${empty}`)?.focus()
    if (badNickname || empty) return
    consent.onAgree(nickname.trim(), showNicknameInvalid)
  }
  const existing = kind === 'EXISTING'
  // #1285: '(필수)' after each required item, a space before it in ko; ja's
  // full-width （必須） sits right against the text. Read aloud as written.
  const required = (
    <>
      {i18n.resolvedLanguage === 'ja' ? null : ' '}
      <span className="signup-required">{t('signup.required')}</span>
    </>
  )
  return (
    <div className="auth-panel signup-consent">
      <h1 ref={heading} className="auth-title-quiet" tabIndex={-1}>
        {existing ? t('signup.titleExisting') : t('signup.titleNew')}
      </h1>
      <NicknameField
        id="signup-consent-nickname"
        value={nickname}
        invalid={nicknameInvalid}
        inputRef={nicknameInput}
        labelMark={required}
        onChange={(value) => {
          setTyped(value)
          setNicknameInvalid(false)
        }}
      />
      <div className="signup-consent-checks">
        <label className="signup-consent-check">
          <input
            id="signup-consent-age"
            type="checkbox"
            checked={checked.age}
            aria-describedby="signup-consent-age-hint"
            onChange={(event) => toggle('age', event.currentTarget.checked)}
          />
          <span>
            {t('signup.age')}
            {required}
          </span>
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
          <span>
            {linkConsent(t('signup.terms'), true)}
            {required}
          </span>
        </label>
      </div>
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
