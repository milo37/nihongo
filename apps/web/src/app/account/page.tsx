import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { AccountSettings } from '@app/account/components/AccountSettings'
import { Avatar } from '@app/account/components/Avatar'
import { MyStudy } from '@app/account/components/study/MyStudy'
import { SignInCard } from '@app/login/components/SignInCard'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

// My page: profile, study summary, recommendations and account settings.
export const AccountPage = (): ReactElement => {
  const { t } = useTranslation('account')
  const { t: navigationT } = useTranslation('navigation')
  const { user } = useAuth()
  if (!user) {
    return (
      <section className="auth-page">
        <SignInCard
          title={t('guestTitle')}
          description={t('guestDescription')}
          redirect="/"
        />
      </section>
    )
  }
  return (
    <div className="account-page">
      <header className="flex items-center gap-4">
        <Avatar name={user.name} size="lg" />
        <div className="min-w-0">
          <h1 className="break-words text-[28px] font-bold leading-tight">
            {user.name}
          </h1>
          <p className="mt-1 text-xs text-muted">
            {navigationT('accountMenu.signedInWith')}
          </p>
        </div>
      </header>
      <MyStudy />
      <AccountSettings />
    </div>
  )
}
