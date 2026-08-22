import { useEffect, useMemo, useRef } from 'react'
import type { ReactElement } from 'react'
import type { ReviewEventHistoryItem } from '@nihongo/contracts/wrong-note/list-review-events'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import type { useListReviewEvents } from '@app/wrong-note/hooks/useListReviewEvents'

type ReviewTimelineProps = {
  historyQuery: ReturnType<typeof useListReviewEvents>
}

const sourceLabels = {
  STUDY_SUBMIT: '표준 학습 제출',
  WRONG_NOTE_REVIEW: '오답 복습 제출',
  VERSION_REBASE: '문제 버전 전환'
} as const
const statusLabels = {
  NEW: '새 오답',
  AGAIN: '다시 학습',
  REVIEWING: '복습 중',
  SOLVED: '해결'
} as const
const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'long'
})

const outcomeLabel = (event: ReviewEventHistoryItem): string => {
  if (event.isCorrect === null) return '정답 판정 없음'
  return event.isCorrect ? '정답' : '오답'
}

export const ReviewTimeline = ({
  historyQuery
}: ReviewTimelineProps): ReactElement => {
  const loadMoreButtonRef = useRef<HTMLButtonElement>(null)
  const emptyStateRef = useRef<HTMLParagraphElement>(null)
  const previousItemCountRef = useRef(0)
  const focusNewItemsRef = useRef(false)
  const focusRetryRef = useRef(false)
  const focusInitialRetryRef = useRef(false)
  const items = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [historyQuery.data]
  )
  const isHistoryPaused = historyQuery.fetchStatus === 'paused'
  const hasBackgroundRefreshError =
    historyQuery.isRefetchError && !historyQuery.isFetchNextPageError

  useEffect(() => {
    if (historyQuery.isFetchNextPageError && focusRetryRef.current) {
      focusRetryRef.current = false
      loadMoreButtonRef.current?.focus()
    }
  }, [historyQuery.isFetchNextPageError])

  useEffect(() => {
    if (
      !focusNewItemsRef.current ||
      items.length <= previousItemCountRef.current
    ) {
      previousItemCountRef.current = items.length
      return
    }
    const newlyLoaded = items[previousItemCountRef.current]
    previousItemCountRef.current = items.length
    focusNewItemsRef.current = false
    if (newlyLoaded) {
      document.getElementById(`review-event-${newlyLoaded.id}`)?.focus()
    }
  }, [items])

  useEffect(() => {
    if (!historyQuery.isSuccess || !focusInitialRetryRef.current) return
    focusInitialRetryRef.current = false
    const first = items[0]
    if (first) {
      document.getElementById(`review-event-${first.id}`)?.focus()
    } else {
      emptyStateRef.current?.focus()
    }
  }, [historyQuery.isSuccess, items])

  if (historyQuery.isPending) {
    if (isHistoryPaused) {
      return (
        <p className="text-sm font-semibold text-amber-900" role="status">
          오프라인에서는 복습 기록을 불러올 수 없습니다. 연결되면 자동으로 다시
          불러옵니다.
        </p>
      )
    }
    return (
      <p className="text-sm font-semibold text-muted" role="status">
        복습 기록을 불러오고 있습니다…
      </p>
    )
  }

  if (historyQuery.isError && !historyQuery.data) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        role="alert"
      >
        <p>복습 기록을 불러오지 못했습니다.</p>
        <Button
          className="mt-3"
          size="sm"
          onClick={() => {
            focusInitialRetryRef.current = true
            void historyQuery.refetch()
          }}
        >
          다시 시도
        </Button>
      </div>
    )
  }

  const backgroundRefreshError = hasBackgroundRefreshError ? (
    <div
      className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
      role="alert"
    >
      <p>
        복습 기록의 최신 상태를 확인하지 못했습니다. 현재까지 불러온 기록은
        유지됩니다.
      </p>
      <Button
        className="mt-3"
        size="sm"
        onClick={() => {
          focusInitialRetryRef.current = true
          void historyQuery.refetch()
        }}
      >
        복습 기록 다시 확인
      </Button>
    </div>
  ) : null

  if (items.length === 0) {
    return (
      <div>
        {isHistoryPaused ? (
          <p
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950"
            role="status"
          >
            오프라인입니다. 연결되면 복습 기록을 다시 확인합니다.
          </p>
        ) : null}
        {backgroundRefreshError}
        <p
          ref={emptyStateRef}
          className="rounded-lg bg-slate-50 p-4 text-sm text-muted"
          tabIndex={-1}
        >
          아직 복습 이벤트가 없습니다.
        </p>
      </div>
    )
  }

  return (
    <div>
      {isHistoryPaused ? (
        <p
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950"
          role="status"
        >
          오프라인입니다. 현재 기록을 유지하며 연결되면 중단된 요청을
          이어갑니다.
        </p>
      ) : null}
      {backgroundRefreshError}
      <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
        {items.map((event) => (
          <li
            key={event.id}
            id={`review-event-${event.id}`}
            className="rounded-xl border border-line bg-white p-4 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brand"
            tabIndex={-1}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  event.isCorrect === true
                    ? 'success'
                    : event.isCorrect === false
                      ? 'danger'
                      : 'neutral'
                }
              >
                {outcomeLabel(event)}
              </Badge>
              <strong className="text-sm">{sourceLabels[event.source]}</strong>
              <time className="text-xs text-muted" dateTime={event.occurredAt}>
                {dateTimeFormatter.format(new Date(event.occurredAt))}
              </time>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">상태 변화</dt>
                <dd className="font-semibold">
                  {event.previousStatus
                    ? statusLabels[event.previousStatus]
                    : '기록 시작'}{' '}
                  → {statusLabels[event.nextStatus]}
                </dd>
              </div>
              <div>
                <dt className="text-muted">오답 횟수</dt>
                <dd className="font-semibold">
                  {event.previousWrongCount ?? 0} → {event.wrongCountAfter}
                </dd>
              </div>
              <div>
                <dt className="text-muted">연속 정답</dt>
                <dd className="font-semibold">
                  {event.previousCorrectStreak ?? 0} → {event.nextCorrectStreak}
                </dd>
              </div>
              <div>
                <dt className="text-muted">풀이 시간</dt>
                <dd className="font-semibold">
                  {event.elapsedSec === null
                    ? '기록 없음'
                    : `${event.elapsedSec}초`}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted">문제 버전</dt>
                <dd className="break-all font-mono text-xs">
                  {event.questionVersionId}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted">알고리즘</dt>
                <dd className="font-semibold">
                  version {event.algorithmVersion}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      {historyQuery.isFetchNextPageError ? (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"
          role="alert"
        >
          이전 기록을 더 불러오지 못했습니다. 현재까지 불러온 기록은 유지됩니다.
        </p>
      ) : null}
      {historyQuery.hasNextPage ? (
        <Button
          ref={loadMoreButtonRef}
          className="mt-5"
          variant="outline"
          isLoading={historyQuery.isFetchingNextPage || isHistoryPaused}
          loadingLabel={
            isHistoryPaused ? '연결 대기 중…' : '이전 기록 불러오는 중…'
          }
          onClick={() => {
            previousItemCountRef.current = items.length
            focusNewItemsRef.current = true
            focusRetryRef.current = true
            void historyQuery.fetchNextPage()
          }}
        >
          이전 기록 더 보기
        </Button>
      ) : (
        <p className="mt-4 text-sm text-muted">
          첫 오답 기록까지 모두 확인했습니다.
        </p>
      )}
    </div>
  )
}
