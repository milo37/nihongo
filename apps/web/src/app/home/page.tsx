import { Navigate, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { readLastPracticeChoice } from '@app/practice/lastPracticeChoice'
import { FALLBACK_LEVEL } from '@app/practice/practiceSetupOptions'
import { HeroStartCard } from '@app/home/components/HeroStartCard'
import { DailyQuestionCard } from '@app/home/components/DailyQuestionCard'
// Inlined into this lazy chunk: the home styles stay out of the first-load CSS.
import homeCss from '@app/home/home.css?inline'

/**
 * 학습 홈 (direction §1-2): greeting, the big start card, then today's
 * question. Two columns on wide screens, one below. Guests and members see
 * the same screen with different words.
 */
export const LearningHome = (): ReactElement => {
  const { t } = useTranslation('home')
  const { role, user } = useAuth()
  const isGuest = role === 'GUEST'
  // Same rule as the start card: target level, else the last one, else N5.
  const level =
    user?.targetLevel ?? readLastPracticeChoice()?.level ?? FALLBACK_LEVEL
  return (
    <section className="home-today">
      <style href="harumaru-home" precedence="default">
        {homeCss}
      </style>
      <header className="home-today-greeting">
        <h1 tabIndex={-1}>
          {isGuest
            ? t('today.guestGreeting')
            : user?.name
              ? t('today.memberGreeting', { name: user.name })
              : t('today.memberGreetingNoName')}
        </h1>
        <p>{isGuest ? t('today.guestLead') : t('today.memberLead')}</p>
      </header>
      <div className="home-today-grid">
        <div className="home-today-main">
          <HeroStartCard />
        </div>
        <DailyQuestionCard level={level} />
      </div>
    </section>
  )
}

export const HomePage = (): ReactElement => {
  const { isReady, role } = useAuth()
  const location = useLocation()
  if (isReady && role !== 'GUEST') {
    const searchParams = new URLSearchParams(location.search)
    searchParams.set('view', 'learning')
    return (
      <Navigate
        to={{
          pathname: '/dashboard',
          search: `?${searchParams.toString()}`,
          hash: location.hash
        }}
        replace
      />
    )
  }
  return <LearningHome />
}
