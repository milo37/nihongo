import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { ExplanationLanguagePanel } from '@common/components/ExplanationLanguagePanel'
import { toWrongNoteReviewState } from '@nihongo/contracts/wrong-note/list-review-list'
import type { WrongNoteReviewState } from '@nihongo/contracts/wrong-note/list-review-list'
import { ReviewStatus } from '@app/wrong-note/components/ReviewStatus'
import { useGetWrongNote } from '@app/wrong-note/hooks/useGetWrongNote'
import { readReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { JaText } from '@common/components/JaText'
import { jaTextProps } from '@common/libs/jaSpacing'

/** 24px outline icon drawn in the current text colour. */
const OutlineIcon = ({
  children,
  size
}: {
  children: ReactNode
  size?: number
}): ReactElement => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    width={size}
    height={size}
  >
    {children}
  </svg>
)

type WrongNoteQuery = ReturnType<typeof useGetWrongNote>

/** Correct/wrong headline, the confirmed review state and a status retry. */
const ReviewFeedback = ({
  item,
  state,
  fresh,
  current
}: {
  item: StudyResultItemView
  state: WrongNoteReviewState | undefined
  fresh: boolean
  current: WrongNoteQuery
}): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const pending = current.isPending || current.isFetching
  return (
    <div
      className={`review-feedback ${item.isCorrect ? 'text-success-strong' : 'text-danger-strong'}`}
    >
      <h2>
        <OutlineIcon>
          <circle cx="12" cy="12" r="10" />
          <path d={item.isCorrect ? 'm7 12 3 3 7-7' : 'm8 8 8 8m0-8-8 8'} />
        </OutlineIcon>
        {t(
          item.isCorrect
            ? 'integration.complete.correct'
            : 'integration.complete.wrong'
        )}
      </h2>
      {state ? (
        <p>{t(`integration.complete.states.${state}`)}</p>
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
  )
}

/** The learner's answer next to the correct answer. */
const AnswerComparison = ({
  item
}: {
  item: StudyResultItemView
}): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const selected = item.question.options.find(
    (option) => option.id === item.selectedOptionId
  )
  const correct = item.question.options.find(
    (option) => option.id === item.correctOptionId
  )
  return (
    <dl className="review-answer-comparison">
      <div>
        <dt
          className={
            item.isCorrect ? 'review-answer-correct' : 'review-answer-wrong'
          }
        >
          <OutlineIcon>
            <path
              d={item.isCorrect ? 'm5 12 4 4 10-10' : 'm6 6 12 12m0-12L6 18'}
            />
          </OutlineIcon>
          {t('integration.complete.selected')}
        </dt>
        <dd {...(selected ? jaTextProps(selected.text) : {})}>
          {selected ? (
            <JaText text={selected.text} />
          ) : (
            t('integration.complete.unanswered')
          )}
        </dd>
      </div>
      <div>
        <dt className="review-answer-correct">
          <OutlineIcon>
            <path d="m5 12 4 4 10-10" />
          </OutlineIcon>
          {t('detail.correct')}
        </dt>
        <dd {...(correct ? jaTextProps(correct.text) : {})}>
          {correct ? (
            <JaText text={correct.text} />
          ) : (
            t('integration.complete.unconfirmed')
          )}
        </dd>
      </div>
    </dl>
  )
}

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
  const state = status ? toWrongNoteReviewState(status) : undefined
  return (
    <section className="review-document review-completion">
      <header>
        <h1 className="review-title outline-none" tabIndex={-1} ref={heading}>
          {t('integration.complete.title')}
        </h1>
        <p className="review-document-meta">
          {session.level} · {commonT(`taxonomy.subjects.${session.subject}`)} ·{' '}
          {t('integration.count', { formattedCount: formatNumber(1, locale) })}
        </p>
      </header>
      <ReviewFeedback
        item={item}
        state={state}
        fresh={fresh}
        current={current}
      />
      <div className="review-current-status">
        <span>{t('integration.complete.current')}</span>
        {state ? (
          <ReviewStatus state={state} />
        ) : (
          <span>{t('integration.complete.unconfirmed')}</span>
        )}
      </div>
      {item.question.passage ? (
        <div className="review-passage" {...jaTextProps(item.question.passage)}>
          <JaText text={item.question.passage} />
        </div>
      ) : null}
      <h2
        className="review-question"
        {...jaTextProps(item.question.questionText)}
      >
        <JaText text={item.question.questionText} />
      </h2>
      <AnswerComparison item={item} />
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
          <OutlineIcon size={20}>
            <path d="M19 12H5m7 7-7-7 7-7" />
          </OutlineIcon>
          {t('integration.back')}
        </Link>
      </div>
    </section>
  )
}
