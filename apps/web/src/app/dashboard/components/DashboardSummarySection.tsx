import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'

import type { DashboardView } from '@app/dashboard/adapters/dashboardView'
import { Badge } from '@common/components/Badge'
import { EmptyState } from '@common/components/EmptyState'
import { resolveUiLocale } from '@/i18n/types'
import { formatDateTime, formatNumber } from '@libs/localeFormatters'

type DashboardSummarySectionProps = {
  stats: DashboardView
}

export const DashboardSummarySection = ({
  stats
}: DashboardSummarySectionProps): ReactElement => {
  const { i18n, t } = useTranslation('dashboard')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const formatRate = (value: number): string =>
    `${formatNumber(value, locale, { maximumFractionDigits: 2 })}%`
  const subjectLabel = (
    subject: NonNullable<DashboardView['weakestSubject']>
  ): string => commonT(`taxonomy.subjects.${subject}`)
  const formatSessionDate = (value: string): string =>
    formatDateTime(value, locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  const formatDailyDate = (value: string): string =>
    formatDateTime(`${value}T00:00:00.000Z`, locale, {
      month: 'numeric',
      day: 'numeric',
      timeZone: 'UTC'
    })

  if (stats.totalAnsweredCount === 0) {
    return (
      <EmptyState
        title={t('summary.emptyTitle')}
        description={t('summary.emptyDescription')}
        action={
          <Link
            className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
            to="/practice"
          >
            {t('summary.emptyAction')}
          </Link>
        }
      />
    )
  }

  const maxDailyCount = stats.dailyStudyCountLast7Days.reduce(
    (maximum, day) => Math.max(maximum, day.count),
    1
  )

  return (
    <>
      <dl className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">{t('summary.totalAnswered')}</dt>
          <dd className="mt-2 text-3xl font-black">
            {formatCount(stats.totalAnsweredCount)}
            <span className="ml-1 text-base font-semibold text-muted">
              {t('summary.questionUnit')}
            </span>
          </dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">{t('summary.correctRate')}</dt>
          <dd className="mt-2 text-3xl font-black text-brand">
            {formatRate(stats.correctRate)}
          </dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">{t('summary.wrongNotes')}</dt>
          <dd className="mt-2 text-3xl font-black">
            {formatCount(stats.wrongNoteCount)}
            <span className="ml-1 text-base font-semibold text-muted">
              {t('summary.itemUnit')}
            </span>
          </dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">
            {t('summary.solvedWrongNotes')}
          </dt>
          <dd className="mt-2 text-3xl font-black">
            {formatCount(stats.solvedWrongNoteCount)}
            <span className="ml-1 text-base font-semibold text-muted">
              {t('summary.itemUnit')}
            </span>
          </dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">{t('summary.weakestSubject')}</dt>
          <dd className="mt-2 text-xl font-black">
            {stats.weakestSubject
              ? subjectLabel(stats.weakestSubject)
              : t('summary.analysisPending')}
          </dd>
        </div>
      </dl>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-xl border border-line bg-surface p-5 sm:p-7">
          <h2 className="text-xl font-black">{t('summary.subjectAccuracy')}</h2>
          <ul className="mt-6 space-y-6">
            {stats.subjectStats.map((subject) => {
              const label = subjectLabel(subject.subject)

              return (
                <li key={subject.subject}>
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-bold">{label}</span>
                    <span className="text-muted">
                      {formatCount(subject.correctCount)}/
                      {formatCount(subject.answeredCount)} ·{' '}
                      <strong className="text-ink">
                        {formatRate(subject.correctRate)}
                      </strong>
                    </span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      aria-label={t('summary.subjectAccuracyLabel', {
                        subject: label
                      })}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={subject.correctRate}
                      className="h-full rounded-full bg-brand"
                      role="progressbar"
                      style={{ width: `${subject.correctRate}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </article>

        <article className="rounded-xl border border-line bg-surface p-5 sm:p-7">
          <h2 className="text-xl font-black">{t('summary.recentSevenDays')}</h2>
          <ul
            aria-label={t('summary.recentSevenDaysLabel')}
            className="mt-6 grid grid-cols-7 gap-2"
          >
            {stats.dailyStudyCountLast7Days.map((day) => {
              const height = Math.max(
                8,
                Math.round((day.count / maxDailyCount) * 112)
              )

              return (
                <li
                  className="flex min-w-0 flex-col items-center"
                  key={day.date}
                >
                  <span className="text-xs font-bold">
                    {formatCount(day.count)}
                  </span>
                  <div className="mt-2 flex h-28 w-full items-end rounded-md bg-surface-muted">
                    <span
                      aria-hidden="true"
                      className="block w-full rounded-md bg-brand"
                      style={{ height: `${height}px` }}
                    />
                  </div>
                  <span className="mt-2 text-[11px] text-muted">
                    {formatDailyDate(day.date)}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-5 text-sm text-muted">
            {t('summary.chartDescription')}
          </p>
        </article>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-xl border border-line bg-surface p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-black">
              {t('summary.recentSessions')}
            </h2>
            <Badge>
              {formatCount(stats.recentStudySessions.length)}
              {t('summary.itemUnit')}
            </Badge>
          </div>
          {stats.recentStudySessions.length > 0 ? (
            <ul className="mt-5 divide-y divide-line">
              {stats.recentStudySessions.map((session) => (
                <li
                  className="flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  key={session.id}
                >
                  <div className="min-w-0">
                    <p className="font-bold">
                      {session.level} · {subjectLabel(session.subject)}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {formatSessionDate(session.submittedAt)} ·{' '}
                      {t('summary.recentSessionResult', {
                        correct: formatCount(session.correctCount),
                        total: formatCount(session.totalCount)
                      })}
                    </p>
                  </div>
                  <Badge variant="success">
                    {t('summary.sessionAccuracy', {
                      rate: formatNumber(session.correctRate, locale, {
                        maximumFractionDigits: 2
                      })
                    })}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-sm text-muted">
              {t('summary.noRecentSessions')}
            </p>
          )}
        </article>

        <article className="rounded-xl border border-line bg-surface p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black">{t('summary.repeatedWrong')}</h2>
            <Link
              className="inline-flex min-h-11 items-center px-1 text-sm font-bold text-brand underline underline-offset-2 hover:no-underline"
              to="/wrong-notes?view=REPEATED&sort=MOST_WRONG"
            >
              {t('summary.openReviewCenter')}
            </Link>
          </div>
          {stats.repeatedWrongQuestions.length > 0 ? (
            <ol className="mt-5 divide-y divide-line">
              {stats.repeatedWrongQuestions.map((question, index) => (
                <li
                  className="flex min-w-0 gap-4 py-4"
                  key={question.questionId}
                >
                  <span className="font-black text-brand">
                    {formatCount(index + 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      className="inline-flex min-h-11 max-w-full items-center [overflow-wrap:anywhere] font-semibold text-brand underline underline-offset-2 hover:no-underline"
                      lang="ja"
                      to={`/wrong-notes/${question.questionId}?returnTo=${encodeURIComponent('/dashboard')}`}
                    >
                      {question.questionText}
                    </Link>
                    <p className="mt-1 text-sm text-muted">
                      {question.level} · {subjectLabel(question.subject)} ·{' '}
                      {t('summary.wrongCount', {
                        formattedCount: formatCount(question.wrongCount)
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-5 text-sm text-muted">
              {t('summary.noRepeatedWrong')}
            </p>
          )}
        </article>
      </div>
    </>
  )
}
