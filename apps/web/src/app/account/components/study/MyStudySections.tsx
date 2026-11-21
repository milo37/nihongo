import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'
import {
  getRateTier,
  RateTierMark,
  rateTierFillClass,
  rateTierTextClass
} from '@app/account/components/study/RateTier'
import type { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'

type Stats = NonNullable<ReturnType<typeof useGetDashboardStats>['data']>
type Locale = ReturnType<typeof resolveUiLocale>

/** The summary line: answered count, then the correct rate and its tier. */
export const MyStudySummary = ({
  data,
  locale
}: {
  data: Stats
  locale: Locale
}): ReactElement => {
  'use no memo'
  const { t } = useTranslation('account')
  const totalTier = getRateTier(data.correctRate)
  return (
    <p className="my-summary">
      <span>
        <span className="my-summary-number">
          {formatNumber(data.totalAnsweredCount, locale)}
        </span>{' '}
        <span className="my-summary-unit">{t('study.totalUnit')}</span>
      </span>
      {/* A drawn rule, not a glyph: axe checks text contrast even
          when it is aria-hidden. */}
      <span aria-hidden="true" className="my-summary-rule" />
      <span className="my-summary-rate">
        <span className="my-summary-unit">{t('study.rate')}</span>
        <span className={`my-summary-number ${rateTierTextClass[totalTier]}`}>
          {formatNumber(Math.round(data.correctRate), locale)}%
        </span>
        <RateTierMark
          tier={totalTier}
          className={`my-summary-mark ${rateTierTextClass[totalTier]}`}
        />
        <span className="sr-only">{t(`study.tier.${totalTier}`)}</span>
      </span>
    </p>
  )
}

/** One row per subject: answered count, rate with its tier, and a bar. */
export const SubjectRateList = ({
  data,
  locale
}: {
  data: Stats
  locale: Locale
}): ReactElement => {
  'use no memo'
  const { t } = useTranslation('account')
  const { t: commonT } = useTranslation('common')
  return (
    <ul className="my-subjects">
      {data.subjectStats.map((stat) => {
        const tier = getRateTier(stat.correctRate)
        const rate = Math.round(stat.correctRate)
        return (
          <li key={stat.subject} className="my-subject">
            <span className="my-subject-head">
              <span className="my-subject-name">
                {commonT(`taxonomy.subjects.${stat.subject}`)}
              </span>
              {stat.answeredCount === 0 ? (
                <span className="my-subject-none">{t('study.noRecord')}</span>
              ) : (
                <span className="my-subject-figures">
                  <span className="my-subject-count">
                    {formatNumber(stat.answeredCount, locale)}
                    {t('study.totalUnit')}
                  </span>
                  <span className="sr-only">{t('study.rate')}</span>
                  <RateTierMark
                    tier={tier}
                    className={`my-subject-mark ${rateTierTextClass[tier]}`}
                  />
                  <span
                    className={`my-subject-rate ${rateTierTextClass[tier]}`}
                  >
                    {formatNumber(rate, locale)}%
                  </span>
                  <span className="sr-only">{t(`study.tier.${tier}`)}</span>
                </span>
              )}
            </span>
            {stat.answeredCount === 0 ? null : (
              <span aria-hidden="true" className="my-subject-bar">
                <span
                  className={`my-subject-fill ${rateTierFillClass[tier]}`}
                  style={{
                    width: `${Math.min(100, Math.max(0, rate))}%`
                  }}
                />
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
