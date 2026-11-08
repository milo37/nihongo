import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import {
  CancelResumableDialog,
  PracticeSetupFeedback
} from '@app/practice/components/PracticeSetupFeedback'
import { PracticeSetupForm } from '@app/practice/components/PracticeSetupForm'
import { GuestDailyLimitCard } from '@app/practice/components/GuestDailyLimitCard'
import { GuestUrlLockedNotice } from '@app/practice/components/GuestSetupNotices'
import { useGuestAction } from '@app/login/hooks/useGuestAction'
import {
  GUEST_DAILY_SESSION_LIMIT,
  GUEST_SESSION_QUESTION_LIMIT
} from '@nihongo/contracts/study/guest-limits'
import { ResumablePractice } from '@app/practice/components/ResumablePractice'
import { usePracticeSetupController } from '@app/practice/hooks/usePracticeSetupController'
import {
  DEFAULT_COUNT,
  DEFAULT_SUBJECT,
  counts,
  levels,
  modes,
  subjects
} from '@app/practice/practiceSetupOptions'
import { getButtonClassName } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'

const subjectLabelKeys = {
  VOCABULARY: 'approved.vocabulary',
  GRAMMAR: 'subjects.grammar.label',
  READING: 'subjects.reading.label'
} as const

/** Links to the wrong-note review and bookmark lists. */
const PracticeShortcuts = (): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    <nav className="practice-shortcuts" aria-label={t('setup.shortcutsLabel')}>
      <Link
        className={getButtonClassName({ variant: 'ghost' })}
        to="/wrong-notes"
      >
        <Icon name="rotate-ccw" />
        {t('setup.reviewShortcut')}
      </Link>
      <Link
        className={getButtonClassName({ variant: 'ghost' })}
        to="/bookmarks"
      >
        <Icon name="bookmark" />
        {t('setup.bookmarkShortcut')}
      </Link>
    </nav>
  )
}

export const PracticePage = (): ReactElement => {
  const { t, i18n } = useTranslation('practice')
  const { t: homeT } = useTranslation('home')
  const resumableHeadingRef = useRef<HTMLHeadingElement>(null)
  const setupHeadingRef = useRef<HTMLHeadingElement>(null)
  const setup = usePracticeSetupController(resumableHeadingRef)
  const guestAction = useGuestAction()
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
      <div className="practice-setup-heading">
        <h1 ref={setupHeadingRef} tabIndex={-1}>
          {t('setup.title')}
        </h1>
        {setup.isGuest ? (
          <p className="practice-guest-hint">
            {t('setup.guestHint', {
              total: GUEST_DAILY_SESSION_LIMIT,
              count: GUEST_SESSION_QUESTION_LIMIT
            })}
            {/* Japanese puts no space between sentences. */}
            {i18n.resolvedLanguage === 'ja' ? '' : ' '}
            {t('setup.guestResumeHint')}
          </p>
        ) : null}
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
        requestedPage={setup.resumablePage}
        pageCount={setup.resumablePageCount}
        sourceUnavailable={setup.isResumableSourceUnavailable}
        interactionLocked={setup.isResumableInteractionLocked}
        headingRef={resumableHeadingRef}
        getPageHref={setup.getResumablePageHref}
        onPageChange={setup.setResumablePage}
        onCancel={setup.setCancelSessionId}
      />
      <PracticeSetupForm
        level={level}
        subject={subject}
        count={count}
        mode={mode}
        levels={levels}
        subjects={subjects}
        counts={counts}
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
          setup.changeSetting('subject', option, DEFAULT_SUBJECT)
        }
        onLevelChange={(option) =>
          setup.changeSetting('level', option, setup.defaultLevel)
        }
        onCountChange={(option) => {
          if (
            option !== GUEST_SESSION_QUESTION_LIMIT &&
            guestAction(t('setup.locked.count'))
          ) {
            return
          }
          setup.changeSetting('count', option, DEFAULT_COUNT)
        }}
        onModeChange={(option) => {
          if (option !== 'RANDOM' && guestAction(t('setup.locked.mode'))) {
            return
          }
          setup.changeSetting('mode', option, 'RANDOM')
        }}
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
      <PracticeShortcuts />

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
