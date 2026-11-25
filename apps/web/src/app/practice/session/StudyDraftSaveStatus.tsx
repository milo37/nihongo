import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { PracticeDraftStatusCode } from '@app/practice/draft/practiceDraftModel'
import { useToast } from '@nihongo/browser/common/components/Toast'

type StudyDraftSaveStatusProps = {
  status: PracticeDraftStatusCode | null
  onRetry: () => void
}

// #1262: no line under the options. Saving stays quiet; a failure is a
// toast that stays until it saves (a new failure brings it back), offline
// joins the one connection toast, and a save after a failure says so.
export const StudyDraftSaveStatus = ({
  status,
  onRetry
}: StudyDraftSaveStatusProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const { addToast, dismissToast } = useToast()
  const failedRef = useRef(false)
  const toastIdRef = useRef<string | null>(null)
  const retryRef = useRef(onRetry)
  useEffect(() => {
    retryRef.current = onRetry
  }, [onRetry])
  useEffect(() => {
    if (status === 'error') {
      failedRef.current = true
      toastIdRef.current = addToast({
        key: 'draft-save',
        title: t('session.draft.status.error'),
        variant: 'warning',
        persistent: true,
        action: {
          label: commonT('actions.retry'),
          onClick: () => retryRef.current()
        }
      })
    } else if (status === 'offline') {
      failedRef.current = true
      addToast({
        key: 'connection',
        title: t('session.draft.status.offline'),
        variant: 'warning',
        persistent: true
      })
    } else if (status === 'reconciled') {
      addToast({
        key: 'draft-save',
        title: t('session.draft.inline.reconciled'),
        variant: 'info',
        persistent: false,
        action: undefined
      })
    } else if (
      failedRef.current &&
      (status === 'synced' || status === 'savedAt' || status === 'saved')
    ) {
      failedRef.current = false
      addToast({
        key: 'draft-save',
        title: t('session.draft.status.saved'),
        variant: 'success',
        persistent: false,
        action: undefined
      })
    }
  }, [retryRef, status, addToast, t, commonT])
  // The failure toast belongs to this session; leaving takes it away.
  useEffect(
    () => () => {
      if (toastIdRef.current) dismissToast(toastIdRef.current)
    },
    [dismissToast]
  )
  // Hidden: the current state for tests and tools, nothing on screen.
  return <div hidden data-save-state={status ?? 'detailed'} />
}
