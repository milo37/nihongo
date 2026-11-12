import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'
import {
  getRateTier,
  RateTierMark,
  rateTierFillClass,
  rateTierTextClass
} from '@app/account/components/study/RateTier'
import { RecentSessionList } from '@app/account/components/study/RecentSessionList'
import { Button } from '@nihongo/browser/common/components/Button'
import { getButtonClassName } from '@nihongo/browser/common/components/Button'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'

const Skeleton = (): ReactElement => (
  <div className="grid gap-3" aria-hidden="true">
    <span className="h-3 w-1/3 rounded bg-surface-muted" />
    <span className="h-3 w-2/3 rounded bg-surface-muted" />
    <span className="h-3 w-1/2 rounded bg-surface-muted" />
  </div>
)

// "내 학습": one summary line, answered count and correct rate per subject,
// then recent study. JLP-851: rates carry a tier colour, mark and bar.
export const MyStudy = (): ReactElement => {
  const { t, i18n } = useTranslation('account')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const headingId = useId()
  // Opening My page always shows a current read.
  const stats = useGetDashboardStats({ myPage: true })
  const data = stats.data
  const totalTier = data ? getRateTier(data.correctRate) : 'high'
  return (
    <section className="account-section grid gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-bold">
        {t('study.title')}
      </h2>
      {stats.isPending ? (
        <>
          <p className="sr-only" role="status">
            {t('study.loading')}
          </p>
          <Skeleton />
        </>
      ) : !data ? (
        <div>
          <p className="auth-notice auth-error mt-0" role="alert">
            {t('study.error')}
          </p>
          <Button
            className="mt-3"
            variant="outline"
            disabled={stats.isFetching}
            onClick={() => void stats.refetch()}
          >
            {t('study.retry')}
          </Button>
        </div>
      ) : data.totalAnsweredCount === 0 ? (
        <div>
          <p className="font-semibold">{t('study.emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted">
            {t('study.emptyDescription')}
          </p>
          <Link className={getButtonClassName({ className: 'mt-4' })} to="/">
            {t('study.emptyAction')}
          </Link>
        </div>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-3 tabular-nums">
            <span>
              <span className="text-[32px] font-bold leading-tight">
                {formatNumber(data.totalAnsweredCount, locale)}
              </span>{' '}
              <span className="text-sm text-muted">{t('study.totalUnit')}</span>
            </span>
            <span aria-hidden="true" className="self-center text-line">
              │
            </span>
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
                        <span className="sr-only">
                          {t(`study.tier.${tier}`)}
                        </span>
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
          <RecentSessionList sessions={data.recentStudySessions} />
        </>
      )}
    </section>
  )
}
