import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import {
  CancelResumableDialog,
  PracticeSetupFeedback
} from '@app/practice/components/PracticeSetupFeedback'
import { PracticeSetupForm } from '@app/practice/components/PracticeSetupForm'
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

export const PracticePage = ({
  children
}: { children?: ReactNode } = {}): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: homeT } = useTranslation('home')
  const resumableHeadingRef = useRef<HTMLHeadingElement>(null)
  const setupHeadingRef = useRef<HTMLHeadingElement>(null)
  const setup = usePracticeSetupController(resumableHeadingRef)
  const { count, level, mode, resumableSessions, subject } = setup
  const subjectLabel = homeT(subjectLabelKeys[subject])
  const startLabel = homeT('quickDrill.start', {
    level,
    subject: subjectLabel,
    formattedCount: count
  })

  return (
    <section className="practice-setup-page">
      <div className="practice-setup-heading">
        <h1 ref={setupHeadingRef} tabIndex={-1}>
          {t('setup.title')}
        </h1>
      </div>
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
        isProtectedGuestMode={setup.isProtectedGuestMode}
        hasResumableSession={Boolean(resumableSessions.data?.items.length)}
        subjectLabel={subjectLabel}
        startLabel={startLabel}
        loginHref={setup.loginHref}
        onSubjectChange={(option) =>
          setup.changeSetting('subject', option, DEFAULT_SUBJECT)
        }
        onLevelChange={(option) =>
          setup.changeSetting('level', option, setup.defaultLevel)
        }
        onCountChange={(option) =>
          setup.changeSetting('count', option, DEFAULT_COUNT)
        }
        onModeChange={(option) => setup.changeSetting('mode', option, 'RANDOM')}
        onStart={setup.handleStart}
        feedback={
          <PracticeSetupFeedback
            accountRestricted={setup.accountRestricted}
            hasCreateError={setup.hasCreateError}
            isProtectedGuestMode={setup.isProtectedGuestMode}
            loginHref={setup.loginHref}
            mode={mode}
            noEligibleQuestions={setup.noEligibleQuestions}
            onSelectRandom={() =>
              setup.changeSetting('mode', 'RANDOM', 'RANDOM')
            }
          />
        }
      />
      <PracticeShortcuts />

      {children}

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
