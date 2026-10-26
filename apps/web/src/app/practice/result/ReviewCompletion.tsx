import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { ExplanationLanguagePanel } from '@common/components/ExplanationLanguagePanel'
import { ReviewStatus } from '@app/wrong-note/components/ReviewStatus'
import { useGetWrongNote } from '@app/wrong-note/hooks/useGetWrongNote'
import { readReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import {
  formatDateTime,
  formatNumber
} from '@nihongo/browser/libs/localeFormatters'

export const ReviewCompletion = ({
  item,
  session
}: {
  item: StudyResultItemView
  session: StudySessionView['session']
}): ReactElement => {
  const { i18n, t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  const { user } = useAuth()
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const current = useGetWrongNote(item.question.id, true)
  const context = readReviewReturnContext(
    getStudyDraftPrincipalScope(user),
    session.id
  )
  const returnTo =
    context?.questionId === item.question.id ? context.returnTo : '/wrong-notes'
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  const fresh =
    current.isFetchedAfterMount &&
    !current.isFetching &&
    !current.isError &&
    current.fetchStatus !== 'paused'
  const status = fresh ? current.data?.wrongNote.status : undefined
  const next = fresh ? current.data?.wrongNote.nextReviewAt : undefined
  const selected = item.question.options.find(
    (option) => option.id === item.selectedOptionId
  )
  const correct = item.question.options.find(
    (option) => option.id === item.correctOptionId
  )
  const pending = current.isPending || current.isFetching
  return (
    <section className="review-document review-completion">
      <header>
        <h1 className="review-title" tabIndex={-1} ref={heading}>
          {t('integration.complete.title')}
        </h1>
        <p className="review-document-meta">
          {session.level} · {commonT(`taxonomy.subjects.${session.subject}`)} ·{' '}
          {t('integration.count', { formattedCount: formatNumber(1, locale) })}
        </p>
      </header>
      <div
        className={`review-feedback ${item.isCorrect ? 'text-success-strong' : 'text-danger-strong'}`}
      >
        <h2>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="12" cy="12" r="10" />
            <path d={item.isCorrect ? 'm7 12 3 3 7-7' : 'm8 8 8 8m0-8-8 8'} />
          </svg>
          {t(
            item.isCorrect
              ? 'integration.complete.correct'
              : 'integration.complete.wrong'
          )}
        </h2>
        {status ? (
          <p>
            {t(`integration.complete.states.${status}`)}
            {next
              ? ` ${t('integration.complete.next', { date: formatDateTime(next, locale, { dateStyle: 'medium' }) })}`
              : ''}
          </p>
        ) : (
          <p role="status">
            {t(
              pending && current.fetchStatus !== 'paused'
                ? 'integration.complete.checking'
                : 'integration.complete.unknown'
            )}
          </p>
        )}
        {!fresh && (!pending || current.fetchStatus === 'paused') ? (
          <Button
            variant="outline"
            onClick={() => {
              void current.refetch()
            }}
          >
            {t('integration.complete.retryStatus')}
          </Button>
        ) : null}
      </div>
      <div className="review-current-status">
        <span>{t('integration.complete.current')}</span>
        {status ? (
          <ReviewStatus status={status} />
        ) : (
          <span>{t('integration.complete.unconfirmed')}</span>
        )}
      </div>
      {item.question.passage ? (
        <div className="review-passage" lang="ja">
          {item.question.passage}
        </div>
      ) : null}
      <h2 className="review-question" lang="ja">
        {item.question.questionText}
      </h2>
      <dl className="review-answer-comparison">
        <div>
          <dt
            className={
              item.isCorrect ? 'review-answer-correct' : 'review-answer-wrong'
            }
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path
                d={item.isCorrect ? 'm5 12 4 4 10-10' : 'm6 6 12 12m0-12L6 18'}
              />
            </svg>
            {t('integration.complete.selected')}
          </dt>
          <dd lang="ja">
            {selected?.text ?? t('integration.complete.unanswered')}
          </dd>
        </div>
        <div>
          <dt className="review-answer-correct">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="m5 12 4 4 10-10" />
            </svg>
            {t('detail.correct')}
          </dt>
          <dd lang="ja">
            {correct?.text ?? t('integration.complete.unconfirmed')}
          </dd>
        </div>
      </dl>
      <section
        className="review-explanation"
        aria-labelledby="review-completion-explanation"
      >
        <h2 id="review-completion-explanation">{t('detail.explanation')}</h2>
        <ExplanationLanguagePanel
          key={item.question.id}
          explanationJa={item.explanationJa}
          explanationKo={item.explanationKo}
        />
      </section>
      <div className="review-document-actions">
        <Link
          className={getButtonClassName()}
          to={returnTo}
          state={{ reviewFocus: item.question.id }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            width="20"
            height="20"
          >
            <path d="M19 12H5m7 7-7-7 7-7" />
          </svg>
          {t('integration.back')}
        </Link>
      </div>
    </section>
  )
}
