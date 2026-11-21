import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { AccountSettings } from '@app/account/components/AccountSettings'
import { NicknameSetting } from '@app/account/components/NicknameSetting'
import { MyStudy } from '@app/account/components/study/MyStudy'
import { StampBoard } from '@app/account/components/StampBoard'
import { StudyGoalRow } from '@app/account/components/StudyGoalRow'
import { readLastPracticeLevel } from '@app/login/queries/studyGoalQueries'
import {
  Omikuji,
  OmikujiWithoutBoard
} from '@app/account/components/omikuji/Omikuji'
import { FALLBACK_LEVEL } from '@app/practice/practiceSetupOptions'
import { HomeScreenHint } from '@app/account/components/HomeScreenHint'
import { GuestGate } from '@app/login/components/GuestGate'
import { InformationFooter } from '@nihongo/browser/common/components/InformationFooter'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

// My page: profile, study goal, this month's stamps, study summary, account settings, the iOS
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
      <NicknameSetting name={user.name} />
      <StudyGoalRow userId={user.id} />
      <StampBoard userId={user.id} action={<Omikuji userId={user.id} />} />
      <OmikujiWithoutBoard userId={user.id} />
      {/* JLP-853: the target level's records. #1090 O-3: with no target,
          this device's last practice level, then N5 (as practice does). */}
      <MyStudy
        level={user.targetLevel ?? readLastPracticeLevel() ?? FALLBACK_LEVEL}
      />
      <AccountSettings />
      <HomeScreenHint />
      <InformationFooter />
    </div>
  )
}
