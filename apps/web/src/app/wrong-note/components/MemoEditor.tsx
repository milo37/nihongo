import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBlocker } from 'react-router'
import type { ReactElement } from 'react'
import { updateWrongNoteMemoBodySchema } from '@nihongo/contracts/wrong-note/update-wrong-note-memo'
import { userMemoMaximumCodePoints } from '@nihongo/contracts/wrong-note/user-memo'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { Textarea } from '@common/components/Textarea'
import type { useGetWrongNoteMemo } from '@app/wrong-note/hooks/useGetWrongNoteMemo'
import { useUpdateWrongNoteMemo } from '@app/wrong-note/hooks/useUpdateWrongNoteMemo'
import { isOfflineApiError } from '@libs/apiError'
import { resolveUiLocale } from '@/i18n/types'
import { formatNumber } from '@libs/localeFormatters'

type MemoStatusCode = 'saved' | 'deleted' | 'cancelled'
type DeleteDialogTrigger = 'save' | 'delete'

type MemoEditorProps = {
  disabled?: boolean
  memoQuery: ReturnType<typeof useGetWrongNoteMemo>
  onDirtyChange?: (isDirty: boolean) => void
  questionId: string
}

export const MemoEditor = ({
  disabled = false,
  memoQuery,
  onDirtyChange,
  questionId
}: MemoEditorProps): ReactElement => {
  const { i18n, t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const memoMutation = useUpdateWrongNoteMemo(questionId)
  const [draftText, setDraftText] = useState('')
  const [baselineText, setBaselineText] = useState('')
  const [savedMessage, setSavedMessage] = useState<MemoStatusCode | null>(null)
  const [deleteDialogTrigger, setDeleteDialogTrigger] =
    useState<DeleteDialogTrigger | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const shouldCloseDeleteDialogAfterMutationRef = useRef(false)
  const shouldFocusAfterRetryRef = useRef(false)
  const isDirty = draftText !== baselineText
  const blocker = useBlocker(isDirty)
  const validation = useMemo(
    () => updateWrongNoteMemoBodySchema.safeParse({ memo: draftText }),
    [draftText]
  )
  const codePointCount = [...draftText.trim()].length
  const isMemoQueryPaused = memoQuery.fetchStatus === 'paused'

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    if (!memoQuery.isSuccess || isDirty) return
    const text = memoQuery.data?.text ?? ''
    const timerId = window.setTimeout(() => {
      setDraftText(text)
      setBaselineText(text)
    }, 0)
    return () => window.clearTimeout(timerId)
  }, [isDirty, memoQuery.data, memoQuery.isSuccess])

  useEffect(() => {
    if (!memoQuery.isSuccess || !shouldFocusAfterRetryRef.current) return
    shouldFocusAfterRetryRef.current = false
    textareaRef.current?.focus()
  }, [memoQuery.isSuccess])

  useEffect(() => {
    if (!isDirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    if (isDirty || blocker.state !== 'blocked') return
    blocker.proceed()
  }, [blocker, isDirty])

  useEffect(() => {
    if (
      !shouldCloseDeleteDialogAfterMutationRef.current ||
      memoMutation.isPending ||
      (!memoMutation.isSuccess && !memoMutation.isError)
    ) {
      return
    }
    shouldCloseDeleteDialogAfterMutationRef.current = false
    setDeleteDialogTrigger(null)
  }, [memoMutation.isError, memoMutation.isPending, memoMutation.isSuccess])

  const saveMemo = (value: string | null): void => {
    const parsed = updateWrongNoteMemoBodySchema.safeParse({ memo: value })
    if (!parsed.success || memoMutation.isPending) {
      textareaRef.current?.focus()
      return
    }
    setSavedMessage(null)
    memoMutation.mutate(parsed.data, {
      onSuccess: (memo) => {
        const nextText = memo?.text ?? ''
        setDraftText(nextText)
        setBaselineText(nextText)
        setSavedMessage(memo ? 'saved' : 'deleted')
      }
    })
  }

  const requestMemoSave = (): void => {
    const parsed = updateWrongNoteMemoBodySchema.safeParse({ memo: draftText })
    if (!parsed.success || memoMutation.isPending) {
      textareaRef.current?.focus()
      return
    }
    if (parsed.data.memo === null) {
      if (baselineText.length > 0) {
        setDeleteDialogTrigger('save')
      } else {
        textareaRef.current?.focus()
      }
      return
    }
    saveMemo(parsed.data.memo)
  }

  if (memoQuery.isPending) {
    if (isMemoQueryPaused) {
      return (
        <p className="text-sm font-semibold text-amber-900" role="status">
          {t('memo.loadingOffline')}
        </p>
      )
    }
    return (
      <p className="text-sm font-semibold text-muted" role="status">
        {t('memo.loading')}
      </p>
    )
  }

  if (memoQuery.isError && memoQuery.data === undefined) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        role="alert"
      >
        <p>{t('memo.loadError')}</p>
        <Button
          className="mt-3"
          size="sm"
          onClick={() => {
            shouldFocusAfterRetryRef.current = true
            void memoQuery.refetch()
          }}
        >
          {commonT('actions.retry')}
        </Button>
      </div>
    )
  }

  const validationError = validation.success
    ? undefined
    : draftText.includes('\u0000')
      ? t('memo.validation.nul')
      : codePointCount > userMemoMaximumCodePoints
        ? t('memo.validation.tooLong', {
            maximum: formatNumber(userMemoMaximumCodePoints, locale)
          })
        : t('memo.validation.invalidUnicode')

  return (
    <>
      {isMemoQueryPaused ? (
        <p
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950"
          role="status"
        >
          {t('memo.cachedOffline')}
        </p>
      ) : null}
      {memoQuery.isError ? (
        <div
          className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p>{t('memo.stale')}</p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => {
              shouldFocusAfterRetryRef.current = true
              void memoQuery.refetch()
            }}
          >
            {t('memo.retryStale')}
          </Button>
        </div>
      ) : null}
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          requestMemoSave()
        }}
      >
        <Textarea
          ref={textareaRef}
          name="wrong-note-memo"
          label={t('memo.label')}
          rows={7}
          value={draftText}
          error={validationError}
          hint={t('memo.hint', {
            current: formatNumber(codePointCount, locale),
            maximum: formatNumber(userMemoMaximumCodePoints, locale)
          })}
          disabled={disabled || memoMutation.isPending}
          onChange={(event) => {
            setDraftText(event.currentTarget.value)
            setSavedMessage(null)
            if (memoMutation.isError) memoMutation.reset()
          }}
        />
        {memoMutation.isError ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"
            role="alert"
          >
            {isOfflineApiError(memoMutation.error)
              ? t('memo.saveOffline')
              : t('memo.saveError')}
          </p>
        ) : null}
        <p
          className="min-h-6 text-sm font-semibold text-emerald-800"
          aria-live="polite"
        >
          {savedMessage ? t(`memo.${savedMessage}`) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            ref={saveButtonRef}
            type="submit"
            isLoading={memoMutation.isPending}
            loadingLabel={t('memo.saving')}
            disabled={
              disabled ||
              !isDirty ||
              !validation.success ||
              (validation.data.memo === null && baselineText.length === 0)
            }
          >
            {t('memo.save')}
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !isDirty || memoMutation.isPending}
            onClick={() => {
              setDraftText(baselineText)
              setSavedMessage('cancelled')
              memoMutation.reset()
              textareaRef.current?.focus()
            }}
          >
            {t('memo.cancel')}
          </Button>
          <Button
            ref={deleteButtonRef}
            variant="danger"
            disabled={
              disabled || baselineText.length === 0 || memoMutation.isPending
            }
            onClick={() => setDeleteDialogTrigger('delete')}
          >
            {t('memo.delete')}
          </Button>
        </div>
      </form>

      <Dialog
        open={deleteDialogTrigger !== null}
        fallbackFocusRef={textareaRef}
        returnFocusRef={
          deleteDialogTrigger === 'save' ? saveButtonRef : deleteButtonRef
        }
        title={t('memo.deleteDialog.title')}
        description={t('memo.deleteDialog.description')}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={memoMutation.isPending}
              onClick={() => {
                shouldCloseDeleteDialogAfterMutationRef.current = false
                setDeleteDialogTrigger(null)
              }}
            >
              {t('memo.deleteDialog.keep')}
            </Button>
            <Button
              variant="danger"
              isLoading={memoMutation.isPending}
              loadingLabel={t('memo.deleting')}
              onClick={() => {
                shouldCloseDeleteDialogAfterMutationRef.current = true
                saveMemo(null)
              }}
            >
              {t('memo.deleteDialog.confirm')}
            </Button>
          </>
        }
        preventClose={memoMutation.isPending}
        onOpenChange={(open) => {
          if (!open && !memoMutation.isPending) {
            shouldCloseDeleteDialogAfterMutationRef.current = false
            setDeleteDialogTrigger(null)
          }
        }}
      />

      <Dialog
        open={blocker.state === 'blocked'}
        fallbackFocusRef={textareaRef}
        title={t('memo.leaveDialog.title')}
        description={t('memo.leaveDialog.description')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (blocker.state === 'blocked') blocker.reset()
              }}
            >
              {t('memo.leaveDialog.continue')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (blocker.state === 'blocked') blocker.proceed()
              }}
            >
              {t('memo.leaveDialog.discard')}
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset()
        }}
      />
    </>
  )
}
