import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker } from 'react-router'
import type { ReactElement } from 'react'
import { updateWrongNoteMemoBodySchema } from '@nihongo/contracts/wrong-note/update-wrong-note-memo'
import { userMemoMaximumCodePoints } from '@nihongo/contracts/wrong-note/user-memo'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { Textarea } from '@common/components/Textarea'
import type { useGetWrongNoteMemo } from '@app/wrong-note/hooks/useGetWrongNoteMemo'
import { useUpdateWrongNoteMemo } from '@app/wrong-note/hooks/useUpdateWrongNoteMemo'
import { isOfflineApiError } from '@util/apiError'

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
  const memoMutation = useUpdateWrongNoteMemo(questionId)
  const [draftText, setDraftText] = useState('')
  const [baselineText, setBaselineText] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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

  const saveMemo = (value: string | null): void => {
    const parsed = updateWrongNoteMemoBodySchema.safeParse({ memo: value })
    if (!parsed.success || memoMutation.isPending) {
      textareaRef.current?.focus()
      return
    }
    setSavedMessage('')
    memoMutation.mutate(parsed.data, {
      onSuccess: (memo) => {
        const nextText = memo?.text ?? ''
        setDraftText(nextText)
        setBaselineText(nextText)
        setSavedMessage(memo ? '메모를 저장했습니다.' : '메모를 삭제했습니다.')
      }
    })
  }

  if (memoQuery.isPending) {
    if (isMemoQueryPaused) {
      return (
        <p className="text-sm font-semibold text-amber-900" role="status">
          오프라인에서는 메모를 불러올 수 없습니다. 연결되면 자동으로 다시
          불러옵니다.
        </p>
      )
    }
    return (
      <p className="text-sm font-semibold text-muted" role="status">
        메모를 불러오고 있습니다…
      </p>
    )
  }

  if (memoQuery.isError && memoQuery.data === undefined) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        role="alert"
      >
        <p>메모를 불러오지 못했습니다.</p>
        <Button
          className="mt-3"
          size="sm"
          onClick={() => {
            shouldFocusAfterRetryRef.current = true
            void memoQuery.refetch()
          }}
        >
          다시 시도
        </Button>
      </div>
    )
  }

  const validationError = validation.success
    ? undefined
    : validation.error.issues[0]?.message

  return (
    <>
      {isMemoQueryPaused ? (
        <p
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950"
          role="status"
        >
          오프라인입니다. 현재 저장된 메모를 표시하며 연결되면 서버 상태를 다시
          확인합니다.
        </p>
      ) : null}
      {memoQuery.isError ? (
        <div
          className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p>
            메모의 최신 상태를 확인하지 못했습니다. 작성 중인 입력은 유지됩니다.
          </p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => {
              shouldFocusAfterRetryRef.current = true
              void memoQuery.refetch()
            }}
          >
            메모 다시 확인
          </Button>
        </div>
      ) : null}
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          saveMemo(draftText)
        }}
      >
        <Textarea
          ref={textareaRef}
          name="wrong-note-memo"
          label="나의 메모"
          rows={7}
          value={draftText}
          error={validationError}
          hint={`trim 후 Unicode 문자 ${codePointCount.toLocaleString('ko-KR')}/${userMemoMaximumCodePoints.toLocaleString('ko-KR')}자 · 메모는 자동 저장되지 않습니다.`}
          disabled={disabled || memoMutation.isPending}
          onChange={(event) => {
            setDraftText(event.currentTarget.value)
            setSavedMessage('')
            if (memoMutation.isError) memoMutation.reset()
          }}
        />
        {memoMutation.isError ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"
            role="alert"
          >
            {isOfflineApiError(memoMutation.error)
              ? '오프라인에서는 메모를 저장할 수 없습니다. 입력은 유지됩니다. 연결 후 다시 시도해 주세요.'
              : '메모를 저장하지 못했습니다. 입력은 유지됩니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'}
          </p>
        ) : null}
        <p
          className="min-h-6 text-sm font-semibold text-emerald-800"
          aria-live="polite"
        >
          {savedMessage}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            isLoading={memoMutation.isPending}
            loadingLabel="저장 중…"
            disabled={disabled || !isDirty || !validation.success}
          >
            메모 저장
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !isDirty || memoMutation.isPending}
            onClick={() => {
              setDraftText(baselineText)
              setSavedMessage('변경 내용을 취소했습니다.')
              memoMutation.reset()
              textareaRef.current?.focus()
            }}
          >
            변경 취소
          </Button>
          <Button
            variant="danger"
            disabled={
              disabled || baselineText.length === 0 || memoMutation.isPending
            }
            onClick={() => saveMemo(null)}
          >
            메모 삭제
          </Button>
        </div>
      </form>

      <Dialog
        open={blocker.state === 'blocked'}
        fallbackFocusRef={textareaRef}
        title="저장하지 않은 메모가 있습니다"
        description="이 페이지를 나가면 작성 중인 메모가 사라집니다."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (blocker.state === 'blocked') blocker.reset()
              }}
            >
              계속 작성
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (blocker.state === 'blocked') blocker.proceed()
              }}
            >
              변경사항 버리기
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
