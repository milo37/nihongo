import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'

export const MockAuthenticationNotice = (): ReactElement => {
  const { t } = useTranslation('auth')

  return (
    <div
      id="mock-auth-notice"
      className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
      role="status"
    >
      <p className="font-black">{t('mockNotice.title')}</p>
      <p>USER: user@example.com / Demo-user-2026!</p>
      <p>ADMIN: admin@example.com / Demo-admin-2026!</p>
      <p>REVIEWER ADMIN: reviewer@example.com / Demo-reviewer-2026!</p>
      <p className="mt-1">{t('mockNotice.limitation')}</p>
    </div>
  )
}
