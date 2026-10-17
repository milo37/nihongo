import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type {
  ListAdminQuestionReportsQuery,
  QuestionReportSummary
} from '@nihongo/contracts/admin/phase7'
import {
  adminActorLabelKey,
  adminReportReasonKey,
  adminReportStatusKey
} from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { reportDetailHref } from '@app/admin-report/navigation/reportListContext'
import { Badge } from '@common/components/Badge'
import { Icon } from '@common/components/Icon'
type ReportListRowProps = {
  readonly report: QuestionReportSummary
  readonly query: ListAdminQuestionReportsQuery
  readonly navigationEnabled?: boolean
}
export const ReportListRow = ({
  report,
  query,
  navigationEnabled = true
}: ReportListRowProps): ReactElement => {
  const { t, formatAdminDateTime } = useAdminPresentation()
  const { t: labels } = useTranslation('adminReports')
  const reason = t(adminReportReasonKey[report.reason])
  return (
    <li className="admin-report-row">
      <div className="admin-report-row-status">
        <Badge variant={report.status === 'OPEN' ? 'brand' : 'neutral'}>
          {t(adminReportStatusKey[report.status])}
        </Badge>
      </div>
      <div className="admin-report-row-content">
        <h2>{reason}</h2>
        <p>
          {t('reportList.questionId')}: {report.questionId}
        </p>
        <details className="admin-report-metadata">
          <summary>
            {labels('metadata')}
            <Icon name="chevron-right" />
          </summary>
          <dl className="admin-report-facts">
            <div>
              <dt>{t('common.reporter')}</dt>
              <dd>
                {t(adminActorLabelKey[report.reporter.label])} ·{' '}
                {report.reporter.actorId}
              </dd>
            </div>
            <div>
              <dt>{t('common.assignee')}</dt>
              <dd>
                {report.assignee ? (
                  <>
                    {t(adminActorLabelKey[report.assignee.label])} ·{' '}
                    {report.assignee.actorId}
                  </>
                ) : (
                  t('common.unassigned')
                )}
              </dd>
            </div>
            <div>
              <dt>{t('common.createdAt')}</dt>
              <dd>
                <time dateTime={report.createdAt}>
                  {formatAdminDateTime(report.createdAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>{t('common.version')}</dt>
              <dd>{report.questionVersionId}</dd>
            </div>
          </dl>
        </details>
      </div>
      <time className="admin-report-row-date" dateTime={report.updatedAt}>
        {formatAdminDateTime(report.updatedAt)}
      </time>
      {navigationEnabled ? (
        <Link
          className="admin-report-link admin-report-row-link"
          to={reportDetailHref(report.id, query)}
          data-report-id={report.id}
          aria-label={labels('detailLabel', { reason, id: report.id })}
        >
          {t('common.details')}
          <Icon name="chevron-right" />
        </Link>
      ) : (
        <span
          className="admin-report-link admin-report-row-link"
          aria-disabled="true"
        >
          {t('common.details')}
        </span>
      )}
    </li>
  )
}
