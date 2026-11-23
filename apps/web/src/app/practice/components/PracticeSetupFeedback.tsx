import { useTranslation } from 'react-i18next'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { StudyMode } from '@nihongo/browser/common/types/domain'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { AccountRestrictedNotice } from '@common/components/AccountRestrictedNotice'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatDateTime } from '@nihongo/browser/libs/localeFormatters'
import type { SessionCap } from '@libs/apiError'

type PracticeSetupFeedbackProps = {
  accountRestricted: boolean
  hasCreateError: boolean
  mode: StudyMode
  noEligibleQuestions: boolean
  onSelectRandom: () => void
  /** A member's new-set cap (#1006): said in the same notice box. */
  sessionCap?: SessionCap | null
}

export const PracticeSetupFeedback = ({
  accountRestricted,
  hasCreateError,
  mode,
  noEligibleQuestions,
  onSelectRandom,
  sessionCap = null
}: PracticeSetupFeedbackProps): ReactElement => {
  const { t, i18n } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const { t: navigationT } = useTranslation('navigation')
  const capKind = sessionCap?.kind
  const capTitle = useRef<HTMLParagraphElement>(null)
  // It appears right after a start press, so focus moves to it (design #1031).
  useEffect(() => {
    if (capKind) capTitle.current?.focus()
  }, [capKind])
  return (
    <>
      {sessionCap ? (
        <div className="practice-cap practice-alert" role="alert">
          <p
            ref={capTitle}
            className="practice-alert-title practice-title-quiet"
            tabIndex={-1}
          >
            {t(`setup.sessionCap.${sessionCap.kind}Title`)}
          </p>
          <p className="practice-alert-body">
            {t(`setup.sessionCap.${sessionCap.kind}Body`, {
              time: sessionCap.resetsAt
                ? formatDateTime(
                    sessionCap.resetsAt,
                    resolveUiLocale(i18n.resolvedLanguage),
                    { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
                  )
                : ''
            })}
          </p>
          <Link
            className={getButtonClassName({
              className: 'practice-alert-action',
              size: 'sm',
              variant: 'secondary'
            })}
            to="/wrong-notes"
          >
            {navigationT('wrongNotes')}
          </Link>
        </div>
      ) : accountRestricted ? (
        <AccountRestrictedNotice />
      ) : noEligibleQuestions ? (
        <div className="practice-alert" role="alert">
          {mode === 'DAILY_REVIEW' ? (
            <p className="practice-alert-title">
              {t('setup.modes.DAILY_REVIEW.empty')}
            </p>
          ) : (
            <>
              <p className="practice-alert-title">
                {t('setup.noEligibleTitle', {
                  mode: t(`setup.modes.${mode}.label`)
                })}
              </p>
              <p className="practice-alert-body">
                {t('setup.noEligibleDescription')}
              </p>
            </>
          )}
          {mode !== 'RANDOM' ? (
            <Button
              className="practice-alert-action"
              size="sm"
              variant="secondary"
              onClick={onSelectRandom}
            >
              {t('setup.selectRandom')}
            </Button>
          ) : null}
        </div>
      ) : hasCreateError ? (
        <ErrorState
          title={commonT('state.requestFailed')}
          description={t('setup.createError')}
        />
      ) : null}
    </>
  )
}
