import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { linkConsent } from '@app/login/components/linkConsent'

export type CheckName = 'age' | 'terms'

/** The two required boxes on '가입 확인', each with its '(필수)' mark. */
export const SignupConsentChecks = ({
  checked,
  required,
  onToggle
}: {
  checked: Record<CheckName, boolean>
  required: ReactNode
  onToggle: (name: CheckName, value: boolean) => void
}): ReactElement => {
  const { t } = useTranslation('auth')
  return (
    <div className="signup-consent-checks">
      <label className="signup-consent-check">
        <input
          id="signup-consent-age"
          type="checkbox"
          checked={checked.age}
          aria-describedby="signup-consent-age-hint"
          onChange={(event) => onToggle('age', event.currentTarget.checked)}
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
          onChange={(event) => onToggle('terms', event.currentTarget.checked)}
        />
        <span>
          {linkConsent(t('signup.terms'), true)}
          {required}
        </span>
      </label>
    </div>
  )
}
