import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { AccountSettings } from '@app/account/components/AccountSettings'
import { Avatar } from '@app/account/components/Avatar'
import { MyStudy } from '@app/account/components/study/MyStudy'
import { TargetLevelSetting } from '@app/account/components/TargetLevelSetting'
import { FALLBACK_LEVEL } from '@app/practice/practiceSetupOptions'
import { HomeScreenHint } from '@app/account/components/HomeScreenHint'
import { GuestGate } from '@app/login/components/GuestGate'
import { InformationFooter } from '@nihongo/browser/common/components/InformationFooter'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

// My page: profile, target level, study summary, account settings, the iOS
// home screen line, then terms and help.
export const AccountPage = (): ReactElement => {
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
        <HomeScreenHint />
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
        </div>
      </header>
      <TargetLevelSetting targetLevel={user.targetLevel} />
      {/* JLP-853: the target level's records; no target counts as N5. */}
      <MyStudy level={user.targetLevel ?? FALLBACK_LEVEL} />
      <AccountSettings />
      <HomeScreenHint />
      <InformationFooter />
    </div>
  )
}
