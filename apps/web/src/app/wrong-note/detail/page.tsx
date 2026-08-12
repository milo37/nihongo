import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { z } from 'zod'
import type { ReactElement, RefObject } from 'react'
import { isNotFoundApiError } from '@util/apiError'
import type { GetWrongNoteResponse } from '@api/wrong-note/getWrongNote/schema'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Textarea } from '@common/components/Textarea'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { useGetWrongNote } from '@app/wrong-note/hooks/useGetWrongNote'
import { useUpdateWrongNoteMemo } from '@app/wrong-note/hooks/useUpdateWrongNoteMemo'
import { useAppStore } from '@store/index'

const memoSchema = z.object({
  memo: z.string().max(2000, '메모는 2,000자 이하로 입력해 주세요.')
})

type MemoFormValues = z.infer<typeof memoSchema>

type WrongNoteDetailContentProps = {
  data: GetWrongNoteResponse
  headingRef?: RefObject<HTMLHeadingElement | null>
}

const statusLabels = {
  NEW: '새 오답',
  REVIEWING: '복습 중',
  AGAIN: '다시 학습',
  SOLVED: '해결'
} as const
const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return '기록 없음'
  }

  return dateTimeFormatter.format(new Date(value))
}

export const WrongNoteDetailContent = ({
  data,
  headingRef
}: WrongNoteDetailContentProps): ReactElement => {
  const navigate = useNavigate()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const updateMemo = useUpdateWrongNoteMemo(data.question.id)
  const createSession = useCreateStudySession()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty }
  } = useForm<MemoFormValues>({
    resolver: zodResolver(memoSchema),
    defaultValues: { memo: data.wrongNote.memo ?? '' }
  })
  const shouldBlockNavigation = isDirty && !updateMemo.isPending
  const blocker = useBlocker(shouldBlockNavigation)

  useEffect(() => {
    if (!shouldBlockNavigation) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [shouldBlockNavigation])

  const saveMemo = (values: MemoFormValues): void => {
    updateMemo.mutate(
      { memo: values.memo.trim() || null },
      {
        onSuccess: (response) => {
          reset({ memo: response.wrongNote.memo ?? '' })
        }
      }
    )
  }

  const retryQuestion = (): void => {
    createSession.mutate(
      {
        level: data.question.level,
        subject: data.question.subject,
        mode: 'WRONG_NOTE',
        count: 1,
        questionIds: [data.question.id]
      },
      {
        onSuccess: ({ session }) => {
          beginPractice(session.id, session.startedAt)
          void navigate(`/practice/session/${session.id}`)
        }
      }
    )
  }

  const memoStatus = updateMemo.isPending
    ? '메모를 저장하고 있습니다…'
    : isDirty
      ? '저장하지 않은 변경사항이 있습니다.'
      : updateMemo.isSuccess
        ? '메모를 저장했습니다.'
        : ''

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Badge variant="brand">{data.question.level}</Badge>
        <Badge>{data.question.subject}</Badge>
        <Badge
          variant={data.wrongNote.status === 'SOLVED' ? 'success' : 'warning'}
        >
          {statusLabels[data.wrongNote.status]}
        </Badge>
      </div>
      <h1
        ref={headingRef}
        className="mt-5 rounded-sm text-3xl font-black leading-tight"
        tabIndex={-1}
      >
        오답 상세
      </h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <article className="rounded-xl border border-line bg-white p-5 sm:p-7">
          {data.question.passage ? (
            <div className="mb-6 border-l-4 border-slate-300 bg-slate-50 p-4 leading-8 text-slate-700">
              {data.question.passage}
            </div>
          ) : null}
          <h2 className="text-2xl font-black leading-9">
            {data.question.questionText}
          </h2>
          <ol className="mt-6 space-y-2">
            {data.question.options.map((option) => (
              <li
                key={option.id}
                className={[
                  'flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 py-3',
                  option.isCorrect
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-line'
                ].join(' ')}
              >
                <span>
                  {option.label}. {option.text}
                </span>
                {option.isCorrect ? (
                  <strong className="text-sm text-emerald-800">정답</strong>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="mt-7 border-t border-line pt-6">
            <h3 className="text-lg font-black">해설</h3>
            <p className="mt-3 leading-8 text-slate-700">
              {data.question.explanationKo}
            </p>
            {data.question.explanationJa ? (
              <p className="mt-3 text-sm leading-7 text-muted">
                {data.question.explanationJa}
              </p>
            ) : null}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {data.question.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        </article>

        <aside className="space-y-5">
          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-lg font-black">복습 기록</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted">틀린 횟수</dt>
                <dd className="mt-1 text-xl font-black">
                  {data.wrongNote.wrongCount}회
                </dd>
              </div>
              <div>
                <dt className="text-muted">연속 정답</dt>
                <dd className="mt-1 text-xl font-black">
                  {data.wrongNote.correctStreak}회
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">최근 오답</dt>
                <dd className="mt-1 font-semibold">
                  {formatDateTime(data.wrongNote.lastWrongAt)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">최근 복습</dt>
                <dd className="mt-1 font-semibold">
                  {formatDateTime(data.wrongNote.lastReviewedAt)}
                </dd>
              </div>
            </dl>
            <Button
              className="mt-6 w-full"
              disabled={isDirty || createSession.isPending}
              isLoading={createSession.isPending}
              onClick={retryQuestion}
            >
              이 문제 다시 풀기
            </Button>
            {isDirty ? (
              <p
                className="mt-3 text-sm leading-6 text-amber-800"
                role="status"
              >
                재풀이 전에 메모를 저장하거나 변경사항을 되돌려 주세요.
              </p>
            ) : null}
          </div>

          <form
            className="rounded-xl border border-line bg-white p-5"
            aria-busy={updateMemo.isPending}
            onSubmit={(event) => void handleSubmit(saveMemo)(event)}
          >
            <Textarea
              label="나의 메모"
              hint="헷갈린 이유나 다음에 확인할 포인트를 기록하세요."
              error={errors.memo?.message}
              rows={7}
              disabled={updateMemo.isPending}
              {...register('memo')}
            />
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-sm text-muted" aria-live="polite">
                {memoStatus}
              </span>
              <Button
                type="submit"
                disabled={!isDirty || updateMemo.isPending}
                isLoading={updateMemo.isPending}
                loadingLabel="메모 저장 중…"
              >
                메모 저장
              </Button>
            </div>
          </form>
        </aside>
      </div>

      <Dialog
        open={blocker.state === 'blocked'}
        title="저장하지 않은 메모를 버리시겠습니까?"
        description="이 페이지를 나가면 작성 중인 메모를 복구할 수 없습니다."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (blocker.state === 'blocked') {
                  blocker.reset()
                }
              }}
            >
              계속 작성
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (blocker.state === 'blocked') {
                  blocker.proceed()
                }
              }}
            >
              변경사항 버리기
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') {
            blocker.reset()
          }
        }}
      />
    </>
  )
}

export const WrongNoteDetailPage = (): ReactElement => {
  const { questionId = '' } = useParams()
  const wrongNoteQuery = useGetWrongNote(questionId)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shouldRestoreRetryFocusRef = useRef(false)

  useEffect(() => {
    if (
      wrongNoteQuery.isSuccess &&
      wrongNoteQuery.data &&
      shouldRestoreRetryFocusRef.current
    ) {
      shouldRestoreRetryFocusRef.current = false
      headingRef.current?.focus()
    }
  }, [wrongNoteQuery.data, wrongNoteQuery.isSuccess])

  if (wrongNoteQuery.isPending) {
    return <LoadingState message="오답 상세를 불러오고 있습니다." />
  }

  if (wrongNoteQuery.isError && isNotFoundApiError(wrongNoteQuery.error)) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <ErrorState
          headingLevel={1}
          title="오답을 찾을 수 없습니다"
          description="삭제되었거나 현재 계정에 저장되지 않은 문제입니다."
          action={
            <Link
              className="font-bold text-brand underline hover:no-underline"
              to="/wrong-notes"
            >
              오답노트로 돌아가기
            </Link>
          }
        />
      </section>
    )
  }

  if (wrongNoteQuery.isError || !wrongNoteQuery.data) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <ErrorState
          headingLevel={1}
          title="오답 상세를 불러오지 못했습니다"
          description="네트워크 상태를 확인한 뒤 다시 시도해 주세요."
          onRetry={() => {
            shouldRestoreRetryFocusRef.current = true
            void wrongNoteQuery.refetch()
          }}
        />
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <WrongNoteDetailContent
        data={wrongNoteQuery.data}
        headingRef={headingRef}
      />
    </section>
  )
}
