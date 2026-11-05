import { useRef } from 'react'
import type { ReactElement, RefObject } from 'react'
import { Link, useParams } from 'react-router'
import type { AdminReportDetail } from '@nihongo/contracts/admin/reports'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useAdminReportDetail } from '@app/admin-report/hooks/useAdminReportQueries'
import { readReportReturn } from '@app/admin-report/navigation/reportListFocus'
import { ReportStatusBadge } from '@app/admin-report/components/ReportStatusBadge'
import {
  ReportProcessPanel,
  cardClass
} from '@app/admin-report/components/ReportProcessPanel'
import { PageContainer } from '@nihongo/browser/common/components/PageContainer'

export const AdminReportDetailPage = (): ReactElement => {
  const { reportId = '' } = useParams()
  const { user, role } = useAuth()
  const report = useAdminReportDetail(reportId)
  const { t, presentError } = useAdminPresentation()
  const heading = useRef<HTMLHeadingElement>(null)
  if (!user || role !== 'ADMIN') return <></>
  return (
    <PageContainer width="6xl">
      <Link
        to={readReportReturn(user.id, reportId).slice('/admin'.length)}
        className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        {t('userReport.detail.back')}
      </Link>
      {report.data ? (
        <ReportDetail
          key={report.data.reportId}
          report={report.data}
          heading={heading}
          onConflict={() => void report.refetch()}
        />
      ) : report.isError || report.isOffline ? (
        <ErrorState
          className="mt-6"
          title={t('userReport.detail.error')}
          description={
            report.isOffline
              ? t('common.pausedDescription')
              : presentError(report.error)
          }
          onRetry={() => void report.refetch()}
          retryLabel={t('userReport.detail.retry')}
          autoFocus
        />
      ) : (
        <LoadingState
          className="mt-8"
          message={t('userReport.detail.loading')}
        />
      )}
    </PageContainer>
  )
}

const ReportDetail = ({
  report,
  heading,
  onConflict
}: {
  report: AdminReportDetail
  heading: RefObject<HTMLHeadingElement | null>
  onConflict: () => void
}): ReactElement => {
  const { t, formatAdminDateTime } = useAdminPresentation()
  const title = report.description.split('\n')[0]?.slice(0, 80) ?? ''

  return (
    <>
      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1
            ref={heading}
            tabIndex={-1}
            className="break-words rounded-sm text-balance text-3xl font-black sm:text-4xl"
          >
            {title}
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
            <Badge>{t(`userReport.kinds.${report.kind}`)}</Badge>
            <span>{formatAdminDateTime(report.createdAt)}</span>
            <span>
              {t('userReport.detail.reporter')}:{' '}
              {report.reporterMemberId
                ? `${report.reporterMemberId.slice(0, 8)}…`
                : t('userReport.detail.deletedReporter')}
            </span>
          </p>
        </div>
        <ReportStatusBadge status={report.status} />
      </header>
      <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-4">
          <section className={cardClass} aria-labelledby="report-content">
            <h2 id="report-content" className="text-lg font-bold">
              {t('userReport.detail.content')}
            </h2>
            <p className="mt-3 whitespace-pre-wrap break-words">
              {report.description}
            </p>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted">{t('userReport.detail.location')}</dt>
              <dd className="break-all">{report.location}</dd>
              {report.questionId ? (
                <>
                  <dt className="text-muted">
                    {t('userReport.detail.target')}
                  </dt>
                  <dd>
                    <Link
                      to={`/questions/${report.questionId}`}
                      className="inline-flex min-h-11 items-center break-all font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      {report.questionId}
                    </Link>
                  </dd>
                </>
              ) : null}
            </dl>
          </section>
          {report.internalNote ? (
            <section className="rounded-xl border border-dashed border-line bg-surface-sunken p-4 text-sm">
              <h2 className="font-semibold text-muted">
                {t('userReport.detail.noteTitle')}
              </h2>
              <p className="mt-2 whitespace-pre-wrap break-words">
                {report.internalNote}
              </p>
            </section>
          ) : null}
          {report.reporterReply ? (
            <section className={cardClass}>
              <h2 className="text-lg font-bold">
                {t('userReport.detail.sentReply')}
              </h2>
              <p className="mt-3 whitespace-pre-wrap break-words">
                {report.reporterReply}
              </p>
              {report.repliedAt ? (
                <p className="mt-3 text-sm text-muted">
                  {t('userReport.detail.repliedAt')}:{' '}
                  {formatAdminDateTime(report.repliedAt)}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
        <ReportProcessPanel report={report} onConflict={onConflict} />
      </div>
    </>
  )
}
