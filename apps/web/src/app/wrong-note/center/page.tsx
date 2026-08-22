import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type { ParsedListReviewQueueQuery } from '@nihongo/contracts/wrong-note/list-review-queue'
import { LEVELS, QUESTION_TYPES, SUBJECTS } from '@common/types/domain'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Pagination } from '@common/components/Pagination'
import { Select } from '@common/components/Select'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useListReviewQueue } from '@app/wrong-note/hooks/useListReviewQueue'
import {
  createReviewQueueSearch,
  parseReviewQueueSearch
} from '@app/wrong-note/reviewQueueSearch'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'
import {
  isNoEligibleQuestionsApiError,
  isOfflineApiError
} from '@util/apiError'

const viewOptions = [
  { value: 'DUE', label: '복습 예정', countKey: 'due' },
  { value: 'UNREVIEWED', label: '아직 복습 전', countKey: 'unreviewed' },
  { value: 'REPEATED', label: '반복 오답', countKey: 'repeated' },
  { value: 'SOLVED', label: '해결', countKey: 'solved' }
] as const
const batchCounts = [5, 10, 20] as const
const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
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
const statusLabels = {
  NEW: '새 오답',
  AGAIN: '다시 학습',
  REVIEWING: '복습 중',
  SOLVED: '해결'
} as const
const statusVariants = {
  NEW: 'info',
  AGAIN: 'danger',
  REVIEWING: 'warning',
  SOLVED: 'success'
} as const
const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

export const WrongNoteReviewCenterPage = (): ReactElement => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const parsedSearch = useMemo(
    () => parseReviewQueueSearch(searchParams),
    [searchParams]
  )
  const queueQuery = useListReviewQueue(parsedSearch.query)
  const createSession = useCreateStudySession()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const [batchCount, setBatchCount] = useState<(typeof batchCounts)[number]>(10)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)
  const shouldFocusResultsRef = useRef(false)
  const shouldFocusRetryRef = useRef(false)
  const batchRequestContext = `${parsedSearch.canonicalSearch}|${batchCount}`
  const previousBatchRequestContextRef = useRef(batchRequestContext)

  useEffect(() => {
    if (!parsedSearch.needsReplace) return
    shouldFocusResultsRef.current = true
    setSearchParams(parsedSearch.canonicalSearch, { replace: true })
  }, [parsedSearch.canonicalSearch, parsedSearch.needsReplace, setSearchParams])

  useEffect(() => {
    if (!queueQuery.isSuccess || !queueQuery.data) return
    if (shouldFocusRetryRef.current) {
      shouldFocusRetryRef.current = false
      shouldFocusResultsRef.current = false
      headingRef.current?.focus()
    } else if (shouldFocusResultsRef.current) {
      shouldFocusResultsRef.current = false
      resultHeadingRef.current?.focus()
    }
  }, [queueQuery.data, queueQuery.isSuccess])

  useEffect(() => {
    if (!queueQuery.data) return
    const totalPages = Math.max(
      1,
      Math.ceil(queueQuery.data.total / queueQuery.data.pageSize)
    )
    if (parsedSearch.query.page <= totalPages) return
    shouldFocusResultsRef.current = true
    const next = createReviewQueueSearch({
      ...parsedSearch.query,
      page: totalPages
    })
    setSearchParams(next, { replace: true })
  }, [parsedSearch.query, queueQuery.data, setSearchParams])

  useEffect(() => {
    if (previousBatchRequestContextRef.current === batchRequestContext) return
    if (createSession.isPending) return
    previousBatchRequestContextRef.current = batchRequestContext
    createSession.reset()
  }, [batchRequestContext, createSession])

  const setQueryValue = (
    key: keyof ParsedListReviewQueueQuery,
    value: string | number | undefined
  ): void => {
    const next = {
      ...parsedSearch.query,
      [key]: value,
      ...(key === 'page' ? {} : { page: 1 })
    }
    shouldFocusResultsRef.current = true
    setSearchParams(createReviewQueueSearch(next))
  }

  const totalPages = queueQuery.data
    ? Math.max(1, Math.ceil(queueQuery.data.total / queueQuery.data.pageSize))
    : 1
  const isOutOfRangePage = Boolean(
    queueQuery.data && parsedSearch.query.page > totalPages
  )
  const isPageCorrectionPending = isOutOfRangePage
  const canOfferBatch =
    !isPageCorrectionPending &&
    (queueQuery.data?.total ?? 0) > 0 &&
    parsedSearch.query.view === 'DUE' &&
    parsedSearch.query.level !== undefined &&
    parsedSearch.query.subject !== undefined
  const canStartBatch = canOfferBatch && !queueQuery.isError

  const handleBatchStart = (): void => {
    const { level, questionType, subject, tag } = parsedSearch.query
    if (!canStartBatch || !level || !subject || createSession.isPending) return

    const reviewFilter = {
      ...(questionType ? { questionType } : {}),
      ...(tag ? { tag } : {})
    }
    createSession.mutate(
      {
        level,
        subject,
        mode: 'DAILY_REVIEW',
        count: batchCount,
        ...(Object.keys(reviewFilter).length > 0 ? { reviewFilter } : {})
      },
      {
        onSuccess: ({ session }, input) => {
          assertCurrentCreateStudySessionAction(input)
          beginPractice(session.id, session.startedAt)
          void navigate(`/practice/session/${session.id}`)
        },
        onError: (error) => {
          if (isAuthTransitionSupersededError(error)) return
        }
      }
    )
  }

  const counts = queueQuery.data?.counts
  const availableTags = queueQuery.data?.availableTags ?? []
  const visibleTags =
    parsedSearch.query.tag && !availableTags.includes(parsedSearch.query.tag)
      ? [parsedSearch.query.tag, ...availableTags]
      : availableTags
  const isQueuePaused = queueQuery.fetchStatus === 'paused'
  const returnTo = `/wrong-notes${parsedSearch.canonicalSearch ? `?${parsedSearch.canonicalSearch}` : ''}`

  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
      <div className="flex flex-col gap-5 border-b border-line pb-7 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            REVIEW CENTER
          </p>
          <h1
            ref={headingRef}
            className="mt-2 rounded-sm text-3xl font-black sm:text-4xl"
            tabIndex={-1}
          >
            지금 복습할 오답을 확인하세요
          </h1>
          <p className="mt-3 leading-7 text-muted">
            서버 복습 일정과 현재 출제 가능한 문제 버전을 기준으로 정렬합니다.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 font-bold text-ink hover:border-slate-400"
          to="/wrong-notes/history"
        >
          전체 오답 기록
        </Link>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {viewOptions.map((option) => (
          <button
            key={option.value}
            className={[
              'min-h-20 rounded-xl border p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              parsedSearch.query.view === option.value
                ? 'border-brand bg-emerald-50'
                : 'border-line bg-white hover:border-slate-400'
            ].join(' ')}
            type="button"
            aria-pressed={parsedSearch.query.view === option.value}
            onClick={() => setQueryValue('view', option.value)}
          >
            <span className="block text-sm font-bold text-muted">
              {option.label}
            </span>
            <strong className="mt-1 block text-2xl text-ink">
              {counts?.[option.countKey] ?? '—'}
            </strong>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2 xl:grid-cols-5">
        <Select
          name="review-level"
          label="급수"
          value={parsedSearch.query.level ?? ''}
          onChange={(event) =>
            setQueryValue('level', event.currentTarget.value || undefined)
          }
        >
          <option value="">전체 급수</option>
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </Select>
        <Select
          name="review-subject"
          label="과목"
          value={parsedSearch.query.subject ?? ''}
          onChange={(event) =>
            setQueryValue('subject', event.currentTarget.value || undefined)
          }
        >
          <option value="">전체 과목</option>
          {SUBJECTS.map((subject) => (
            <option key={subject} value={subject}>
              {subjectLabels[subject]}
            </option>
          ))}
        </Select>
        <Select
          name="review-question-type"
          label="문제 유형"
          value={parsedSearch.query.questionType ?? ''}
          onChange={(event) =>
            setQueryValue(
              'questionType',
              event.currentTarget.value || undefined
            )
          }
        >
          <option value="">전체 유형</option>
          {QUESTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {questionTypeLabels[type]}
            </option>
          ))}
        </Select>
        <Select
          name="review-tag"
          label="태그"
          value={parsedSearch.query.tag ?? ''}
          onChange={(event) =>
            setQueryValue('tag', event.currentTarget.value || undefined)
          }
        >
          <option value="">전체 태그</option>
          {visibleTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </Select>
        <Select
          name="review-sort"
          label="정렬"
          value={parsedSearch.query.sort}
          onChange={(event) => setQueryValue('sort', event.currentTarget.value)}
        >
          <option value="NEXT_REVIEW">다음 복습순</option>
          <option value="MOST_WRONG">많이 틀린 순</option>
          <option value="RECENT">최근 오답순</option>
        </Select>
      </div>

      {canOfferBatch ? (
        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-end sm:justify-between">
          <Select
            className="sm:w-44"
            name="review-batch-count"
            label="묶음 문제 수"
            value={String(batchCount)}
            onChange={(event) =>
              setBatchCount(Number(event.currentTarget.value) as 5 | 10 | 20)
            }
          >
            {batchCounts.map((count) => (
              <option key={count} value={count}>
                {count}문제
              </option>
            ))}
          </Select>
          <Button
            isLoading={createSession.isPending}
            loadingLabel="복습 세션 준비 중…"
            disabled={!canStartBatch}
            onClick={handleBatchStart}
          >
            조건에 맞는 오늘의 복습 시작
          </Button>
        </div>
      ) : null}

      {createSession.isError ? (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900"
          role="alert"
        >
          {isOfflineApiError(createSession.error)
            ? '오프라인에서는 복습 세션을 만들 수 없습니다. 연결 후 같은 조건으로 다시 시도해 주세요.'
            : isNoEligibleQuestionsApiError(createSession.error)
              ? '현재 조건으로 출제 가능한 복습 문제가 없습니다.'
              : '복습 세션을 만들지 못했습니다. 입력과 연결 상태를 확인해 주세요.'}
        </p>
      ) : null}

      {isQueuePaused ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950"
          role="status"
        >
          오프라인입니다. 연결이 복구되면 현재 URL 조건으로 복습 대기열을
          자동으로 다시 불러옵니다.
        </p>
      ) : null}
      {queueQuery.isPending && !isQueuePaused && !isPageCorrectionPending ? (
        <LoadingState message="복습 대기열을 불러오고 있습니다." />
      ) : null}
      {queueQuery.isError && !queueQuery.data ? (
        <ErrorState
          title="복습 대기열을 불러오지 못했습니다"
          description="연결 상태를 확인한 뒤 다시 시도해 주세요."
          action={
            <Button
              onClick={() => {
                shouldFocusRetryRef.current = true
                void queueQuery.refetch()
              }}
            >
              다시 시도
            </Button>
          }
        />
      ) : null}

      {queueQuery.isError && queueQuery.data ? (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-semibold">
            복습 대기열의 최신 상태를 확인하지 못했습니다. 현재 결과는 유지되며,
            최신성을 확인할 때까지 묶음 복습을 시작할 수 없습니다.
          </p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => {
              shouldFocusRetryRef.current = true
              void queueQuery.refetch()
            }}
          >
            복습 대기열 다시 확인
          </Button>
        </div>
      ) : null}

      {isPageCorrectionPending ? (
        <LoadingState message="유효한 복습 대기열 페이지로 이동하고 있습니다." />
      ) : null}

      {queueQuery.data && !isPageCorrectionPending ? (
        <>
          <div className="mt-7 flex flex-wrap items-end justify-between gap-3">
            <div aria-live="polite" aria-atomic="true">
              <h2
                ref={resultHeadingRef}
                className="rounded-sm text-xl font-black"
                tabIndex={-1}
              >
                조건에 맞는 오답 {queueQuery.data.total}개
              </h2>
              <p className="mt-1 text-sm text-muted">
                서버 기준 시각{' '}
                {dateTimeFormatter.format(new Date(queueQuery.data.observedAt))}
              </p>
            </div>
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

          {queueQuery.data.items.length === 0 ? (
            <EmptyState
              title={
                parsedSearch.query.view === 'DUE'
                  ? '지금 예정된 복습이 없습니다'
                  : '조건에 맞는 오답이 없습니다'
              }
              description={
                parsedSearch.query.view === 'DUE'
                  ? '전체 기록을 돌아보거나 새로운 문제를 풀어 다음 복습을 준비하세요.'
                  : '필터를 바꾸거나 전체 오답 기록을 확인해 보세요.'
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Link
                    className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-bold text-white"
                    to="/wrong-notes/history"
                  >
                    전체 기록
                  </Link>
                  <Link
                    className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 font-bold"
                    to="/practice"
                  >
                    학습 설정
                  </Link>
                </div>
              }
            />
          ) : (
            <ul className="mt-4 grid gap-4 lg:grid-cols-2">
              {queueQuery.data.items.map((item) => (
                <li
                  key={item.questionId}
                  className="content-auto min-w-0 rounded-xl border border-line bg-white p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="brand">{item.level}</Badge>
                    <Badge>{subjectLabels[item.subject]}</Badge>
                    <Badge variant={statusVariants[item.status]}>
                      {statusLabels[item.status]}
                    </Badge>
                    {item.hasMemo ? (
                      <Badge variant="info">메모 있음</Badge>
                    ) : null}
                  </div>
                  <h3 className="mt-4 break-words text-lg font-black leading-7">
                    {item.questionPreview}
                  </h3>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted">오답</dt>
                      <dd className="font-bold">{item.wrongCount}회</dd>
                    </div>
                    <div>
                      <dt className="text-muted">연속 정답</dt>
                      <dd className="font-bold">{item.correctStreak}회</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted">다음 복습</dt>
                      <dd className="font-bold">
                        {dateTimeFormatter.format(new Date(item.nextReviewAt))}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                  <Link
                    className="mt-5 inline-flex min-h-11 items-center rounded-lg px-1 font-bold text-brand underline underline-offset-2 hover:no-underline"
                    to={`/wrong-notes/${item.questionId}?returnTo=${encodeURIComponent(returnTo)}`}
                  >
                    상세·메모·복습 기록
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Pagination
            className="mt-8"
            currentPage={parsedSearch.query.page}
            totalPages={totalPages}
            disabled={queueQuery.isFetching}
            label="복습 대기열 페이지"
            onPageChange={(page) => setQueryValue('page', page)}
          />
        </>
      ) : null}
    </section>
  )
}
