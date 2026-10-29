import { useEffect, useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { Link, useBlocker, useParams } from 'react-router'
import { getAdminQuestionReportParamsSchema } from '@nihongo/contracts/admin/phase7'
import { Button } from '@nihongo/browser/common/components/Button'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import {
  captureAuthTransitionEpoch,
  assertCurrentAuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { AdminNavigation } from '@app/admin/components/AdminNavigation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import {
  ReportResolutionForm,
  emptyReportResolution
} from '@app/admin-report/components/ReportResolutionForm'
import type { ReportResolutionDraft } from '@app/admin-report/components/ReportResolutionForm'
import { useAdminReportDetail } from '@app/admin-report/hooks/useAdminReportQueries'
import {
  useTriageAdminReport,
  useResolveAdminReport
} from '@app/admin-report/hooks/useAdminReportCommands'
import {
  discardReportDraft,
  readReportReturn,
  restoreReportDraft,
  saveReportDraft
} from '@app/admin-report/navigation/reportDraftRecovery'
import { reportDetailHref } from '@app/admin-report/navigation/reportListContext'

const errorCode = (error: unknown): string | null =>
  error &&
  typeof error === 'object' &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : null
export const AdminReportDetailPage = (): ReactElement => {
  const { reportId = '' } = useParams()
  const { user, role } = useAuth()
  const epoch = captureAuthTransitionEpoch()
  const report = useAdminReportDetail(reportId)
  const { t } = useAdminPresentation()
  const heading = useRef<HTMLHeadingElement>(null)
  return user && role === 'ADMIN' ? (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <AdminNavigation />
      <Link
        to={readReportReturn(user.id, reportId).slice('/admin'.length)}
        className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        {t('reportDetail.back')}
      </Link>
      <h1
        ref={heading}
        tabIndex={-1}
        className="mt-4 rounded-sm text-balance text-3xl font-black sm:text-4xl"
      >
        {t('reportDetail.title')}
      </h1>
      <ReportDetail
        key={`${user.id}:${epoch}:${reportId}:${report.data ? 'ready' : 'loading'}`}
        actorId={user.id}
        epoch={epoch}
        reportId={reportId}
        report={report}
        heading={heading}
      />
    </section>
  ) : (
    <></>
  )
}

const ReportDetail = ({
  actorId,
  epoch,
  reportId,
  report,
  heading
}: {
  actorId: string
  epoch: number
  reportId: string
  report: ReturnType<typeof useAdminReportDetail>
  heading: RefObject<HTMLHeadingElement | null>
}): ReactElement => {
  const { t, presentError, formatAdminDateTime } = useAdminPresentation()
  const [recovered] = useState(() =>
    report.data?.status === 'TRIAGED' &&
    report.isSuccess &&
    !report.isFetching &&
    !report.isOffline
      ? restoreReportDraft(actorId, reportId, report.data.rowVersion)
      : null
  )
  const [draft, setDraft] = useState<ReportResolutionDraft>(
    recovered ?? emptyReportResolution
  )
  const [message, setMessage] = useState(() =>
    recovered ? t('reportDetail.restored') : ''
  )
  const [conflict, setConflict] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const [refreshingConflict, setRefreshingConflict] = useState(false)
  const leavingForFresh = useRef(false)
  const assertActor = (): void =>
    assertCurrentAuthActorTransitionFence(
      { actorId, epoch, role: 'ADMIN' },
      useAppStore.getState().currentUser
    )
  const failed = (error: unknown): void => {
    if (
      errorCode(error) === 'VERSION_CONFLICT' ||
      errorCode(error) === 'INVALID_STATE_TRANSITION'
    )
      setConflict(true)
  }
  const triage = useTriageAdminReport(
    reportId,
    (status) => {
      setMessage(
        t('reportDetail.statusChanged', {
          status: t(`enums.reportStatuses.${status}`)
        })
      )
      heading.current?.focus()
    },
    failed
  )
  const resolve = useResolveAdminReport(
    reportId,
    (status) => {
      discardReportDraft(actorId, reportId)
      setDraft(emptyReportResolution)
      setStorageFailed(false)
      setMessage(
        t('reportDetail.resolutionComplete', {
          status: t(`enums.reportStatuses.${status}`)
        })
      )
      heading.current?.focus()
    },
    failed
  )
  const pending = triage.isPending || resolve.isPending
  const dirty =
    draft.outcome !== 'RESOLVED' ||
    draft.reason.length > 0 ||
    draft.remediationVersionId.length > 0
  const blocker = useBlocker(dirty || pending)
  useEffect(() => {
    if (!dirty && !pending) return
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!leavingForFresh.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty, pending])
  const mutationError = resolve.error ?? triage.error
  const fresh = errorCode(resolve.error) === 'FRESH_ASSURANCE_REQUIRED'
  const locked =
    !report.data ||
    report.isError ||
    report.isFetching ||
    report.fetchStatus === 'paused' ||
    report.isOffline ||
    pending ||
    conflict ||
    fresh ||
    refreshingConflict
  const refresh = async (): Promise<void> => {
    setRefreshingConflict(true)
    try {
      assertActor()
      const result = await report.refetch()
      assertActor()
      if (!result.isSuccess || result.fetchStatus !== 'idle') {
        setMessage(t('reportDetail.conflictRefreshFailed'))
        return
      }
      setConflict(false)
      triage.reset()
      resolve.reset()
      setMessage(t('reportDetail.conflictRefreshed'))
      heading.current?.focus()
    } catch {
      /* An auth transition must not update the next actor's view. */
    } finally {
      setRefreshingConflict(false)
    }
  }
  const beginFresh = (): void => {
    if (!report.data || report.data.status !== 'TRIAGED' || pending) return
    try {
      assertActor()
      if (!saveReportDraft(actorId, reportId, report.data.rowVersion, draft)) {
        setStorageFailed(true)
        return
      }
      leavingForFresh.current = true
      appDocumentNavigation.assign(
        `/login?redirect=${encodeURIComponent('/admin' + reportDetailHref(reportId))}`
      )
    } catch {
      leavingForFresh.current = false
      setStorageFailed(true)
    }
  }
  const data = report.data
  const fieldErrors =
    resolve.error &&
    typeof resolve.error === 'object' &&
    'fieldErrors' in resolve.error
      ? resolve.error.fieldErrors
      : undefined
  const validFields =
    fieldErrors &&
    typeof fieldErrors === 'object' &&
    Object.values(fieldErrors).every(
      (value) =>
        Array.isArray(value) && value.every((item) => typeof item === 'string')
    )
      ? (fieldErrors as Record<string, string[]>)
      : undefined
  return (
    <>
      <p role="status" className="mt-4 text-muted">
        {message}
      </p>
      {!getAdminQuestionReportParamsSchema.safeParse({ reportId }).success ? (
        <ErrorState className="mt-8" description={t('errors.invalidId')} />
      ) : (
        <>
          {report.isError ||
          report.fetchStatus === 'paused' ||
          report.isOffline ? (
            <ErrorState
              className="mt-6"
              title={t(
                data ? 'reportDetail.cachedError' : 'reportDetail.error'
              )}
              description={
                report.fetchStatus === 'paused' || report.isOffline
                  ? t('common.pausedDescription')
                  : presentError(report.error)
              }
              onRetry={() => {
                void refresh()
              }}
              retryLabel={t('reportDetail.retry')}
              autoFocus={!data}
            />
          ) : null}
          {!data ? (
            report.isPending &&
            report.fetchStatus !== 'paused' &&
            !report.isOffline ? (
              <LoadingState
                className="mt-8"
                message={t('reportDetail.loading')}
              />
            ) : null
          ) : (
            <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.42fr)] lg:items-start">
              <div className="grid min-w-0 gap-6">
                <section className="min-w-0 rounded-xl border border-line bg-surface p-5 sm:p-6">
                  <Badge>{t(`enums.reportStatuses.${data.status}`)}</Badge>
                  <dl className="mt-5 grid min-w-0 gap-5 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm text-muted">
                        {t('common.reason')}
                      </dt>
                      <dd className="mt-1">
                        {t(`enums.reportReasons.${data.reason}`)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted">
                        {t('common.question')}
                      </dt>
                      <dd className="mt-1 break-all">{data.questionId}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted">
                        {t('common.reporter')}
                      </dt>
                      <dd className="mt-1 break-all">
                        {data.reporter.actorId}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted">
                        {t('common.assignee')}
                      </dt>
                      <dd className="mt-1 break-all">
                        {data.assignee?.actorId ?? t('common.unassigned')}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted">
                        {t('common.createdAt')}
                      </dt>
                      <dd className="mt-1">
                        {formatAdminDateTime(data.createdAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted">
                        {t('common.updatedAt')}
                      </dt>
                      <dd className="mt-1">
                        {formatAdminDateTime(data.updatedAt)}
                      </dd>
                    </div>
                  </dl>
                </section>
                <section className="min-w-0 rounded-xl border border-line bg-surface p-5 sm:p-6">
                  <h2 className="text-xl font-bold">
                    {t('reportDetail.description')}
                  </h2>
                  <p className="mt-4 whitespace-pre-wrap break-words leading-7">
                    {data.description ?? t('reportDetail.noDescription')}
                  </p>
                </section>
                {data.resolution ? (
                  <section className="min-w-0 rounded-xl border border-line bg-surface p-5 sm:p-6">
                    <h2 className="text-xl font-bold">
                      {t('reportDetail.resolved', {
                        outcome: t(
                          `enums.reportOutcomes.${data.resolution.outcome}`
                        )
                      })}
                    </h2>
                    <p className="mt-4 whitespace-pre-wrap break-words">
                      {data.resolution.reason}
                    </p>
                    {data.resolution.remediationVersionId ? (
                      <p className="mt-4 break-all">
                        {t('reportDetail.remediationVersionId')}:{' '}
                        {data.resolution.remediationVersionId}
                      </p>
                    ) : null}
                  </section>
                ) : null}
              </div>
              <div className="grid min-w-0 gap-5">
                {conflict && mutationError ? (
                  <ErrorState
                    density="inline"
                    title={t('reportDetail.conflictTitle')}
                    description={presentError(mutationError)}
                  />
                ) : null}
                {conflict ? (
                  <Button
                    variant="outline"
                    disabled={
                      pending ||
                      refreshingConflict ||
                      report.fetchStatus === 'paused' ||
                      report.isOffline
                    }
                    onClick={() => {
                      void refresh()
                    }}
                  >
                    {t('reportDetail.retryConflict')}
                  </Button>
                ) : null}
                {data.status === 'OPEN' ? (
                  <section className="grid gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
                    <h2 className="text-xl font-bold">
                      {t('reportDetail.triageTitle')}
                    </h2>
                    <p className="leading-7 text-muted">
                      {t('reportDetail.triageDescription')}
                    </p>
                    <Button
                      disabled={locked}
                      isLoading={triage.isPending}
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
                    pending={pending}
                    serverFieldErrors={validFields}
                    onChange={setDraft}
                    onSubmit={(input) => resolve.mutate(input)}
                  />
                ) : null}
                {mutationError && !conflict ? (
                  <ErrorState
                    density="inline"
                    title={t('reportDetail.mutationError')}
                    description={presentError(mutationError)}
                  />
                ) : null}
                {fresh ? (
                  <Button disabled={pending} onClick={beginFresh}>
                    {t('reportDetail.fresh')}
                  </Button>
                ) : null}
                {storageFailed ? (
                  <p role="alert" className="text-danger">
                    {t('reportDetail.storageFailed')}
                  </p>
                ) : null}
                {dirty ? (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      discardReportDraft(actorId, reportId)
                      setDraft(emptyReportResolution)
                      setStorageFailed(false)
                    }}
                  >
                    {t('reportDetail.discard')}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </>
      )}
      <Dialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset()
        }}
        title={t('reportDetail.leaveTitle')}
        preventClose={pending}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                if (blocker.state === 'blocked') blocker.reset()
              }}
            >
              {t('reportDetail.stay')}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                discardReportDraft(actorId, reportId)
                if (blocker.state === 'blocked') blocker.proceed()
              }}
            >
              {t('reportDetail.leave')}
            </Button>
          </>
        }
      >
        {pending ? t('reportDetail.pending') : t('reportDetail.leaveTitle')}
      </Dialog>
    </>
  )
}
