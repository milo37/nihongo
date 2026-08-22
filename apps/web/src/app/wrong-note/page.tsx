import { useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
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
import { useListWrongNotes } from '@app/wrong-note/hooks/useListWrongNotes'
import {
  createWrongNoteHistorySearch,
  parseWrongNoteHistorySearch,
  type WrongNoteHistorySearchKey
} from '@app/wrong-note/wrongNoteHistorySearch'

const levelValues: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
const subjectValues: QuestionSubject[] = ['VOCABULARY', 'GRAMMAR', 'READING']
const statusValues: WrongNoteStatus[] = ['NEW', 'REVIEWING', 'AGAIN', 'SOLVED']
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
const questionTypeLabels = {
  KANJI_READING: '한자 읽기',
  ORTHOGRAPHY: '표기',
  CONTEXT_VOCABULARY: '문맥 어휘',
  PARAPHRASE: '유의 표현',
  WORD_USAGE: '용법',
  GRAMMAR_SELECT: '문법 선택',
  SENTENCE_ORDER: '문장 배열',
  TEXT_GRAMMAR: '글의 문법',
  SHORT_READING: '단문 독해',
  MEDIUM_READING: '중문 독해',
  LONG_READING: '장문 독해',
  INFO_RETRIEVAL: '정보 검색'
} as const
const reviewAvailabilityLabels = {
  AVAILABLE: '현재 출제 가능',
  ARCHIVED: '보관된 문제'
} as const
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
})

const formatDate = (isoDate: string): string => {
  return dateFormatter.format(new Date(isoDate))
}

export const WrongNotePage = (): ReactElement => {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)
  const shouldRestoreRetryFocusRef = useRef(false)
  const shouldFocusResultsRef = useRef(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const parsedSearch = useMemo(
    () => parseWrongNoteHistorySearch(searchParams),
    [searchParams]
  )
  const { level, page, sort, status, subject, tag } = parsedSearch.query
  const returnTo = `/wrong-notes/history${parsedSearch.canonicalSearch ? `?${parsedSearch.canonicalSearch}` : ''}`
  const wrongNotesQuery = useListWrongNotes(parsedSearch.query)
  const totalPages = wrongNotesQuery.data
    ? Math.max(
        1,
        Math.ceil(wrongNotesQuery.data.total / wrongNotesQuery.data.pageSize)
      )
    : 1
  const isOutOfRangePage = Boolean(wrongNotesQuery.data && page > totalPages)
  const availableTags = wrongNotesQuery.data?.availableTags ?? []
  const visibleTags =
    tag && !availableTags.includes(tag)
      ? [tag, ...availableTags]
      : availableTags
  const isWrongNotesPaused = wrongNotesQuery.fetchStatus === 'paused'

  useEffect(() => {
    if (!parsedSearch.needsReplace) return
    shouldFocusResultsRef.current = true
    setSearchParams(parsedSearch.canonicalSearch, { replace: true })
  }, [parsedSearch, setSearchParams])

  useEffect(() => {
    if (!isOutOfRangePage || page <= totalPages) {
      return
    }

    shouldFocusResultsRef.current = true
    setSearchParams(
      createWrongNoteHistorySearch({
        ...parsedSearch.query,
        page: totalPages
      }),
      { replace: true }
    )
  }, [isOutOfRangePage, page, parsedSearch.query, setSearchParams, totalPages])

  useEffect(() => {
    if (
      wrongNotesQuery.isSuccess &&
      wrongNotesQuery.data &&
      shouldRestoreRetryFocusRef.current
    ) {
      shouldRestoreRetryFocusRef.current = false
      headingRef.current?.focus()
    }
  }, [wrongNotesQuery.data, wrongNotesQuery.isSuccess])

  useEffect(() => {
    if (!wrongNotesQuery.isSuccess || !shouldFocusResultsRef.current) return
    shouldFocusResultsRef.current = false
    const focusTarget = resultHeadingRef.current ?? headingRef.current
    focusTarget?.focus()
  }, [wrongNotesQuery.isSuccess, wrongNotesQuery.data])

  const setFilter = (key: WrongNoteHistorySearchKey, value: string): void => {
    const nextParams = createWrongNoteHistorySearch(parsedSearch.query)
    if (value) nextParams.set(key, value)
    else nextParams.delete(key)
    if (key !== 'page') nextParams.delete('page')
    shouldFocusResultsRef.current = true
    setSearchParams(parseWrongNoteHistorySearch(nextParams).canonicalSearch)
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            WRONG NOTE
          </p>
          <h1
            ref={headingRef}
            className="mt-2 rounded-sm text-4xl font-black"
            tabIndex={-1}
          >
            전체 오답 기록
          </h1>
          <p className="mt-4 leading-7 text-muted">
            마지막으로 틀린 문제 버전과 당시 상태를 보존한 historical
            archive입니다.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 font-bold text-ink hover:border-slate-400"
          to="/wrong-notes"
        >
          복습 센터로 돌아가기
        </Link>
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
          {visibleTags.map((value) => (
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

      {isWrongNotesPaused ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950"
          role="status"
        >
          오프라인입니다. 연결이 복구되면 현재 URL 조건으로 전체 오답 기록을
          자동으로 다시 불러옵니다.
        </p>
      ) : null}

      {wrongNotesQuery.isPending && !isWrongNotesPaused ? (
        <LoadingState message="오답노트를 불러오고 있습니다." />
      ) : null}

      {wrongNotesQuery.isError && !wrongNotesQuery.data ? (
        <ErrorState
          title="오답노트를 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          action={
            <Button
              onClick={() => {
                shouldRestoreRetryFocusRef.current = true
                void wrongNotesQuery.refetch()
              }}
            >
              다시 시도
            </Button>
          }
        />
      ) : null}

      {wrongNotesQuery.isError && wrongNotesQuery.data ? (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-semibold">
            전체 오답 기록의 최신 상태를 확인하지 못했습니다. 현재까지 불러온
            기록은 유지됩니다.
          </p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => {
              shouldRestoreRetryFocusRef.current = true
              void wrongNotesQuery.refetch()
            }}
          >
            전체 오답 기록 다시 확인
          </Button>
        </div>
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
            <h2
              ref={resultHeadingRef}
              className="rounded-sm text-xl font-black"
              tabIndex={-1}
            >
              오답 {wrongNotesQuery.data.total}개
            </h2>
            <Button
              variant="ghost"
              onClick={() => {
                shouldFocusResultsRef.current = true
                setSearchParams(new URLSearchParams())
              }}
            >
              필터 초기화
            </Button>
          </div>
          <ul className="mt-4 grid gap-4 lg:grid-cols-2">
            {wrongNotesQuery.data.items.map((item) => (
              <li key={item.questionId}>
                <article className="content-auto flex h-full flex-col rounded-xl border border-line bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="brand">{item.level}</Badge>
                      <Badge>{subjectLabels[item.subject]}</Badge>
                      <Badge variant={statusVariants[item.status]}>
                        {statusLabels[item.status]}
                      </Badge>
                      <Badge
                        variant={
                          item.reviewAvailability === 'ARCHIVED'
                            ? 'neutral'
                            : 'info'
                        }
                      >
                        {reviewAvailabilityLabels[item.reviewAvailability]}
                      </Badge>
                    </div>
                    <span className="text-sm font-bold text-red-700">
                      {item.wrongCount}회 오답
                    </span>
                  </div>
                  <h3 className="mt-5 line-clamp-2 text-lg font-black leading-7">
                    {item.questionPreview}
                  </h3>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted">문제 유형</dt>
                      <dd className="mt-1 font-semibold">
                        {questionTypeLabels[item.questionType]}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">마지막 오답</dt>
                      <dd className="mt-1 font-semibold">
                        {formatDate(item.lastWrongAt)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.tags.map((tagLabel) => (
                      <Badge key={tagLabel}>{tagLabel}</Badge>
                    ))}
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
                    <span className="inline-flex min-h-11 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-bold text-amber-950">
                      {item.reviewAvailability === 'ARCHIVED'
                        ? '보관된 문제 · 재풀이 불가'
                        : '현재 출제 가능 · 상세에서 단일 복습 가능'}
                    </span>
                    <Link
                      className="inline-flex min-h-11 items-center rounded-lg bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
                      to={`/wrong-notes/${item.questionId}?returnTo=${encodeURIComponent(returnTo)}`}
                    >
                      상세 보기
                    </Link>
                  </div>
                </article>
              </li>
            ))}
          </ul>
          <Pagination
            className="mt-8"
            currentPage={wrongNotesQuery.data.page}
            totalPages={totalPages}
            disabled={wrongNotesQuery.isFetching}
            onPageChange={(nextPage) => setFilter('page', String(nextPage))}
          />
        </>
      ) : null}
    </section>
  )
}
