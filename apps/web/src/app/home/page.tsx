import { useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { usePracticeSetupController } from '@app/practice/hooks/usePracticeSetupController'
import { HeroStartCard } from '@app/home/components/HeroStartCard'
import { DailyQuestionCard } from '@app/home/components/DailyQuestionCard'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { GuestBenefitLine, ResumeLine } from '@app/home/components/HomeLines'
// Inlined into this lazy chunk: the home styles stay out of the first-load CSS.

/**
 * 첫 화면 B (JLP-823): a soft band with one sentence and [시작하기], then
 * today's question (on wide screens a sheet on the band's right). Guests and
 * members see the same screen with different words.
 * #992: today's question follows the level picked in the sentence, and a
 * member's unfinished set sits as one line under the button. #995: one line
 * at the foot (guest: sign in to keep; member: this level's last 7 days).
 */
export const LearningHome = ({
  memberLine,
  memberFootLine
}: {
  /** The member line under [시작하기]; the member route passes it in. */
  memberLine?: ReactNode
  /** The member foot line for the picked level; the member route too. */
  memberFootLine?: (level: JlptLevel) => ReactNode
}): ReactElement => {
  const resumableHeadingRef = useRef<HTMLHeadingElement>(null)
  const setup = usePracticeSetupController(resumableHeadingRef)
  const level = setup.level ?? setup.defaultLevel
  const isMember = setup.isReady && !setup.isGuest
  return (
    <section className="home-b">
      <div className="home-band">
        <HeroStartCard
          setup={setup}
          memberLines={
            isMember ? (
              <>
                <ResumeLine query={setup.resumableSessions} />
                {memberLine}
              </>
            ) : null
          }
        />
        <DailyQuestionCard level={level} />
        {isMember ? (
          memberFootLine?.(level)
        ) : setup.isGuest && !setup.isGuestDailyLimitReached ? (
          <GuestBenefitLine loginHref={setup.loginHref} />
        ) : null}
      </div>
    </section>
  )
}

/** The guest home at /; a member's / is MemberHome (dashboard router). */
export const HomePage = (): ReactElement => <LearningHome />
