import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import type { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'
import {
  getRateTier,
  RateTierMark,
  rateTierFillClass,
  rateTierTextClass
} from '@app/account/components/study/RateTier'
import { getButtonClassName } from '@nihongo/browser/common/components/Button'
import type { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'

type Stats = NonNullable<ReturnType<typeof useGetDashboardStats>['data']>
type Locale = ReturnType<typeof resolveUiLocale>

/** No answers at this level yet: Maru and a way to start. */
export const MyStudyEmpty = ({ level }: { level: JlptLevel }): ReactElement => {
  // Left uncompiled: the compiled My study section already caches this one
  // (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('account')
  return (
    <div>
      <span className="maru-empty" aria-hidden="true" />
      <p className="font-semibold">{t('study.emptyTitle', { level })}</p>
      <p className="mt-1 text-sm text-muted">
        {t('study.emptyDescription', { level })}
      </p>
      <Link className={getButtonClassName({ className: 'mt-4' })} to="/">
        {t('study.emptyAction', { level })}
      </Link>
    </div>
  )
}

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
    <p className="flex flex-wrap items-baseline gap-x-3 tabular-nums">
      <span>
        <span className="text-[32px] font-bold leading-tight">
          {formatNumber(data.totalAnsweredCount, locale)}
        </span>{' '}
        <span className="text-sm text-muted">{t('study.totalUnit')}</span>
      </span>
      {/* A drawn rule, not a glyph: axe checks text contrast even
          when it is aria-hidden. */}
      <span aria-hidden="true" className="h-6 w-px self-center bg-line" />
      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-sm text-muted">{t('study.rate')}</span>
        <span
          className={`text-[32px] font-bold leading-tight ${rateTierTextClass[totalTier]}`}
        >
          {formatNumber(Math.round(data.correctRate), locale)}%
        </span>
        <RateTierMark
          tier={totalTier}
          className={`size-5 self-center ${rateTierTextClass[totalTier]}`}
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
    <ul className="grid">
      {data.subjectStats.map((stat) => {
        const tier = getRateTier(stat.correctRate)
        const rate = Math.round(stat.correctRate)
        return (
          <li
            key={stat.subject}
            className="grid min-h-[52px] gap-2 border-b border-line py-3"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="text-[15px] font-semibold">
                {commonT(`taxonomy.subjects.${stat.subject}`)}
              </span>
              {stat.answeredCount === 0 ? (
                <span className="text-caption text-muted">
                  {t('study.noRecord')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 tabular-nums">
                  <span className="text-[13px] text-muted">
                    {formatNumber(stat.answeredCount, locale)}
                    {t('study.totalUnit')}
                  </span>
                  <span className="sr-only">{t('study.rate')}</span>
                  <RateTierMark
                    tier={tier}
                    className={`size-4 ${rateTierTextClass[tier]}`}
                  />
                  <span
                    className={`text-xl font-bold ${rateTierTextClass[tier]}`}
                  >
                    {formatNumber(rate, locale)}%
                  </span>
                  <span className="sr-only">{t(`study.tier.${tier}`)}</span>
                </span>
              )}
            </span>
            {stat.answeredCount === 0 ? null : (
              <span
                aria-hidden="true"
                className="block h-1 overflow-hidden rounded-sm bg-line"
              >
                <span
                  className={`block h-full rounded-sm ${rateTierFillClass[tier]}`}
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
