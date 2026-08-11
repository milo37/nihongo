import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router'
import { z } from 'zod'
import type { ReactElement } from 'react'
import type { GetWrongNoteResponse } from '@api/wrong-note/getWrongNote/schema'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
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

const WrongNoteDetailContent = ({
  data
}: WrongNoteDetailContentProps): ReactElement => {
  const navigate = useNavigate()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const updateMemo = useUpdateWrongNoteMemo(data.question.id)
  const createSession = useCreateStudySession()
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty }
  } = useForm<MemoFormValues>({
    resolver: zodResolver(memoSchema),
    defaultValues: { memo: data.wrongNote.memo ?? '' }
  })

  const saveMemo = (values: MemoFormValues): void => {
    updateMemo.mutate({ memo: values.memo.trim() || null })
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
      <h1 className="mt-5 text-3xl font-black leading-tight">오답 상세</h1>

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
              isLoading={createSession.isPending}
              onClick={retryQuestion}
            >
              이 문제 다시 풀기
            </Button>
          </div>

          <form
            className="rounded-xl border border-line bg-white p-5"
            onSubmit={(event) => void handleSubmit(saveMemo)(event)}
          >
            <Textarea
              label="나의 메모"
              hint="헷갈린 이유나 다음에 확인할 포인트를 기록하세요."
              error={errors.memo?.message}
              rows={7}
              {...register('memo')}
            />
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-sm text-muted" aria-live="polite">
                {updateMemo.isSuccess ? '메모를 저장했습니다.' : ''}
              </span>
              <Button
                type="submit"
                disabled={!isDirty}
                isLoading={updateMemo.isPending}
              >
                메모 저장
              </Button>
            </div>
          </form>
        </aside>
      </div>
    </>
  )
}

export const WrongNoteDetailPage = (): ReactElement => {
  const { questionId = '' } = useParams()
  const wrongNoteQuery = useGetWrongNote(questionId)

  if (wrongNoteQuery.isPending) {
    return <LoadingState message="오답 상세를 불러오고 있습니다." />
  }

  if (wrongNoteQuery.isError || !wrongNoteQuery.data) {
    return (
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
    )
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <WrongNoteDetailContent data={wrongNoteQuery.data} />
    </section>
  )
}
