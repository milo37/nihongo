import { SheetTail } from '@common/components/manuscript/ManuscriptSheet'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { useRetryToast } from '@nihongo/browser/common/components/Toast'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { useGetDailyQuestion } from '@app/home/hooks/useGetDailyQuestion'
import { isNoEligibleQuestionsApiError } from '@libs/apiError'
import { DailyQuestionBody } from '@app/home/components/DailyQuestionBody'

const CARD_CLASS = 'home-daily'

/**
 * '오늘의 한 문제': label row, body, result line. Later the body becomes a
 * word or grammar card in the same frame (direction §1-2).
 */
export const DailyQuestionCard = ({
  level
}: {
  level: JlptLevel
}): ReactElement | null => {
  const { t } = useTranslation('home')
  const daily = useGetDailyQuestion(level)
  const isNoQuestion =
    daily.isError && isNoEligibleQuestionsApiError(daily.error)
  // #1292: a failed load hides the whole card; the toast carries the retry
  // and the card comes back when the question arrives.
  const isLoadFailed = daily.isError && !daily.data && !isNoQuestion
  useRetryToast(isLoadFailed ? t('today.dailyError') : null, 'daily', () => {
    void daily.refetch()
  })
  // No question for this level today: leave the space empty.
  if (isNoQuestion || isLoadFailed) return null
  const head = (
    <div className="home-daily-head">
      <SheetTail side="left" />
      <h2 id="home-daily-title" className="home-daily-title">
        {t('today.dailyLabel')}
      </h2>
      {daily.data ? (
        // #1075: the level only; the subject is already in the sentence.
        <span className="home-daily-meta">{daily.data.level}</span>
      ) : null}
      <SheetTail side="right" />
    </div>
  )
  // #1041: on PC the head and sheet share the first row with the start
  // title; the options start the second row with the lines on the left.
  return (
    <section className={CARD_CLASS} aria-labelledby="home-daily-title">
      {daily.data ? (
        <DailyQuestionBody
          key={daily.data.question.id}
          data={daily.data}
          head={head}
        />
      ) : (
        <div className="home-daily-top">
          {head}
          {/* A card skeleton holds the height, so the card does not jump
              when the question arrives (G, #801 design). */}
          <div className="home-daily-loading" role="status">
            <span className="sr-only">{t('today.dailyLoading')}</span>
            <div
              aria-hidden="true"
              className="ui-skeleton home-daily-skeleton"
            />
            <div aria-hidden="true" className="home-daily-options">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className="ui-skeleton home-daily-skeleton-option"
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
