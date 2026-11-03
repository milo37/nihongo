import { useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { Link, useParams } from 'react-router'
import type { AdminReportDetail } from '@nihongo/contracts/admin/reports'
import { Button } from '@nihongo/browser/common/components/Button'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useAdminReportDetail } from '@app/admin-report/hooks/useAdminReportQueries'
import {
  useCloseAdminReport,
  useReplyAndCloseAdminReport,
  useSaveAdminReportNote
} from '@app/admin-report/hooks/useAdminReportCommands'
import { readReportReturn } from '@app/admin-report/navigation/reportListFocus'
import { ReportStatusBadge } from '@app/admin-report/components/ReportStatusBadge'

const errorCode = (error: unknown): string | null =>
  error &&
  typeof error === 'object' &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : null

const cardClass = 'rounded-xl border border-line bg-surface p-5 sm:p-6'

export const AdminReportDetailPage = (): ReactElement => {
  const { reportId = '' } = useParams()
  const { user, role } = useAuth()
  const report = useAdminReportDetail(reportId)
  const { t, presentError } = useAdminPresentation()
  const heading = useRef<HTMLHeadingElement>(null)
  if (!user || role !== 'ADMIN') return <></>
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
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
    </section>
  )
}

type Outcome = 'repliedClosed' | 'noteSaved' | 'closed'

const ReportDetail = ({
  report,
  heading,
  onConflict
}: {
  report: AdminReportDetail
  heading: RefObject<HTMLHeadingElement | null>
  onConflict: () => void
}): ReactElement => {
  const { t, presentError, formatAdminDateTime } = useAdminPresentation()
  const statusRef = useRef<HTMLParagraphElement>(null)
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const [reply, setReply] = useState('')
  const [note, setNote] = useState(report.internalNote ?? '')
  const [replyRequired, setReplyRequired] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  // After a conflict the memo field shows the latest saved memo; the admin's
  // own draft is kept aside so a later command never silently overwrites it.
  const [conflictPending, setConflictPending] = useState(false)
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const [seenRowVersion, setSeenRowVersion] = useState(report.rowVersion)
  if (report.rowVersion !== seenRowVersion) {
    setSeenRowVersion(report.rowVersion)
    if (conflictPending) {
      const latest = report.internalNote ?? ''
      setConflictPending(false)
      if (latest !== note) setNoteDraft(note)
      setNote(latest)
    }
  }
  const announce = (next: Outcome) => (): void => {
    setFailure(null)
    setNoteDraft(null)
    setOutcome(next)
    window.requestAnimationFrame(() => statusRef.current?.focus())
  }
  const fail = (error: unknown): void => {
    setOutcome(null)
    setFailure(error)
    setReplyRequired(false)
    // The reply stays; the latest row version and memo are loaded.
    if (errorCode(error) === 'VERSION_CONFLICT') {
      setConflictPending(true)
      onConflict()
    }
    window.requestAnimationFrame(() => statusRef.current?.focus())
  }
  const replyAndClose = useReplyAndCloseAdminReport(report.reportId, {
    onSuccess: announce('repliedClosed'),
    onError: fail
  })
  const saveNote = useSaveAdminReportNote(report.reportId, {
    onSuccess: announce('noteSaved'),
    onError: fail
  })
  const close = useCloseAdminReport(report.reportId, {
    onSuccess: announce('closed'),
    onError: fail
  })
  const pending =
    replyAndClose.isPending || saveNote.isPending || close.isPending
  const isOpen = report.status === 'RECEIVED'
  const expectedRowVersion = report.rowVersion
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
        <div className="grid min-w-0 content-start gap-4">
          <section className={cardClass} aria-labelledby="report-process">
            <h2 id="report-process" className="text-lg font-bold">
              {t('userReport.detail.process')}
            </h2>
            <p
              ref={statusRef}
              tabIndex={-1}
              role={failure ? 'alert' : 'status'}
              className={
                'mt-2 text-sm font-semibold ' +
                (failure ? 'text-danger' : 'text-success-strong')
              }
            >
              {failure
                ? errorCode(failure) === 'VERSION_CONFLICT'
                  ? t('userReport.detail.conflict')
                  : presentError(failure)
                : outcome
                  ? t(`userReport.detail.${outcome}`)
                  : ''}
            </p>
            {isOpen ? (
              <form
                className="mt-2 grid gap-4"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault()
                  if (pending) return
                  if (!reply.trim()) {
                    setReplyRequired(true)
                    replyRef.current?.focus()
                    return
                  }
                  replyAndClose.mutate({
                    expectedRowVersion,
                    reporterReply: reply,
                    internalNote: note
                  })
                }}
              >
                <Textarea
                  ref={replyRef}
                  name="reporter-reply"
                  label={t('userReport.detail.reply')}
                  hint={t('userReport.detail.replyVisible')}
                  error={
                    replyRequired
                      ? t('userReport.detail.replyRequired')
                      : undefined
                  }
                  rows={4}
                  maxLength={2000}
                  disabled={pending}
                  value={reply}
                  onChange={(event) => {
                    setReply(event.currentTarget.value)
                    if (event.currentTarget.value.trim())
                      setReplyRequired(false)
                  }}
                />
                <Textarea
                  name="internal-note"
                  label={t('userReport.detail.note')}
                  hint={t('userReport.detail.noteHint')}
                  placeholder={t('userReport.detail.notePlaceholder')}
                  rows={4}
                  maxLength={1000}
                  disabled={pending}
                  value={note}
                  onChange={(event) => setNote(event.currentTarget.value)}
                />
                {noteDraft !== null ? (
                  <div
                    role="status"
                    className="rounded-lg border border-warning-line bg-warning-soft p-3 text-sm text-warning-strong"
                  >
                    <p className="font-semibold">
                      {t('userReport.detail.noteReplaced')}
                    </p>
                    <p className="mt-2 text-muted">
                      {t('userReport.detail.myDraft')}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      {noteDraft}
                    </p>
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setNote(noteDraft)
                        setNoteDraft(null)
                      }}
                    >
                      {t('userReport.detail.restoreDraft')}
                    </Button>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="submit"
                    disabled={pending}
                    isLoading={replyAndClose.isPending}
                  >
                    {t('userReport.detail.replyAndClose')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending}
                    isLoading={saveNote.isPending}
                    onClick={() =>
                      saveNote.mutate({
                        expectedRowVersion,
                        internalNote: note
                      })
                    }
                  >
                    {t('userReport.detail.saveNote')}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  disabled={pending}
                  isLoading={close.isPending}
                  onClick={() =>
                    close.mutate({ expectedRowVersion, internalNote: note })
                  }
                >
                  {t('userReport.detail.close')}
                </Button>
                <p className="text-sm text-muted">
                  {t('userReport.detail.noNotification')}
                </p>
              </form>
            ) : (
              <div className="mt-2 text-sm">
                <p>{t('userReport.detail.closedNotice')}</p>
                {report.closedAt ? (
                  <p className="mt-2 text-muted">
                    {t('userReport.detail.closedAt')}:{' '}
                    {formatAdminDateTime(report.closedAt)}
                  </p>
                ) : null}
              </div>
            )}
          </section>
          {report.questionId ? (
            <section className={cardClass} aria-labelledby="report-link">
              <h2 id="report-link" className="text-lg font-bold">
                {t('userReport.detail.link')}
              </h2>
              <Link
                to={`/questions/${report.questionId}/edit`}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-brand px-4 font-semibold text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                {t('userReport.detail.newVersion')}
              </Link>
            </section>
          ) : null}
        </div>
      </div>
    </>
  )
}
