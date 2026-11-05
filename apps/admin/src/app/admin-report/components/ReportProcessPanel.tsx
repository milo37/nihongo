import { useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Link } from 'react-router'
import type { AdminReportDetail } from '@nihongo/contracts/admin/reports'
import { Button } from '@nihongo/browser/common/components/Button'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import {
  useCloseAdminReport,
  useReplyAndCloseAdminReport,
  useSaveAdminReportNote
} from '@app/admin-report/hooks/useAdminReportCommands'

const errorCode = (error: unknown): string | null =>
  error &&
  typeof error === 'object' &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : null

export const cardClass = 'rounded-xl border border-line bg-surface p-5 sm:p-6'

type Outcome = 'repliedClosed' | 'noteSaved' | 'closed'

/** Shown after a conflict replaced the memo: the admin's draft and restore. */
const NoteDraftNotice = ({
  draft,
  disabled,
  onRestore
}: {
  draft: string
  disabled: boolean
  onRestore: (form: HTMLFormElement | null) => void
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <div
      role="status"
      className="rounded-lg border border-warning-line bg-warning-soft p-3 text-sm text-warning-strong"
    >
      <p className="font-semibold">{t('userReport.detail.noteReplaced')}</p>
      <p className="mt-2 text-muted">{t('userReport.detail.myDraft')}</p>
      <p className="whitespace-pre-wrap break-words">{draft}</p>
      <Button
        className="mt-2"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={(event) => onRestore(event.currentTarget.form)}
      >
        {t('userReport.detail.restoreDraft')}
      </Button>
    </div>
  )
}

const ClosedReportNotice = ({
  closedAt
}: {
  closedAt: string | null
}): ReactElement => {
  const { t, formatAdminDateTime } = useAdminPresentation()
  return (
    <div className="mt-2 text-sm">
      <p>{t('userReport.detail.closedNotice')}</p>
      {closedAt ? (
        <p className="mt-2 text-muted">
          {t('userReport.detail.closedAt')}: {formatAdminDateTime(closedAt)}
        </p>
      ) : null}
    </div>
  )
}

/** Link to start a new version of the reported question. */
const ReportQuestionLink = ({
  questionId
}: {
  questionId: string
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <section className={cardClass} aria-labelledby="report-link">
      <h2 id="report-link" className="text-lg font-bold">
        {t('userReport.detail.link')}
      </h2>
      <Link
        to={`/questions/${questionId}/edit`}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-brand px-4 font-semibold text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        {t('userReport.detail.newVersion')}
      </Link>
    </section>
  )
}

/** Reply-and-close submit, save note and close without notifying. */
const ReportCommandButtons = ({
  pending,
  replying,
  savingNote,
  closing,
  onSaveNote,
  onClose
}: {
  pending: boolean
  replying: boolean
  savingNote: boolean
  closing: boolean
  onSaveNote: () => void
  onClose: () => void
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending} isLoading={replying}>
          {t('userReport.detail.replyAndClose')}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          isLoading={savingNote}
          onClick={onSaveNote}
        >
          {t('userReport.detail.saveNote')}
        </Button>
      </div>
      <Button
        variant="ghost"
        disabled={pending}
        isLoading={closing}
        onClick={onClose}
      >
        {t('userReport.detail.close')}
      </Button>
      <p className="text-sm text-muted">
        {t('userReport.detail.noNotification')}
      </p>
    </>
  )
}

/** Reply-and-close, internal note and close commands with outcome status. */
export const ReportProcessPanel = ({
  report,
  onConflict
}: {
  report: AdminReportDetail
  onConflict: () => void
}): ReactElement => {
  const { t, presentError } = useAdminPresentation()
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
  const announce = (next: Outcome): void => {
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
    onSuccess: () => announce('repliedClosed'),
    onError: fail
  })
  const saveNote = useSaveAdminReportNote(report.reportId, {
    onSuccess: () => announce('noteSaved'),
    onError: fail
  })
  const close = useCloseAdminReport(report.reportId, {
    onSuccess: () => announce('closed'),
    onError: fail
  })
  const pending =
    replyAndClose.isPending || saveNote.isPending || close.isPending
  const isOpen = report.status === 'RECEIVED'
  const expectedRowVersion = report.rowVersion
  const statusMessage = failure
    ? errorCode(failure) === 'VERSION_CONFLICT'
      ? t('userReport.detail.conflict')
      : presentError(failure)
    : outcome
      ? t(`userReport.detail.${outcome}`)
      : ''
  const submitReply = (event: FormEvent<HTMLFormElement>): void => {
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
  }
  const restoreDraft = (form: HTMLFormElement | null): void => {
    if (noteDraft === null) return
    setNote(noteDraft)
    setNoteDraft(null)
    // The button unmounts; keep focus on the restored memo.
    const memo = form?.elements.namedItem('internal-note')
    if (memo instanceof HTMLTextAreaElement) memo.focus()
  }

  return (
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
          {statusMessage}
        </p>
        {isOpen ? (
          <form className="mt-2 grid gap-4" noValidate onSubmit={submitReply}>
            <Textarea
              ref={replyRef}
              name="reporter-reply"
              label={t('userReport.detail.reply')}
              hint={t('userReport.detail.replyVisible')}
              error={
                replyRequired ? t('userReport.detail.replyRequired') : undefined
              }
              rows={4}
              maxLength={1000}
              disabled={pending}
              value={reply}
              onChange={(event) => {
                setReply(event.currentTarget.value)
                if (event.currentTarget.value.trim()) setReplyRequired(false)
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
              <NoteDraftNotice
                draft={noteDraft}
                disabled={pending}
                onRestore={restoreDraft}
              />
            ) : null}
            <ReportCommandButtons
              pending={pending}
              replying={replyAndClose.isPending}
              savingNote={saveNote.isPending}
              closing={close.isPending}
              onSaveNote={() =>
                saveNote.mutate({ expectedRowVersion, internalNote: note })
              }
              onClose={() =>
                close.mutate({ expectedRowVersion, internalNote: note })
              }
            />
          </form>
        ) : (
          <ClosedReportNotice closedAt={report.closedAt} />
        )}
      </section>
      {report.questionId ? (
        <ReportQuestionLink questionId={report.questionId} />
      ) : null}
    </div>
  )
}
