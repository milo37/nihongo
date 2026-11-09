import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { AccountSettings } from '@app/account/components/AccountSettings'
import { Avatar } from '@app/account/components/Avatar'
import { MyStudy } from '@app/account/components/study/MyStudy'
import { GuestGate } from '@app/login/components/GuestGate'
import { InformationFooter } from '@nihongo/browser/common/components/InformationFooter'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

// My page: profile, study summary, account settings, then terms and help.
export const AccountPage = (): ReactElement => {
  const { t: navigationT } = useTranslation('navigation')
  const { t: authT } = useTranslation('auth')
  const { isReady, user } = useAuth()
  // Until /me answers, a signed-in member must not see the sign-in card.
  if (!isReady) {
    return (
      <section className="auth-page">
        <p role="status">{authT('sso.checkingSession')}</p>
      </section>
    )
  }
  // Guests reach terms and help here too: the shell has no footer (C2).
  if (!user) {
    return (
      <>
        <GuestGate screen="account" />
        <InformationFooter />
      </>
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
      <InformationFooter />
    </div>
  )
}
