import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import {
  CancelResumableDialog,
  PracticeSetupFeedback
} from '@app/practice/components/PracticeSetupFeedback'
import setupCss from '@app/practice/setup.css?inline'
import { PracticeSetupForm } from '@app/practice/components/PracticeSetupForm'
import { GuestDailyLimitCard } from '@app/practice/components/GuestDailyLimitCard'
import { GuestUrlLockedNotice } from '@app/practice/components/GuestSetupNotices'
import { ResumablePractice } from '@app/practice/components/ResumablePractice'
import { usePracticeSetupController } from '@app/practice/hooks/usePracticeSetupController'
import { levels, modes, subjects } from '@app/practice/practiceSetupOptions'

const subjectLabelKeys = {
  VOCABULARY: 'approved.vocabulary',
  GRAMMAR: 'subjects.grammar.label',
  READING: 'subjects.reading.label'
} as const

export const PracticePage = (): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: homeT } = useTranslation('home')
  const resumableHeadingRef = useRef<HTMLHeadingElement>(null)
  const setupHeadingRef = useRef<HTMLHeadingElement>(null)
  const setup = usePracticeSetupController(resumableHeadingRef)
  const { count, level, mode, resumableSessions, subject } = setup
  const subjectLabel = homeT(subjectLabelKeys[subject])
  const startLabel = level
    ? homeT('quickDrill.start', {
        level,
        subject: subjectLabel,
        formattedCount: count
      })
    : homeT('approved.loading')

  return (
    <section className="practice-setup-page">
      <style href="harumaru-setup" precedence="default">
        {setupCss}
      </style>
      <div className="practice-setup-heading">
        <h1 ref={setupHeadingRef} className="outline-none" tabIndex={-1}>
          {t('setup.title')}
        </h1>
      </div>
      {setup.isGuestDailyLimitReached ? (
        <GuestDailyLimitCard redirect="/practice" />
      ) : null}
      {setup.isUrlLockedForGuest ? (
        <GuestUrlLockedNotice loginHref={setup.loginHref} />
      ) : null}
      <ResumablePractice
        query={resumableSessions}
        canLoad={setup.canLoadResumableSessions}
        sourceUnavailable={setup.isResumableSourceUnavailable}
        interactionLocked={setup.isResumableInteractionLocked}
        headingRef={resumableHeadingRef}
        onCancel={setup.setCancelSessionId}
      />
      <PracticeSetupForm
        level={level}
        subject={subject}
        count={count}
        mode={mode}
        levels={levels}
        subjects={subjects}
        modes={modes}
        isReady={setup.isReady}
        isGuest={setup.isGuest}
        isCreating={setup.isCreatingSession}
        isGuestDailyLimitReached={setup.isGuestDailyLimitReached}
        guestAllowance={setup.guestAllowance}
        hasResumableSession={Boolean(resumableSessions.data?.items.length)}
        subjectLabel={subjectLabel}
        startLabel={startLabel}
        onSubjectChange={(option) =>
          setup.changeSetting('subject', option, setup.defaultSubject)
        }
        onLevelChange={(option) =>
          setup.changeSetting('level', option, setup.defaultLevel)
        }
        onModeChange={(option) => setup.changeSetting('mode', option, 'RANDOM')}
        onCountChange={setup.changeCount}
        onStart={setup.handleStart}
        feedback={
          <PracticeSetupFeedback
            accountRestricted={setup.accountRestricted}
            hasCreateError={setup.hasCreateError}
            mode={mode}
            noEligibleQuestions={setup.noEligibleQuestions}
            onSelectRandom={() =>
              setup.changeSetting('mode', 'RANDOM', 'RANDOM')
            }
          />
        }
      />

      <CancelResumableDialog
        open={setup.cancelSessionId !== null}
        fallbackFocusRef={
          resumableSessions.data?.total === 0
            ? setupHeadingRef
            : resumableHeadingRef
        }
        hasError={setup.hasCancelError}
        isCancelling={setup.isCancelling}
        onConfirm={setup.confirmCancel}
        onKeep={() => setup.setCancelSessionId(null)}
      />
    </section>
  )
}
