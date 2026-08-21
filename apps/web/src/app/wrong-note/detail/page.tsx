import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import { isNotFoundApiError } from '@util/apiError'
import { Badge } from '@common/components/Badge'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import { useGetWrongNote } from '@app/wrong-note/hooks/useGetWrongNote'

type WrongNoteDetailContentProps = {
  data: WrongNoteDetailView
  headingRef?: RefObject<HTMLHeadingElement | null>
}

const statusLabels = {
  NEW: '새 오답',
  REVIEWING: '복습 중',
  AGAIN: '다시 학습',
  SOLVED: '해결'
} as const
const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const
const reviewAvailabilityLabels = {
  AVAILABLE: '현재 출제 가능',
  ARCHIVED: '보관된 문제'
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
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Badge variant="brand">{data.question.level}</Badge>
        <Badge>{subjectLabels[data.question.subject]}</Badge>
        <Badge
          variant={data.wrongNote.status === 'SOLVED' ? 'success' : 'warning'}
        >
          {statusLabels[data.wrongNote.status]}
        </Badge>
        <Badge
          variant={
            data.wrongNote.reviewAvailability === 'ARCHIVED'
              ? 'neutral'
              : 'info'
          }
        >
          {reviewAvailabilityLabels[data.wrongNote.reviewAvailability]}
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
            <div
              className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950"
              role="status"
            >
              {data.wrongNote.reviewAvailability === 'ARCHIVED' ? (
                '보관된 문제: 현재 출제 가능한 문제 버전이 없습니다.'
              ) : (
                <>
                  이 문제를 포함한 복습은 학습 설정의 오답 문제 모드에서 시작할
                  수 있습니다.{' '}
                  <Link
                    className="inline-flex min-h-11 items-center px-1 font-bold underline underline-offset-2 hover:no-underline"
                    to="/practice"
                  >
                    학습 설정으로 이동
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-lg font-black">나의 메모</h2>
            {data.memo ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {data.memo}
              </p>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted">
                마지막 오답 당시 문제와 해설을 표시하고 있습니다. 현재 canonical
                API에서는 메모 작성과 수정을 지원하지 않습니다.
              </p>
            )}
          </div>
        </aside>
      </div>
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
              className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
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
