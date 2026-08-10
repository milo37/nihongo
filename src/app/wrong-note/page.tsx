import { useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type {
  JlptLevel,
  QuestionSubject,
  WrongNoteStatus
} from '@common/types/domain'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Pagination } from '@common/components/Pagination'
import { Select } from '@common/components/Select'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { useListWrongNotes } from '@app/wrong-note/hooks/useListWrongNotes'
import { useAppStore } from '@store/index'

const levelValues: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
const subjectValues: QuestionSubject[] = ['VOCABULARY', 'GRAMMAR', 'READING']
const statusValues: WrongNoteStatus[] = ['NEW', 'REVIEWING', 'AGAIN', 'SOLVED']
const sortValues = ['RECENT', 'MOST_WRONG', 'OLDEST'] as const

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const
const statusLabels = {
  NEW: '새 오답',
  REVIEWING: '복습 중',
  AGAIN: '다시 학습',
  SOLVED: '해결'
} as const
const statusVariants = {
  NEW: 'info',
  REVIEWING: 'warning',
  AGAIN: 'danger',
  SOLVED: 'success'
} as const
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
})

const isValue = <T extends string>(
  value: string | null,
  values: readonly T[]
): value is T => {
  return value !== null && values.includes(value as T)
}

const formatDate = (isoDate: string): string => {
  return dateFormatter.format(new Date(isoDate))
}

export const WrongNotePage = (): ReactElement => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const levelParam = searchParams.get('level')
  const subjectParam = searchParams.get('subject')
  const statusParam = searchParams.get('status')
  const sortParam = searchParams.get('sort')
  const level = isValue(levelParam, levelValues) ? levelParam : undefined
  const subject = isValue(subjectParam, subjectValues)
    ? subjectParam
    : undefined
  const status = isValue(statusParam, statusValues) ? statusParam : undefined
  const sort = isValue(sortParam, sortValues) ? sortParam : 'RECENT'
  const tag = searchParams.get('tag') || undefined
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = 12
  const wrongNotesQuery = useListWrongNotes({
    level,
    subject,
    status,
    tag,
    sort,
    page,
    pageSize
  })
  const createSession = useCreateStudySession()
  const totalPages = wrongNotesQuery.data
    ? Math.max(
        1,
        Math.ceil(wrongNotesQuery.data.total / wrongNotesQuery.data.pageSize)
      )
    : 1
  const isOutOfRangePage = Boolean(
    wrongNotesQuery.data &&
      wrongNotesQuery.data.total > 0 &&
      wrongNotesQuery.data.items.length === 0
  )

  useEffect(() => {
    if (!isOutOfRangePage || page <= totalPages) {
      return
    }

    const nextParams = new URLSearchParams(searchParams)
    if (totalPages === 1) {
      nextParams.delete('page')
    } else {
      nextParams.set('page', String(totalPages))
    }
    setSearchParams(nextParams, { replace: true })
  }, [isOutOfRangePage, page, searchParams, setSearchParams, totalPages])

  const setFilter = (key: string, value: string): void => {
    const nextParams = new URLSearchParams(searchParams)
    if (value) {
      nextParams.set(key, value)
    } else {
      nextParams.delete(key)
    }
    if (key !== 'page') {
      nextParams.delete('page')
    }
    setSearchParams(nextParams)
  }

  const retryQuestion = (
    questionId: string,
    levelValue: JlptLevel,
    subjectValue: QuestionSubject
  ): void => {
    createSession.mutate(
      {
        level: levelValue,
        subject: subjectValue,
        mode: 'WRONG_NOTE',
        count: 1,
        questionIds: [questionId]
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
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="max-w-3xl">
        <p className="text-sm font-black tracking-[0.16em] text-brand">
          WRONG NOTE
        </p>
        <h1 className="mt-2 text-4xl font-black">
          오답을 해결 상태까지 관리하세요
        </h1>
        <p className="mt-4 leading-7 text-muted">
          처음 틀린 문제부터 두 번 연속 맞힌 문제까지 복습 상태와 횟수를
          한곳에서 확인합니다.
        </p>
      </div>

      <div className="mt-8 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          name="level"
          label="급수"
          value={level ?? ''}
          onChange={(event) => setFilter('level', event.currentTarget.value)}
        >
          <option value="">전체 급수</option>
          {levelValues.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          name="subject"
          label="과목"
          value={subject ?? ''}
          onChange={(event) => setFilter('subject', event.currentTarget.value)}
        >
          <option value="">전체 과목</option>
          {subjectValues.map((value) => (
            <option key={value} value={value}>
              {subjectLabels[value]}
            </option>
          ))}
        </Select>
        <Select
          name="status"
          label="상태"
          value={status ?? ''}
          onChange={(event) => setFilter('status', event.currentTarget.value)}
        >
          <option value="">전체 상태</option>
          {statusValues.map((value) => (
            <option key={value} value={value}>
              {statusLabels[value]}
            </option>
          ))}
        </Select>
        <Select
          name="tag"
          label="태그"
          value={tag ?? ''}
          onChange={(event) => setFilter('tag', event.currentTarget.value)}
        >
          <option value="">전체 태그</option>
          {(wrongNotesQuery.data?.availableTags ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          name="sort"
          label="정렬"
          value={sort}
          onChange={(event) => setFilter('sort', event.currentTarget.value)}
        >
          <option value="RECENT">최근 오답순</option>
          <option value="MOST_WRONG">많이 틀린 순</option>
          <option value="OLDEST">오래된 순</option>
        </Select>
      </div>

      {wrongNotesQuery.isPending ? (
        <LoadingState message="오답노트를 불러오고 있습니다." />
      ) : null}

      {wrongNotesQuery.isError ? (
        <ErrorState
          title="오답노트를 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          action={
            <Button onClick={() => void wrongNotesQuery.refetch()}>
              다시 시도
            </Button>
          }
        />
      ) : null}

      {isOutOfRangePage ? (
        <LoadingState message="유효한 오답노트 페이지로 이동하고 있습니다." />
      ) : null}

      {wrongNotesQuery.data &&
      wrongNotesQuery.data.items.length === 0 &&
      !isOutOfRangePage ? (
        <EmptyState
          title="아직 조건에 맞는 오답이 없습니다"
          description="문제를 풀고 틀린 항목은 자동으로 이곳에 저장됩니다."
          action={
            <Link
              className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-bold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              to="/practice"
            >
              첫 문제 풀기
            </Link>
          }
        />
      ) : null}

      {wrongNotesQuery.data && wrongNotesQuery.data.items.length > 0 ? (
        <>
          <div className="mt-7 flex items-center justify-between gap-4">
            <h2 className="text-xl font-black">
              오답 {wrongNotesQuery.data.total}개
            </h2>
            <Button
              variant="ghost"
              onClick={() => setSearchParams(new URLSearchParams())}
            >
              필터 초기화
            </Button>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {wrongNotesQuery.data.items.map(({ wrongNote, question }) => (
              <article
                key={wrongNote.id}
                className="content-auto flex flex-col rounded-xl border border-line bg-white p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="brand">{question.level}</Badge>
                    <Badge>{subjectLabels[question.subject]}</Badge>
                    <Badge variant={statusVariants[wrongNote.status]}>
                      {statusLabels[wrongNote.status]}
                    </Badge>
                  </div>
                  <span className="text-sm font-bold text-red-700">
                    {wrongNote.wrongCount}회 오답
                  </span>
                </div>
                <h3 className="mt-5 line-clamp-2 text-lg font-black leading-7">
                  {question.questionText}
                </h3>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted">문제 유형</dt>
                    <dd className="mt-1 font-semibold">
                      {question.questionType}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">마지막 오답</dt>
                    <dd className="mt-1 font-semibold">
                      {formatDate(wrongNote.lastWrongAt)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  {question.tags.map((item) => (
                    <Badge key={item}>{item}</Badge>
                  ))}
                </div>
                <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
                  <Button
                    variant="outline"
                    isLoading={createSession.isPending}
                    onClick={() =>
                      retryQuestion(
                        question.id,
                        question.level,
                        question.subject
                      )
                    }
                  >
                    재풀이
                  </Button>
                  <Link
                    className="inline-flex min-h-11 items-center rounded-lg bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
                    to={`/wrong-notes/${question.id}`}
                  >
                    상세 보기
                  </Link>
                </div>
              </article>
            ))}
          </div>
          <Pagination
            className="mt-8"
            currentPage={wrongNotesQuery.data.page}
            totalPages={totalPages}
            onPageChange={(nextPage) => setFilter('page', String(nextPage))}
          />
        </>
      ) : null}
    </section>
  )
}
