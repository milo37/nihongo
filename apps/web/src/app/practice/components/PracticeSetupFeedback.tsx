import { useTranslation } from 'react-i18next'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import type { StudyMode } from '@nihongo/browser/common/types/domain'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
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
        <div
          className="practice-cap rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
          role="alert"
        >
          <p ref={capTitle} className="font-bold outline-none" tabIndex={-1}>
            {t(`setup.sessionCap.${sessionCap.kind}Title`)}
          </p>
          <p className="mt-1 leading-6">
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
              className: 'mt-3',
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
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
          role="alert"
        >
          {mode === 'DAILY_REVIEW' ? (
            <p className="font-bold">{t('setup.modes.DAILY_REVIEW.empty')}</p>
          ) : (
            <>
              <p className="font-bold">
                {t('setup.noEligibleTitle', {
                  mode: t(`setup.modes.${mode}.label`)
                })}
              </p>
              <p className="mt-1 leading-6">
                {t('setup.noEligibleDescription')}
              </p>
            </>
          )}
          {mode !== 'RANDOM' ? (
            <Button
              className="mt-3"
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

type CancelResumableDialogProps = {
  fallbackFocusRef: RefObject<HTMLHeadingElement | null>
  hasError: boolean
  isCancelling: boolean
  onConfirm: () => void
  onKeep: () => void
  open: boolean
}

export const CancelResumableDialog = ({
  fallbackFocusRef,
  hasError,
  isCancelling,
  onConfirm,
  onKeep,
  open
}: CancelResumableDialogProps): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    <Dialog
      open={open}
      fallbackFocusRef={fallbackFocusRef}
      title={t('setup.cancelDialog.title')}
      description={t('setup.cancelDialog.description')}
      footer={
        <>
          <Button variant="secondary" disabled={isCancelling} onClick={onKeep}>
            {t('setup.cancelDialog.keep')}
          </Button>
          <Button isLoading={isCancelling} onClick={onConfirm}>
            {t('setup.cancelDialog.confirm')}
          </Button>
        </>
      }
      preventClose={isCancelling}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isCancelling) {
          onKeep()
        }
      }}
    >
      {hasError ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
          role="alert"
        >
          {t('setup.cancelDialog.error')}
        </p>
      ) : null}
    </Dialog>
  )
}
