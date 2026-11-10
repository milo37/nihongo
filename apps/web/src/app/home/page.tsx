import { Navigate, useLocation } from 'react-router'
import type { ReactElement } from 'react'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { readLastPracticeChoice } from '@app/practice/lastPracticeChoice'
import { FALLBACK_LEVEL } from '@app/practice/practiceSetupOptions'
import { HeroStartCard } from '@app/home/components/HeroStartCard'
import { DailyQuestionCard } from '@app/home/components/DailyQuestionCard'
// Inlined into this lazy chunk: the home styles stay out of the first-load CSS.
import homeCss from '@app/home/home.css?inline'

/**
 * 첫 화면 B (JLP-823): a soft band with one sentence and [바로 풀기], then
 * today's question (on wide screens a sheet on the band's right). Guests and
 * members see the same screen with different words.
 */
export const LearningHome = (): ReactElement => {
  const { user } = useAuth()
  // Same rule as the start sentence: target level, else the last one, else N5.
  const level =
    user?.targetLevel ?? readLastPracticeChoice()?.level ?? FALLBACK_LEVEL
  return (
    <section className="home-b">
      <style href="harumaru-home" precedence="default">
        {homeCss}
      </style>
      <div className="home-band">
        <HeroStartCard />
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
