import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { useAccountRestore } from '@app/login/hooks/useAccountRestore'
import type { RestoreFailure } from '@app/login/hooks/useAccountRestore'
import { Button } from '@nihongo/browser/common/components/Button'

type RestoreCardProps = {
  redirect: string
  onFailed: (failure: RestoreFailure) => void
}

// The date in the description is bold ink (<date>…</date> in the text).
const boldDate = (text: string): ReactNode[] =>
  text.split(/(<date>.*?<\/date>)/u).map((part, index) => {
    const match = /^<date>(.*)<\/date>$/u.exec(part)
    return match ? (
      <strong key={index} className="font-semibold text-ink">
        {match[1]}
      </strong>
    ) : (
      part
    )
  })

/** JLP-845 design states ①·②: restore the account or keep the erasure. */
export const RestoreCard = ({
  redirect,
  onFailed
}: RestoreCardProps): ReactElement | null => {
  const { t } = useTranslation('auth')
  const heading = useRef<HTMLHeadingElement>(null)
  const { isChecking, date, isRestoring, busy, onRestore, onKeep } =
    useAccountRestore(redirect, onFailed)

  useEffect(() => {
    if (date) heading.current?.focus()
  }, [date])

  if (isChecking) {
    return (
      <div className="auth-panel auth-restore">
        <p role="status">{t('sso.checkingAccount')}</p>
      </div>
    )
  }
  if (!date) return null
  return (
    <div className="auth-panel auth-restore">
      <h1 ref={heading} className="outline-none" tabIndex={-1}>
        {t('recover.title')}
      </h1>
      <p className="auth-description">
        {boldDate(t('recover.description', { date }))}
      </p>
      <div className="auth-actions">
        <Button
          size="lg"
          fullWidth
          disabled={busy}
          isLoading={isRestoring}
          onClick={onRestore}
        >
          {t('recover.restore')}
        </Button>
        <Button
          size="lg"
          variant="outline"
          fullWidth
          disabled={busy}
          onClick={onKeep}
        >
          {t('recover.keep')}
        </Button>
      </div>
    </div>
  )
}
