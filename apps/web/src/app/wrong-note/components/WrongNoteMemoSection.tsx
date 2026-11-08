import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@nihongo/browser/common/components/Toast'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatDateTime } from '@nihongo/browser/libs/localeFormatters'
import {
  measureMemoDraft,
  WrongNoteMemoEditor
} from '@app/wrong-note/components/WrongNoteMemoEditor'
import {
  WrongNoteMemoNotice,
  type MemoNotice
} from '@app/wrong-note/components/WrongNoteMemoNotice'
import { useGetWrongNoteMemo } from '@app/wrong-note/hooks/useGetWrongNoteMemo'
import { useOnlineStatus } from '@app/wrong-note/hooks/useOnlineStatus'
import {
  isWrongNoteMemoConnectionError,
  useUpdateWrongNoteMemo
} from '@app/wrong-note/hooks/useUpdateWrongNoteMemo'

type WrongNoteMemoSectionProps = {
  questionId: string
}

type FocusTarget = 'textarea' | 'trigger' | null

const penIcon = (
  <svg
    aria-hidden="true"
    className="size-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
)

export const WrongNoteMemoSection = ({
  questionId
}: WrongNoteMemoSectionProps): ReactElement => {
  const { i18n, t } = useTranslation('wrongNote')
  const { addToast } = useToast()
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const memoQuery = useGetWrongNoteMemo(questionId)
  const updateMemo = useUpdateWrongNoteMemo(questionId)
  const isOnline = useOnlineStatus()
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<MemoNotice>(null)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pendingFocusRef = useRef<FocusTarget>(null)
  const headingId = useId()

  useEffect(() => {
    const focusTarget = pendingFocusRef.current
    if (!focusTarget) return
    pendingFocusRef.current = null
    const target = {
      textarea: textareaRef,
      trigger: triggerRef
    }[focusTarget].current
    target?.focus()
  })

  const memo = memoQuery.data ?? null
  const {
    normalized: normalizedDraft,
    length: draftLength,
    isOver
  } = measureMemoDraft(draft)
  const isSaving = updateMemo.isPending && updateMemo.variables?.memo !== null
  const isDeleting = updateMemo.isPending && updateMemo.variables?.memo === null

  const startEditing = (): void => {
    setDraft(memo?.text ?? '')
    setNotice(null)
    setIsEditing(true)
    pendingFocusRef.current = 'textarea'
  }

  const cancelEditing = (): void => {
    setIsEditing(false)
    setNotice(null)
    pendingFocusRef.current = 'trigger'
  }

  const save = (): void => {
    if (isOver || draftLength === 0 || updateMemo.isPending) return
    if (!isOnline) {
      setNotice('saveOffline')
      textareaRef.current?.focus()
      return
    }
    setNotice(null)
    updateMemo.mutate(
      { memo: normalizedDraft },
      {
        onSuccess: () => {
          setIsEditing(false)
          // Success is a toast (it never takes focus); focus returns to the
          // edit button next to the saved time.
          addToast({
            key: 'memo',
            title: t('memo.saved'),
            variant: 'success'
          })
          pendingFocusRef.current = 'trigger'
        },
        onError: (error) => {
          setNotice(
            isWrongNoteMemoConnectionError(error) ? 'saveOffline' : 'saveError'
          )
          pendingFocusRef.current = 'textarea'
        }
      }
    )
  }

  const confirmDelete = (): void => {
    if (updateMemo.isPending) return
    updateMemo.mutate(
      { memo: null },
      {
        onSuccess: () => {
          setIsDeleteOpen(false)
          addToast({
            key: 'memo',
            title: t('memo.deleted'),
            variant: 'success'
          })
          pendingFocusRef.current = 'trigger'
        },
        onError: () => {
          setIsDeleteOpen(false)
          setNotice('deleteError')
        }
      }
    )
  }

  const heading = (
    <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-2">
      {t('memo.title')}
      <small className="text-xs font-semibold text-muted">
        {t('memo.privateHint')}
      </small>
    </h2>
  )

  const noticeMessage = <WrongNoteMemoNotice notice={notice} />

  const offlineMessage = !isOnline ? (
    <p className="mt-2 text-sm font-semibold text-warning" role="status">
      {t('memo.offline')}
    </p>
  ) : null

  let body: ReactElement

  if (memoQuery.isPending) {
    body =
      memoQuery.fetchStatus === 'paused' ? (
        <p className="text-sm text-muted" role="status">
          {t('memo.loadOffline')}
        </p>
      ) : (
        <LoadingState density="inline" message={t('memo.loading')} />
      )
  } else if (memoQuery.isError && memoQuery.data === undefined) {
    body = (
      <div role="alert">
        <p className="text-sm font-semibold text-danger">
          {t('memo.loadError')}
        </p>
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          onClick={() => void memoQuery.refetch()}
        >
          {t('memo.retryLoad')}
        </Button>
      </div>
    )
  } else if (isEditing) {
    body = (
      <WrongNoteMemoEditor
        draft={draft}
        hasMemo={memo !== null}
        isPending={updateMemo.isPending}
        isSaving={isSaving}
        isRetry={notice === 'saveError' || notice === 'saveOffline'}
        notice={noticeMessage}
        textareaRef={textareaRef}
        onDraftChange={setDraft}
        onCancel={cancelEditing}
        onSave={save}
      />
    )
  } else if (memo) {
    body = (
      <>
        <p className="m-0 whitespace-pre-wrap">{memo.text}</p>
        {noticeMessage}
        {offlineMessage}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted">
            {t('memo.savedAt', {
              time: formatDateTime(memo.updatedAt, locale, {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              })
            })}
          </span>
          <div className="flex gap-2">
            <Button
              ref={triggerRef}
              variant="ghost"
              className="text-link"
              disabled={!isOnline}
              onClick={startEditing}
            >
              {penIcon}
              {t('memo.edit')}
            </Button>
            <Button
              variant="ghost"
              className="text-danger"
              disabled={!isOnline}
              onClick={() => setIsDeleteOpen(true)}
            >
              {t('memo.delete')}
            </Button>
          </div>
        </div>
      </>
    )
  } else {
    body = (
      <>
        <p className="mb-3 mt-0 text-sm text-muted">{t('memo.emptyLead')}</p>
        <Button
          ref={triggerRef}
          variant="outline"
          disabled={!isOnline}
          onClick={startEditing}
        >
          {penIcon}
          {t('memo.write')}
        </Button>
        {noticeMessage}
        {offlineMessage}
      </>
    )
  }

  return (
    <section className="review-explanation" aria-labelledby={headingId}>
      {heading}
      {body}
      <Dialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title={t('memo.deleteDialog.title')}
        description={t('memo.deleteDialog.description')}
        size="sm"
        preventClose={isDeleting}
        className="max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none"
        footer={
          <>
            <Button
              variant="ghost"
              disabled={isDeleting}
              onClick={() => setIsDeleteOpen(false)}
            >
              {t('memo.deleteDialog.cancel')}
            </Button>
            <Button
              variant="danger"
              isLoading={isDeleting}
              loadingLabel={t('memo.deleteDialog.deleting')}
              onClick={confirmDelete}
            >
              {t('memo.deleteDialog.confirm')}
            </Button>
          </>
        }
      />
    </section>
  )
}
