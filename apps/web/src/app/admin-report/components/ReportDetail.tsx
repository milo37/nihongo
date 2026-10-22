import { useEffect, useState } from 'react'
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import {
  adminActorLabelKey,
  adminReportOutcomeKey,
  adminReportReasonKey,
  adminReportStatusKey
} from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { FreshAssuranceDialog } from '@app/admin-question/components/FreshAssuranceDialog'
import { useFreshAssurance } from '@app/admin-question/hooks/useFreshAssurance'
import { useAdminReportDetail } from '@app/admin-report/hooks/useAdminReportQueries'
import {
  useResolveAdminReport,
  useTriageAdminReport
} from '@app/admin-report/hooks/useAdminReportCommands'
import {
  ReportResolutionForm,
  emptyReportResolution,
  type ReportResolutionDraft
} from '@app/admin-report/components/ReportResolutionForm'
import { reportReturnHref } from '@app/admin-report/navigation/reportListContext'
import { isPhase7UiApiError } from '@libs/apiError'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Select } from '@common/components/Select'
type ReportDetailProps = { readonly reportId: string }
export const ReportDetail = ({ reportId }: ReportDetailProps): ReactElement => {
  const { t, formatAdminDateTime, presentError } = useAdminPresentation()
  const { t: labels } = useTranslation('adminReports')
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const report = useAdminReportDetail(reportId)
  const fresh = useFreshAssurance()
  const [draft, setDraft] = useState<ReportResolutionDraft>(
    emptyReportResolution
  )
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const [conflictRefreshFailed, setConflictRefreshFailed] = useState(false)
  const triage = useTriageAdminReport(reportId, (status) => {
    setConflictRefreshFailed(false)
    setAnnouncement(
      t('reportDetail.statusChanged', {
        status: t(adminReportStatusKey[status])
      })
    )
  })
  const resolve = useResolveAdminReport(
    reportId,
    (status) => {
      setDraft(emptyReportResolution)
      setConflictRefreshFailed(false)
      setAnnouncement(
        t('reportDetail.resolutionComplete', {
          status: t(adminReportStatusKey[status])
        })
      )
    },
    (error) => {
      if (
        isPhase7UiApiError(error) &&
        error.code === 'FRESH_ASSURANCE_REQUIRED'
      )
        fresh.open({
          questionIds: report.data ? [report.data.questionId] : [],
          reportId,
          reasonCode: 'REPORT_RESOLUTION'
        })
    }
  )
  const pending = triage.isPending || resolve.isPending || fresh.isPending
  const dirty =
    draft.outcome !== 'RESOLVED' ||
    draft.reason.length > 0 ||
    draft.remediationVersionId.length > 0
  const blocker = useBlocker(dirty || pending)
  useEffect(() => {
    if (!dirty && !pending && blocker.state === 'blocked') blocker.proceed()
  }, [dirty, pending, blocker])
  useEffect(() => {
    if (!dirty && !pending) return
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty, pending])
  const resolutionError = resolve.error
  const resetResolution = resolve.reset
  useEffect(() => {
    if (
      fresh.completionMessage &&
      isPhase7UiApiError(resolutionError) &&
      resolutionError.code === 'FRESH_ASSURANCE_REQUIRED'
    )
      resetResolution()
  }, [fresh.completionMessage, resolutionError, resetResolution])
  const mutationError = resolve.error ?? triage.error
  const conflict =
    isPhase7UiApiError(mutationError) &&
    mutationError.code === 'VERSION_CONFLICT'
  const paused = report.isOffline || report.fetchStatus === 'paused'
  const locked =
    !report.data ||
    report.isError ||
    report.isFetching ||
    paused ||
    pending ||
    conflict ||
    fresh.isOpen ||
    fresh.recoveryRequired
  const serverFieldErrors = isPhase7UiApiError(resolve.error)
    ? resolve.error.fieldErrors
    : undefined
  const refreshConflict = async (): Promise<void> => {
    setConflictRefreshFailed(false)
    const result = await report.refetch()
    if (!result.isSuccess || !result.data) {
      setConflictRefreshFailed(true)
      return
    }
    triage.reset()
    resolve.reset()
    setAnnouncement(t('reportDetail.conflictRefreshed'))
  }
  const data = report.data
  return (
    <section className="admin-report-page admin-report-detail">
      <nav
        className="admin-report-navigation"
        aria-label={labels('navigation')}
      >
        <div className="admin-report-desktop-navigation">
          <Link to="/admin/questions">{t('common.questions')}</Link>
          <Link to="/admin/reports" aria-current="location">
            {t('common.reports')}
          </Link>
        </div>
        <div className="admin-report-mobile-navigation">
          <Select
            name="report-management-menu"
            label={labels('navigation')}
            hideLabel
            value="/admin/reports"
            options={[
              { value: '/admin/questions', label: t('common.questions') },
              { value: '/admin/reports', label: t('common.reports') }
            ]}
            onChange={(event) => void navigate(event.currentTarget.value)}
          />
        </div>
      </nav>
      <Link className="admin-report-link" to={reportReturnHref(search)}>
        {labels('returnList')}
      </Link>
      <header className="admin-report-heading">
        <h1>{labels('detailTitle')}</h1>
        <p>{reportId}</p>
      </header>
      {announcement ? <p role="status">{announcement}</p> : null}
      {fresh.completionMessage ? (
        <p role="status">{fresh.completionMessage}</p>
      ) : null}
      {report.isError || paused ? (
        <ErrorState
          title={paused ? t('common.pausedTitle') : t('reportDetail.error')}
          description={
            paused
              ? t(
                  data
                    ? 'common.cachedPausedDescription'
                    : 'common.pausedDescription'
                )
              : data
                ? t('reportDetail.cachedError')
                : presentError(report.error)
          }
          onRetry={() => void report.refetch()}
          retryLabel={t('reportDetail.retry')}
          density={data ? 'inline' : 'regular'}
        />
      ) : null}
      {report.isPending && !data && !paused ? (
        <LoadingState message={t('reportDetail.loading')} />
      ) : null}
      {data ? (
        <div className="admin-report-detail-grid">
          <div className="admin-report-detail-content">
            <section
              className="admin-report-panel"
              aria-label={labels('metadata')}
            >
              <Badge variant={data.status === 'OPEN' ? 'brand' : 'neutral'}>
                {t(adminReportStatusKey[data.status])}
              </Badge>
              <dl className="admin-report-facts">
                <div>
                  <dt>{t('common.reason')}</dt>
                  <dd>{t(adminReportReasonKey[data.reason])}</dd>
                </div>
                <div>
                  <dt>{t('common.question')}</dt>
                  <dd>{data.questionId}</dd>
                </div>
                <div>
                  <dt>{t('common.version')}</dt>
                  <dd>{data.questionVersionId}</dd>
                </div>
                <div>
                  <dt>{t('common.reporter')}</dt>
                  <dd>
                    {t(adminActorLabelKey[data.reporter.label])} ·{' '}
                    {data.reporter.actorId}
                  </dd>
                </div>
                <div>
                  <dt>{t('common.assignee')}</dt>
                  <dd>
                    {data.assignee ? (
                      <>
                        {t(adminActorLabelKey[data.assignee.label])} ·{' '}
                        {data.assignee.actorId}
                      </>
                    ) : (
                      t('common.unassigned')
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('common.createdAt')}</dt>
                  <dd>
                    <time dateTime={data.createdAt}>
                      {formatAdminDateTime(data.createdAt)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>{t('common.updatedAt')}</dt>
                  <dd>
                    <time dateTime={data.updatedAt}>
                      {formatAdminDateTime(data.updatedAt)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>{t('common.rowVersion')}</dt>
                  <dd>{data.rowVersion}</dd>
                </div>
              </dl>
              <p className="admin-report-secondary">
                {labels('targetPending')}
              </p>
            </section>
            <section className="admin-report-panel">
              <h2>{t('reportDetail.description')}</h2>
              <p className="admin-report-prose">
                {data.description ?? t('reportDetail.noDescription')}
              </p>
            </section>
          </div>
          <div className="admin-report-detail-processing">
            {mutationError ? (
              <ErrorState
                title={t(
                  conflict
                    ? 'reportDetail.conflictTitle'
                    : 'reportDetail.mutationError'
                )}
                description={
                  conflictRefreshFailed
                    ? t('reportDetail.conflictRefreshFailed')
                    : presentError(mutationError)
                }
                onRetry={conflict ? () => void refreshConflict() : undefined}
                retryLabel={t('reportDetail.retryConflict')}
                density="inline"
              />
            ) : null}
            {data.status === 'OPEN' ? (
              <section className="admin-report-panel">
                <h2>{t('reportDetail.triageTitle')}</h2>
                <p>{t('reportDetail.triageDescription')}</p>
                <Button
                  disabled={locked}
                  isLoading={triage.isPending}
                  loadingLabel={t('editor.saving')}
                  onClick={() =>
                    triage.mutate({ expectedRowVersion: data.rowVersion })
                  }
                >
                  {t('reportDetail.triage')}
                </Button>
              </section>
            ) : null}
            {data.status === 'TRIAGED' ? (
              <ReportResolutionForm
                draft={draft}
                rowVersion={data.rowVersion}
                locked={locked}
                pending={resolve.isPending}
                serverFieldErrors={serverFieldErrors}
                onChange={setDraft}
                onSubmit={(request) => {
                  if (!locked) resolve.mutate(request)
                }}
              />
            ) : null}
            {data.resolution ? (
              <section className="admin-report-panel">
                <h2>
                  {t('reportDetail.resolved', {
                    outcome: t(adminReportOutcomeKey[data.resolution.outcome])
                  })}
                </h2>
                <p className="admin-report-prose">{data.resolution.reason}</p>
                {data.resolution.remediationVersionId ? (
                  <p>
                    {t('reportDetail.remediationVersionId')}:{' '}
                    {data.resolution.remediationVersionId}
                  </p>
                ) : null}
                <time dateTime={data.resolution.resolvedAt}>
                  {formatAdminDateTime(data.resolution.resolvedAt)}
                </time>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
      <FreshAssuranceDialog controller={fresh} />
      <Dialog
        open={blocker.state === 'blocked'}
        preventClose={pending}
        title={t('editor.unsavedTitle')}
        description={t('editor.unsavedDescription')}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked' && !pending) blocker.reset()
        }}
      >
        <div className="admin-report-actions">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (blocker.state === 'blocked') blocker.reset()
            }}
          >
            {t('editor.keepEditing')}
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (blocker.state === 'blocked') blocker.proceed()
            }}
          >
            {t('editor.discardAndLeave')}
          </Button>
        </div>
      </Dialog>
    </section>
  )
}
