import { useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { DiffQuestionVersionResponse } from '@nihongo/contracts/admin/phase7'
import { Button } from '@nihongo/browser/common/components/Button'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import type { useQuestionWorkflow } from '@app/admin-question/hooks/useQuestionWorkflow'
type Workflow = ReturnType<typeof useQuestionWorkflow>
const card = 'min-w-0 rounded-2xl border border-line bg-surface p-5 sm:p-6'
const QueryWarning = ({
  query,
  isOffline,
  onRetry
}: {
  query: Workflow['preview'] | Workflow['diff'] | Workflow['reviews']
  isOffline: boolean
  onRetry: () => void
}): ReactElement | null => {
  const { t, presentError } = useAdminPresentation()
  return query.isError || query.fetchStatus === 'paused' ? (
    <div role="alert" className="my-3 text-sm">
      <p>
        {query.fetchStatus === 'paused'
          ? t('common.cachedPausedDescription')
          : presentError(query.error)}
      </p>
      <Button
        variant="outline"
        disabled={isOffline || query.isFetching}
        onClick={onRetry}
      >
        {t('common.retry')}
      </Button>
    </div>
  ) : null
}
export const QuestionVersionPanels = ({
  workflow
}: {
  workflow: Workflow
}): ReactElement => {
  const { preview, diff, reviews, selected, previous, isOffline } = workflow
  const { t, formatAdminDateTime } = useAdminPresentation()
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const diffHeading = useRef<HTMLHeadingElement>(null)
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  const reviewList = useRef<HTMLOListElement>(null)
  const retry = (
    query: typeof preview | typeof diff | typeof reviews,
    heading: typeof previewHeading
  ): void => {
    void query.refetch().then((result) => {
      if (result.isSuccess && result.fetchStatus === 'idle')
        requestAnimationFrame(() => heading.current?.focus())
    })
  }
  const renderDiff = (
    change: DiffQuestionVersionResponse['changes'][number],
    side: 'before' | 'after'
  ): ReactNode => {
    if (change.kind === 'OPTIONS')
      return (
        <ol>
          {change[side].map((option) => (
            <li key={option.ordinal}>
              {option.ordinal}. {option.text}
              {option.isCorrect ? t('questionDetail.correctSuffix') : ''}
            </li>
          ))}
        </ol>
      )
    if (change.kind === 'TAGS')
      return change[side].map((tag) => tag.label).join(', ')
    const value = change[side]
    if (value === null) return t('common.none')
    if (change.field === 'SUBJECT') return t(`enums.subjects.${change[side]!}`)
    if (change.field === 'QUESTION_TYPE')
      return t(`enums.questionTypes.${change[side]!}`)
    if (change.field === 'DIFFICULTY')
      return t(`enums.difficulties.${change[side]!}`)
    return value
  }
  const items = reviews.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="grid min-w-0 gap-6">
      <section className={card} aria-labelledby="question-preview">
        <h2
          ref={previewHeading}
          tabIndex={-1}
          id="question-preview"
          className="text-xl font-bold"
        >
          {t('questionDetail.previewTitle')}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {t('questionDetail.previewDescription', {
            status: selected
              ? t(`enums.versionStatuses.${selected.versionStatus}`)
              : t('common.none')
          })}
        </p>
        <QueryWarning
          query={preview}
          isOffline={isOffline}
          onRetry={() => retry(preview, previewHeading)}
        />
        {preview.isPending && preview.fetchStatus !== 'paused' ? (
          <LoadingState message={t('questionDetail.previewLoading')} />
        ) : null}
        {preview.data ? (
          <>
            <p lang="ja" className="mt-6 whitespace-pre-wrap leading-8">
              {preview.data.question.passage}
            </p>
            <p
              lang="ja"
              className="mt-4 whitespace-pre-wrap text-lg font-bold leading-8"
            >
              {preview.data.question.questionText}
            </p>
            <ol className="mt-5 grid gap-3 sm:grid-cols-2">
              {preview.data.question.options.map((option) => (
                <li
                  key={option.id}
                  className="rounded-lg border border-line p-3"
                  lang="ja"
                >
                  {option.label}. {option.text}
                  {option.id === preview.data.adminAnswer.correctOptionId ? (
                    <strong> {t('questionDetail.correctSuffix')}</strong>
                  ) : null}
                </li>
              ))}
            </ol>
            <h3 className="mt-6 font-bold">
              {t('questionDetail.answerExplanation')}
            </h3>
            <p className="mt-2 whitespace-pre-wrap leading-7" lang="ko">
              {preview.data.adminAnswer.explanationKo}
            </p>
            {preview.data.adminAnswer.explanationJa ? (
              <p className="mt-3 whitespace-pre-wrap leading-7" lang="ja">
                {preview.data.adminAnswer.explanationJa}
              </p>
            ) : null}
          </>
        ) : null}
      </section>
      <section className={card} aria-labelledby="question-diff">
        <h2
          ref={diffHeading}
          tabIndex={-1}
          id="question-diff"
          className="text-xl font-bold"
        >
          {t('questionDetail.diffTitle')}
        </h2>
        <QueryWarning
          query={diff}
          isOffline={isOffline}
          onRetry={() => retry(diff, diffHeading)}
        />
        {previous && diff.isPending && diff.fetchStatus !== 'paused' ? (
          <LoadingState message={t('questionDetail.diffLoading')} />
        ) : null}
        {!previous || diff.data?.changes.length === 0 ? (
          <p className="mt-3 text-muted">
            {t(
              !previous
                ? workflow.history.hasNextPage
                  ? 'questionDetail.historyMore'
                  : 'questionDetail.noPreviousVersion'
                : 'questionDetail.diffEmpty'
            )}
          </p>
        ) : null}
        {diff.data ? (
          <ul
            className="mt-4 grid gap-5"
            aria-label={t('questionDetail.diffListLabel')}
          >
            {diff.data.changes.map((change) => (
              <li key={change.field}>
                <h3 className="font-bold">
                  {t(`enums.diffFields.${change.field}`)}
                </h3>
                <dl className="mt-2 grid gap-4 sm:grid-cols-2">
                  {(['before', 'after'] as const).map((side) => (
                    <div key={side} className="min-w-0">
                      <dt className="text-sm font-semibold">
                        {t(
                          side === 'before'
                            ? 'questionDetail.diffBefore'
                            : 'questionDetail.diffAfter'
                        )}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words leading-7">
                        {renderDiff(change, side)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className={card} aria-labelledby="question-reviews">
        <h2
          ref={reviewHeading}
          tabIndex={-1}
          id="question-reviews"
          className="text-xl font-bold"
        >
          {t('questionDetail.reviews')}
        </h2>
        <QueryWarning
          query={reviews}
          isOffline={isOffline}
          onRetry={() => retry(reviews, reviewHeading)}
        />
        {reviews.isPending && reviews.fetchStatus !== 'paused' ? (
          <LoadingState message={t('questionDetail.reviewsLoading')} />
        ) : null}
        {reviews.isSuccess && !items.length ? (
          <p className="mt-3 text-muted">{t('questionDetail.reviewsEmpty')}</p>
        ) : null}
        <ol ref={reviewList} className="mt-4 grid gap-4">
          {items.map((review) => (
            <li
              key={review.id}
              tabIndex={-1}
              className="rounded-lg border border-line p-4"
            >
              <p className="font-bold">
                {t(`enums.reviewActions.${review.action}`)}
              </p>
              <p>
                {t(`enums.versionStatuses.${review.fromState}`)} →{' '}
                {t(`enums.versionStatuses.${review.toState}`)}
              </p>
              <p className="text-sm text-muted">
                {t(`enums.actorLabels.${review.actor.label}`)} ·{' '}
                {formatAdminDateTime(review.occurredAt)}
              </p>
              {review.reason ? (
                <p className="whitespace-pre-wrap">{review.reason}</p>
              ) : null}
              {review.comment ? (
                <p className="whitespace-pre-wrap">{review.comment}</p>
              ) : null}
            </li>
          ))}
        </ol>
        {reviews.hasNextPage ? (
          <Button
            className="mt-4"
            variant="outline"
            disabled={isOffline || reviews.isFetching}
            isLoading={reviews.isFetchingNextPage}
            onClick={() => {
              const index = items.length
              void reviews.fetchNextPage().then((result) => {
                if (result.isSuccess && result.fetchStatus === 'idle')
                  requestAnimationFrame(() => {
                    const child = reviewList.current?.children.item(index)
                    if (child instanceof HTMLElement) child.focus()
                    else reviewHeading.current?.focus()
                  })
              })
            }}
          >
            {t('questionDetail.reviewsMore')}
          </Button>
        ) : null}
      </section>
    </div>
  )
}
