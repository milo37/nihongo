import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { PracticeDraftStatusCode } from '@app/practice/hooks/usePracticeDraftController'
import { Icon } from '@nihongo/browser/common/components/Icon'

type StudyDraftSaveStatusProps = {
  status: PracticeDraftStatusCode | null
  onRetry: () => void
}
const states = ['saved', 'dirty', 'saving', 'error', 'offline'] as const

export const StudyDraftSaveStatus = ({
  status,
  onRetry
}: StudyDraftSaveStatusProps): ReactElement => {
  const { t } = useTranslation('practice')
  const state =
    status === 'synced' || status === 'savedAt'
      ? 'saved'
      : states.find((value) => value === status)
  const canRetry = state === 'error' || state === 'offline'
  return (
    <div className="study-inline-save" data-save-state={status ?? 'detailed'}>
      {/* Measure every localized state in the same grid cell, including wrapped retry.
          This reserves the longest state at any width/zoom without live announcements. */}
      <div className="study-inline-save-measures" aria-hidden="true">
        {states.map((value) => (
          <div
            key={value}
            className="study-inline-save-item"
            data-tone={value === 'error' ? 'danger' : undefined}
            data-has-retry={
              value === 'error' || value === 'offline' ? '' : undefined
            }
          >
            <span className="study-inline-save-message">
              <span className="study-inline-save-icon" />
              <span data-copy={t(`session.draft.inline.${value}`)} />
            </span>
            {value === 'error' || value === 'offline' ? (
              <span
                className="study-inline-save-retry"
                data-copy={t('session.draft.retryShort')}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div
        className="study-inline-save-item study-inline-save-current"
        data-has-retry={canRetry ? '' : undefined}
        data-tone={state === 'error' ? 'danger' : undefined}
        aria-live={canRetry ? 'polite' : 'off'}
        role={canRetry ? 'status' : undefined}
        aria-atomic={canRetry ? true : undefined}
      >
        {state ? (
          <>
            <span className="study-inline-save-message">
              <Icon
                className="study-inline-save-icon"
                name={
                  state === 'saved'
                    ? 'check'
                    : canRetry
                      ? 'circle-alert'
                      : 'rotate-ccw'
                }
              />
              <span>{t(`session.draft.inline.${state}`)}</span>
            </span>
            {canRetry ? (
              <button
                type="button"
                className="study-inline-save-retry"
                aria-label={t('session.draft.retry')}
                onClick={onRetry}
              >
                {t('session.draft.retryShort')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
