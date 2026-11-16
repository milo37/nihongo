import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { shouldShowIosHomeScreenHint } from '@common/libs/homeScreenHint'

// #1045: one line for iOS Safari, which has no install prompt of its own.
// Android browsers offer their own install, so they see nothing here.
export const HomeScreenHint = (): ReactElement | null => {
  const { t } = useTranslation('account')
  const [shown] = useState(shouldShowIosHomeScreenHint)
  if (!shown) return null
  return (
    <p className="home-screen-hint text-sm leading-6 text-muted">
      {t('homeScreenHint')}
    </p>
  )
}
