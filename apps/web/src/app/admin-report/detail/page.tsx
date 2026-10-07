import { useEffect, useRef, useState } from 'react'
import { Link, useBlocker, useParams } from 'react-router'
import type { ReactElement } from 'react'
import { resolveAdminQuestionReportRequestSchema } from '@nihongo/contracts/admin/phase7'
import {
  adminActorLabelKey,
  adminReportOutcomeKey,
  adminReportReasonKey,
  adminReportStatusKey
} from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { FreshAssuranceDialog } from '@app/admin-question/components/FreshAssuranceDialog'
import { useFreshAssurance } from '@app/admin-question/hooks/useFreshAssurance'
import {
  useResolvePhase7AdminQuestionReport,
  useTriagePhase7AdminQuestionReport
} from '@app/admin-question/hooks/usePhase7AdminMutations'
import { isPhase7UiApiError } from '@libs/apiError'
import { usePhase7AdminQuestionReportDetail } from '@app/admin-question/hooks/usePhase7AdminQueries'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { ErrorState } from '@common/components/ErrorState'
import { Input } from '@common/components/Input'
import { LoadingState } from '@common/components/LoadingState'
import { Select } from '@common/components/Select'
import { Textarea } from '@common/components/Textarea'

export const AdminQuestionReportDetailPage = (): ReactElement => {
  const { formatAdminDateTime, presentError, presentFieldError, t } =
    useAdminPresentation()
  const { reportId = '' } = useParams()
  const freshAssurance = useFreshAssurance()
  const [outcome, setOutcome] = useState<'RESOLVED' | 'DISMISSED'>('RESOLVED')
  const [reason, setReason] = useState('')
  const [remediationVersionId, setRemediationVersionId] = useState('')
  const [announcement, setAnnouncement] = useState<
    | {
        readonly kind: 'RESOLUTION_COMPLETE' | 'STATUS_CHANGED'
        readonly status: 'DISMISSED' | 'OPEN' | 'RESOLVED' | 'TRIAGED'
      }
    | { readonly kind: 'CONFLICT_REFRESHED' }
    | null
  >(null)
  const [conflictRefreshFailed, setConflictRefreshFailed] = useState(false)
  const outcomeRef = useRef<HTMLSelectElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const remediationRef = useRef<HTMLInputElement>(null)
  const report = usePhase7AdminQuestionReportDetail(reportId)
  const isPaused = report.fetchStatus === 'paused'
  const writesLocked = isPaused || report.isError || report.isFetching

  const triage = useTriagePhase7AdminQuestionReport(reportId, (status) => {
    setConflictRefreshFailed(false)
    setAnnouncement({ kind: 'STATUS_CHANGED', status })
  })

  const resolve = useResolvePhase7AdminQuestionReport(
    reportId,
    (status) => {
      setConflictRefreshFailed(false)
      setAnnouncement({ kind: 'RESOLUTION_COMPLETE', status })
    },
    (error) => {
      if (
        isPhase7UiApiError(error) &&
        error.code === 'FRESH_ASSURANCE_REQUIRED'
      ) {
        freshAssurance.open({
          questionIds: report.data ? [report.data.questionId] : [],
          reportId,
          reasonCode: 'REPORT_RESOLUTION'
        })
      }
      if (isPhase7UiApiError(error)) {
        if (error.fieldErrors?.outcome?.length) outcomeRef.current?.focus()
        else if (error.fieldErrors?.reason?.length) reasonRef.current?.focus()
        else if (error.fieldErrors?.remediationVersionId?.length) {
          remediationRef.current?.focus()
        }
      }
    }
  )
  const isResolutionDirty = Boolean(
    report.data?.status === 'TRIAGED' &&
      (outcome !== 'RESOLVED' ||
        reason.length > 0 ||
        remediationVersionId.length > 0)
  )
  const navigationBlocker = useBlocker(isResolutionDirty && !resolve.isPending)

  useEffect(() => {
    if (!isResolutionDirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isResolutionDirty])

  useEffect(() => {
    if (isResolutionDirty || navigationBlocker.state !== 'blocked') return
    navigationBlocker.proceed()
  }, [isResolutionDirty, navigationBlocker])

  if (report.isPending && !report.data && isPaused) {
    return (
      <ErrorState
        autoFocus
        description={t('common.pausedDescription')}
        headingLevel={1}
        onRetry={() => void report.refetch()}
        title={t('common.pausedTitle')}
      />
    )
  }
  if (report.isPending && !report.data)
    return <LoadingState message={t('reportDetail.loading')} />
  if (!report.data) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <ErrorState
          autoFocus
          description={presentError(report.error)}
          headingLevel={1}
          onRetry={() => void report.refetch()}
        />
      </section>
    )
  }

  const mutationError = triage.error ?? resolve.error
  const hasVersionConflict =
    mutationError !== null &&
    isPhase7UiApiError(mutationError) &&
    mutationError.code === 'VERSION_CONFLICT'
  const resolutionRequest = resolveAdminQuestionReportRequestSchema.safeParse({
    expectedRowVersion: report.data.rowVersion,
    outcome,
    reason,
    remediationVersionId:
      outcome === 'RESOLVED' && remediationVersionId.trim()
        ? remediationVersionId.trim()
        : null
  })
  const serverFieldErrors =
    mutationError && isPhase7UiApiError(mutationError)
      ? mutationError.fieldErrors
      : undefined
  const outcomeError = presentFieldError(serverFieldErrors?.outcome)
  const reasonError = resolutionRequest.success
    ? presentFieldError(serverFieldErrors?.reason)
    : resolutionRequest.error.issues.some((issue) => issue.path[0] === 'reason')
      ? t('errors.fieldInvalid')
      : presentFieldError(serverFieldErrors?.reason)
  const remediationError = resolutionRequest.success
    ? presentFieldError(serverFieldErrors?.remediationVersionId)
    : resolutionRequest.error.issues.some(
          (issue) => issue.path[0] === 'remediationVersionId'
        )
      ? t('errors.fieldInvalid')
      : presentFieldError(serverFieldErrors?.remediationVersionId)

  const focusFirstResolutionError = (): void => {
    const firstPath = resolutionRequest.success
      ? undefined
      : resolutionRequest.error.issues[0]?.path[0]
    if (firstPath === 'reason') reasonRef.current?.focus()
    else if (firstPath === 'remediationVersionId') {
      remediationRef.current?.focus()
    }
  }

  const refreshAfterConflict = async (): Promise<void> => {
    setConflictRefreshFailed(false)
    const refreshed = await report.refetch()
    if (!refreshed.isSuccess || !refreshed.data) {
      setConflictRefreshFailed(true)
      return
    }
    triage.reset()
    resolve.reset()
    setAnnouncement({ kind: 'CONFLICT_REFRESHED' })
  }

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label={t('common.breadcrumbLabel')}>
        <Link
          className="font-semibold text-brand underline"
          to="/admin/reports"
        >
          {t('common.reports')}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span aria-current="page">{t('common.reportDetail')}</span>
      </nav>
      <header className="mt-6 border-b border-line pb-8">
        <Badge variant={report.data.status === 'OPEN' ? 'warning' : 'neutral'}>
          {t(adminReportStatusKey[report.data.status])}
        </Badge>
        <h1 className="mt-3 text-3xl font-black">{t('reportDetail.title')}</h1>
        <p className="mt-2 font-mono text-xs text-muted">{report.data.id}</p>
      </header>

      {report.isError || isPaused ? (
        <div
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="alert"
        >
          <p className="font-semibold">
            {isPaused
              ? t('common.cachedPausedDescription')
              : t('reportDetail.cachedError')}
          </p>
          <p className="mt-1 text-sm">
            {isPaused
              ? t('common.pausedDescription')
              : presentError(report.error)}
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void report.refetch()}
          >
            {t('reportDetail.retry')}
          </Button>
        </div>
      ) : null}

      <dl className="mt-8 grid gap-4 rounded-2xl border border-line bg-white p-5 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-semibold text-muted">
            {t('common.question')}
          </dt>
          <dd className="mt-1 break-all">{report.data.questionId}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">
            {t('common.version')}
          </dt>
          <dd className="mt-1 break-all">{report.data.questionVersionId}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">
            {t('common.reason')}
          </dt>
          <dd className="mt-1">
            {t(adminReportReasonKey[report.data.reason])}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">rowVersion</dt>
          <dd className="mt-1">{report.data.rowVersion}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">
            {t('common.reporter')}
          </dt>
          <dd className="mt-1">
            {t(adminActorLabelKey[report.data.reporter.label])} ·{' '}
            {report.data.reporter.actorId}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">
            {t('common.assignee')}
          </dt>
          <dd className="mt-1">
            {report.data.assignee
              ? `${t(adminActorLabelKey[report.data.assignee.label])} · ${report.data.assignee.actorId}`
              : t('common.unassigned')}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">
            {t('common.createdAt')}
          </dt>
          <dd className="mt-1">
            <time dateTime={report.data.createdAt}>
              {formatAdminDateTime(report.data.createdAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">
            {t('common.updatedAt')}
          </dt>
          <dd className="mt-1">
            <time dateTime={report.data.updatedAt}>
              {formatAdminDateTime(report.data.updatedAt)}
            </time>
          </dd>
        </div>
      </dl>
      <article className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="text-lg font-bold">{t('reportDetail.description')}</h2>
        <p className="mt-3 whitespace-pre-wrap break-words leading-7">
          {report.data.description ?? t('reportDetail.noDescription')}
        </p>
      </article>

      {report.data.status === 'OPEN' ? (
        <div className="mt-6 rounded-2xl border border-line bg-white p-5">
          <h2 className="text-lg font-bold">{t('reportDetail.triageTitle')}</h2>
          <p className="mt-2 text-muted">
            {t('reportDetail.triageDescription')}
          </p>
          <Button
            className="mt-4"
            disabled={writesLocked || triage.isPending}
            isLoading={triage.isPending}
            onClick={() => triage.mutate(report.data.rowVersion)}
          >
            {t('reportDetail.triage')}
          </Button>
        </div>
      ) : null}

      {report.data.status === 'TRIAGED' ? (
        <form
          className="mt-6 grid gap-4 rounded-2xl border border-line bg-white p-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (writesLocked || resolve.isPending) return
            if (resolutionRequest.success) {
              resolve.mutate(resolutionRequest.data)
            } else {
              focusFirstResolutionError()
            }
          }}
        >
          <h2 className="text-lg font-bold">
            {t('reportDetail.resolutionTitle')}
          </h2>
          <Select
            ref={outcomeRef}
            error={outcomeError}
            disabled={resolve.isPending}
            label={t('reportDetail.outcome')}
            name="outcome"
            value={outcome}
            onChange={(event) =>
              setOutcome(event.currentTarget.value as 'RESOLVED' | 'DISMISSED')
            }
          >
            <option value="RESOLVED">
              {t(adminReportOutcomeKey.RESOLVED)}
            </option>
            <option value="DISMISSED">
              {t(adminReportOutcomeKey.DISMISSED)}
            </option>
          </Select>
          <Textarea
            ref={reasonRef}
            disabled={resolve.isPending}
            error={reasonError}
            label={t('reportDetail.resolutionReason')}
            maxLength={1000}
            name="resolution-reason"
            required
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          {outcome === 'RESOLVED' ? (
            <Input
              ref={remediationRef}
              disabled={resolve.isPending}
              error={remediationError}
              hint={t('reportDetail.remediationHint')}
              label={t('reportDetail.remediationVersionId')}
              name="remediation-version-id"
              value={remediationVersionId}
              onChange={(event) =>
                setRemediationVersionId(event.currentTarget.value)
              }
            />
          ) : null}
          <Button
            disabled={writesLocked || resolve.isPending}
            isLoading={resolve.isPending}
            type="submit"
          >
            {t('reportDetail.resolve')}
          </Button>
        </form>
      ) : null}

      {report.data.resolution ? (
        <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="font-bold">
            {t('reportDetail.resolved', {
              outcome: t(adminReportOutcomeKey[report.data.resolution.outcome])
            })}
          </h2>
          <p className="mt-2 whitespace-pre-wrap break-words">
            {report.data.resolution.reason}
          </p>
        </section>
      ) : null}

      {mutationError ? (
        <ErrorState
          className="mt-6"
          description={
            conflictRefreshFailed
              ? t('reportDetail.conflictRefreshFailed')
              : isPhase7UiApiError(mutationError)
                ? presentError(mutationError)
                : t('reportDetail.mutationError')
          }
          onRetry={
            hasVersionConflict ? () => void refreshAfterConflict() : undefined
          }
          retryLabel={t('reportDetail.retryConflict')}
          title={
            hasVersionConflict ? t('reportDetail.conflictTitle') : undefined
          }
        />
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announcement?.kind === 'STATUS_CHANGED'
          ? t('reportDetail.statusChanged', {
              status: t(adminReportStatusKey[announcement.status])
            })
          : announcement?.kind === 'RESOLUTION_COMPLETE'
            ? t('reportDetail.resolutionComplete', {
                status: t(adminReportStatusKey[announcement.status])
              })
            : announcement?.kind === 'CONFLICT_REFRESHED'
              ? t('reportDetail.conflictRefreshed')
              : ''}
      </p>
      {freshAssurance.completionMessage ? (
        <p
          className="mt-6 rounded-xl border border-success-line bg-success-soft p-4 font-semibold text-success-strong"
          role="status"
        >
          {freshAssurance.completionMessage}
        </p>
      ) : null}
      <FreshAssuranceDialog controller={freshAssurance} />
      <Dialog
        fallbackFocusRef={reasonRef}
        open={navigationBlocker.state === 'blocked'}
        title={t('editor.unsavedTitle')}
        description={t('editor.unsavedDescription')}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                if (navigationBlocker.state === 'blocked') {
                  navigationBlocker.reset()
                }
              }}
            >
              {t('editor.keepEditing')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (navigationBlocker.state === 'blocked') {
                  navigationBlocker.proceed()
                }
              }}
            >
              {t('editor.discardAndLeave')}
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open && navigationBlocker.state === 'blocked') {
            navigationBlocker.reset()
          }
        }}
      />
    </section>
  )
}
