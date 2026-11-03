import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { userMemoMaximumCodePoints } from '@nihongo/contracts/wrong-note/user-memo'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { classNames } from '@nihongo/browser/common/components/classNames'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import {
  formatDateTime,
  formatNumber
} from '@nihongo/browser/libs/localeFormatters'
import { useGetWrongNoteMemo } from '@app/wrong-note/hooks/useGetWrongNoteMemo'
import { useOnlineStatus } from '@app/wrong-note/hooks/useOnlineStatus'
import {
  isWrongNoteMemoConnectionError,
  useUpdateWrongNoteMemo
} from '@app/wrong-note/hooks/useUpdateWrongNoteMemo'

type WrongNoteMemoSectionProps = {
  questionId: string
}

type MemoNotice =
  | 'saved'
  | 'deleted'
  | 'saveError'
  | 'saveOffline'
  | 'deleteError'
  | null

type FocusTarget = 'textarea' | 'trigger' | 'notice' | null

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

const checkIcon = (
  <svg
    aria-hidden="true"
    className="size-4 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const WrongNoteMemoSection = ({
  questionId
}: WrongNoteMemoSectionProps): ReactElement => {
  const { i18n, t } = useTranslation('wrongNote')
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
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const pendingFocusRef = useRef<FocusTarget>(null)
  const headingId = useId()
  const textareaId = useId()
  const countId = useId()

  useEffect(() => {
    const focusTarget = pendingFocusRef.current
    if (!focusTarget) return
    pendingFocusRef.current = null
    const target = {
      textarea: textareaRef,
      trigger: triggerRef,
      notice: noticeRef
    }[focusTarget].current
    target?.focus()
  })

  const memo = memoQuery.data ?? null
  const normalizedDraft = draft.trim()
  const draftLength = [...normalizedDraft].length
  const excess = draftLength - userMemoMaximumCodePoints
  const isOver = excess > 0
  const isSaving = updateMemo.isPending && updateMemo.variables?.memo !== null
  const isDeleting = updateMemo.isPending && updateMemo.variables?.memo === null
  const count = (value: number): string => formatNumber(value, locale)

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
          setNotice('saved')
          pendingFocusRef.current = 'notice'
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
          setNotice('deleted')
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

  const noticeMessage =
    notice === 'saved' ? (
      <p
        ref={noticeRef}
        className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-success"
        role="status"
        tabIndex={-1}
      >
        {checkIcon}
        {t('memo.saved')}
      </p>
    ) : notice === 'deleted' ? (
      <p className="mt-2 text-sm font-semibold text-success" role="status">
        {t('memo.deleted')}
      </p>
    ) : notice ? (
      <p className="mt-2 text-sm font-semibold text-danger" role="alert">
        {t(`memo.${notice}`)}
      </p>
    ) : null

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
      <>
        <label className="sr-only" htmlFor={textareaId}>
          {t('memo.label')}
        </label>
        <textarea
          ref={textareaRef}
          id={textareaId}
          name="memo"
          className={classNames(
            'min-h-30 w-full resize-y rounded-control border bg-surface px-3 py-2.5 text-base leading-relaxed text-ink',
            'focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand',
            isOver ? 'border-danger' : 'border-line-strong'
          )}
          value={draft}
          aria-invalid={isOver || undefined}
          aria-describedby={countId}
          readOnly={updateMemo.isPending}
          onChange={(event) => setDraft(event.target.value)}
        />
        {noticeMessage}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span
            id={countId}
            className={classNames(
              'text-xs tabular-nums',
              isOver ? 'font-bold text-danger' : 'text-muted'
            )}
          >
            {draftLength === 0 && memo
              ? t('memo.clearHint')
              : isOver
                ? t('memo.over', {
                    current: count(draftLength),
                    maximum: count(userMemoMaximumCodePoints),
                    excess: count(excess)
                  })
                : t('memo.count', {
                    current: count(draftLength),
                    maximum: count(userMemoMaximumCodePoints)
                  })}
          </span>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              className="flex-1 sm:flex-none"
              variant="ghost"
              disabled={updateMemo.isPending}
              onClick={cancelEditing}
            >
              {t('memo.cancel')}
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              disabled={isOver || draftLength === 0}
              isLoading={isSaving}
              loadingLabel={t('memo.saving')}
              onClick={save}
            >
              {notice === 'saveError' || notice === 'saveOffline'
                ? t('memo.retrySave')
                : t('memo.save')}
            </Button>
          </div>
        </div>
      </>
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
