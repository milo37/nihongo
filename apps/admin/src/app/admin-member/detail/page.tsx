import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Link, useParams } from 'react-router'
import type { AdminMemberDetail } from '@nihongo/contracts/admin/members'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useIdleLockRecheck } from '@app/admin/idle-lock/hooks/useIdleLockRecheck'
import { MemberIdText } from '@app/admin-member/components/MemberIdText'
import { MemberStatusBadge } from '@app/admin-member/components/MemberStatusBadge'
import { useAdminMemberDetail } from '@app/admin-member/hooks/useAdminMembers'
import {
  useReleaseAdminMemberRestriction,
  useRestrictAdminMember
} from '@app/admin-member/hooks/useAdminMemberCommands'

const REASON_MAX = 500

const errorCode = (error: unknown): string | null =>
  error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : null

type MemberActionsProps = {
  readonly member: AdminMemberDetail
  readonly focusHeading: boolean
  readonly onCompleted: () => void
  readonly onReload: () => void
}

const newTabLinkClassName =
  'inline-flex min-h-11 items-center rounded-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/**
 * A FRESH_ASSURANCE_REQUIRED answer keeps the page and its draft: the admin
 * signs in again in a new tab, confirms here, then presses the command again.
 */
type FreshAssuranceProps = {
  readonly commandLabel: string
  readonly onConfirmed: () => void
}

const FreshAssurance = ({
  commandLabel,
  onConfirmed
}: FreshAssuranceProps): ReactElement => {
  const { t } = useAdminPresentation()
  const { state, recheck } = useIdleLockRecheck(onConfirmed)
  return (
    <div role="alert" className="mt-4 space-y-3 text-sm leading-6">
      <p>{t('members.detail.fresh.required', { command: commandLabel })}</p>
      {state === 'failed' || state === 'expired' ? (
        <p className="text-danger-strong">{t('members.detail.fresh.failed')}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/login"
          target="_blank"
          rel="noopener noreferrer"
          className={newTabLinkClassName}
        >
          {t('idleLock.signInNewTab')}
        </a>
        <Button
          variant="secondary"
          isLoading={state === 'checking'}
          loadingLabel={t('idleLock.checking')}
          onClick={() => void recheck()}
        >
          {t('members.detail.fresh.confirm')}
        </Button>
      </div>
    </div>
  )
}

const MemberActions = ({
  member,
  focusHeading,
  onCompleted,
  onReload
}: MemberActionsProps): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const { addToast } = useToast()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>()
  const [confirming, setConfirming] = useState(false)
  const [freshConfirmed, setFreshConfirmed] = useState(false)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const restrict = useRestrictAdminMember(member.memberId, () => {
    addToast({ title: t('members.detail.restricted'), variant: 'success' })
    onCompleted()
  })
  const release = useReleaseAdminMemberRestriction(member.memberId, () => {
    addToast({ title: t('members.detail.released'), variant: 'success' })
    onCompleted()
  })
  const restricted = member.status === 'RESTRICTED'
  const command = restricted ? release : restrict
  const commandLabel = t(
    restricted ? 'members.detail.release' : 'members.detail.restrict'
  )
  const code = errorCode(command.error)

  useEffect(() => {
    if (focusHeading) headingRef.current?.focus()
  }, [focusHeading])

  const onRestrict = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmed = reason.trim()
    if (trimmed.length === 0 || [...trimmed].length > REASON_MAX) {
      setReasonError(t('members.detail.reasonRequired', { max: REASON_MAX }))
      reasonRef.current?.focus()
      return
    }
    setReasonError(undefined)
    setConfirming(true)
  }
  const run = (): void => {
    setFreshConfirmed(false)
    if (restricted) {
      release.mutate({ expectedRowVersion: member.rowVersion })
      return
    }
    setConfirming(false)
    restrict.mutate({
      expectedRowVersion: member.rowVersion,
      reason: reason.trim()
    })
  }

  const feedback = freshConfirmed ? (
    <p role="status" className="mt-4 text-sm leading-6">
      {t('members.detail.fresh.confirmed', { command: commandLabel })}
    </p>
  ) : code === 'FRESH_ASSURANCE_REQUIRED' ? (
    <FreshAssurance
      commandLabel={commandLabel}
      onConfirmed={() => {
        command.reset()
        setFreshConfirmed(true)
      }}
    />
  ) : command.isError ? (
    <div role="alert" className="mt-4 text-sm text-danger-strong">
      <p>{presentError(command.error)}</p>
      {code === 'VERSION_CONFLICT' || code === 'INVALID_STATE_TRANSITION' ? (
        <Button
          className="mt-2"
          variant="secondary"
          onClick={() => {
            command.reset()
            onReload()
          }}
        >
          {t('members.detail.reload')}
        </Button>
      ) : null}
    </div>
  ) : null

  const heading = (id: string, key: string): ReactElement => (
    <h2
      id={id}
      ref={headingRef}
      tabIndex={-1}
      className="rounded-sm text-xl font-bold"
    >
      {t(key)}
    </h2>
  )

  if (restricted) {
    return (
      <section aria-labelledby="member-release" className="mt-8">
        {heading('member-release', 'members.detail.releaseTitle')}
        <p className="mt-2 text-muted">{t('members.detail.releaseHint')}</p>
        <Button
          className="mt-4"
          variant="secondary"
          isLoading={release.isPending}
          loadingLabel={t('members.detail.releasing')}
          onClick={run}
        >
          {commandLabel}
        </Button>
        {feedback}
      </section>
    )
  }

  return (
    <section aria-labelledby="member-restrict" className="mt-8">
      {heading('member-restrict', 'members.detail.restrictTitle')}
      <p className="mt-2 text-muted">{t('members.detail.restrictHint')}</p>
      <form className="mt-4 max-w-xl" onSubmit={onRestrict} noValidate>
        <Textarea
          ref={reasonRef}
          name="reason"
          rows={4}
          label={t('members.detail.reason')}
          hint={t('members.detail.reasonHint', { max: REASON_MAX })}
          error={reasonError}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button
          type="submit"
          className="mt-4"
          variant="danger"
          isLoading={restrict.isPending}
          loadingLabel={t('members.detail.restricting')}
        >
          {commandLabel}
        </Button>
      </form>
      {feedback}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('members.detail.confirm.title')}
        description={t('members.detail.confirm.description')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('members.detail.confirm.cancel')}
            </Button>
            <Button variant="danger" onClick={run}>
              {t('members.detail.confirm.apply')}
            </Button>
          </>
        }
      >
        <dl className="space-y-3 text-sm leading-6">
          <div>
            <dt className="text-muted">{t('members.columns.email')}</dt>
            <dd className="font-semibold">{member.maskedEmail}</dd>
          </div>
          <div>
            <dt className="text-muted">{t('members.columns.memberId')}</dt>
            <dd className="font-mono">
              <MemberIdText memberId={member.memberId} />
            </dd>
          </div>
          <div>
            <dt className="text-muted">{t('members.detail.reason')}</dt>
            <dd className="whitespace-pre-wrap">{reason.trim()}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm leading-6">
          {t('members.detail.restrictHint')}{' '}
          {t('members.detail.confirm.preserved')}
        </p>
      </Dialog>
    </section>
  )
}

export const AdminMemberDetailPage = (): ReactElement => {
  const { memberId = '' } = useParams()
  const { t, formatAdminDateTime, presentError } = useAdminPresentation()
  const detail = useAdminMemberDetail(memberId)
  const member = detail.data
  const [focusActions, setFocusActions] = useState(false)

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label={t('common.breadcrumbLabel')}>
        <Link
          to="/members"
          className="inline-flex min-h-11 items-center gap-2 font-semibold underline"
        >
          <Icon name="arrow-left" />
          {t('members.detail.back')}
        </Link>
      </nav>
      <header className="mt-4 border-b border-line pb-8">
        <h1 className="text-balance text-3xl font-black sm:text-4xl">
          {t('members.detail.title')}
        </h1>
      </header>
      {detail.isPending ? (
        <LoadingState className="mt-6" label={t('members.loading')} />
      ) : !member ? (
        <ErrorState
          className="mt-6"
          title={t('members.detail.loadError')}
          description={presentError(detail.error)}
          onRetry={() => void detail.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : (
        <>
          <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {(
              [
                [
                  'memberId',
                  <span key="id" className="font-mono">
                    <MemberIdText memberId={member.memberId} />
                  </span>
                ],
                ['email', member.maskedEmail],
                ['joinedAt', formatAdminDateTime(member.joinedAt)],
                [
                  'lastStudiedAt',
                  member.lastStudiedAt === null
                    ? t('members.never')
                    : formatAdminDateTime(member.lastStudiedAt)
                ],
                ['solvedCount', String(member.solvedCount)],
                ['reportCount', String(member.reportCount)]
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-sm text-muted">
                  {t(`members.columns.${key}`)}
                </dt>
                <dd className="mt-1 font-semibold [overflow-wrap:anywhere]">
                  {value}
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-sm text-muted">
                {t('members.columns.status')}
              </dt>
              <dd className="mt-1">
                <MemberStatusBadge status={member.status} />
              </dd>
            </div>
            {member.restrictedAt !== null ? (
              <div>
                <dt className="text-sm text-muted">
                  {t('members.detail.restrictedAt')}
                </dt>
                <dd className="mt-1 font-semibold">
                  {formatAdminDateTime(member.restrictedAt)}
                </dd>
              </div>
            ) : null}
            {member.restrictionReason !== null ? (
              <div className="sm:col-span-2">
                <dt className="text-sm text-muted">
                  {t('members.detail.reason')}
                </dt>
                <dd className="mt-1 whitespace-pre-wrap">
                  {member.restrictionReason}
                </dd>
              </div>
            ) : null}
          </dl>
          <MemberActions
            key={`${member.status}-${member.rowVersion}`}
            member={member}
            focusHeading={focusActions}
            onCompleted={() => setFocusActions(true)}
            onReload={() => void detail.refetch()}
          />
        </>
      )}
    </section>
  )
}
