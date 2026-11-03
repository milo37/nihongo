import { useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Link, useParams } from 'react-router'
import type { AdminMemberDetail } from '@nihongo/contracts/admin/members'
import { AppLink } from '@nihongo/browser/common/components/AppLink'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { Button } from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
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
  readonly onReload: () => void
}

const MemberActions = ({
  member,
  onReload
}: MemberActionsProps): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const { addToast } = useToast()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>()
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const restrict = useRestrictAdminMember(member.memberId, () => {
    setReason('')
    addToast({ title: t('members.detail.restricted'), variant: 'success' })
  })
  const release = useReleaseAdminMemberRestriction(member.memberId, () =>
    addToast({ title: t('members.detail.released'), variant: 'success' })
  )
  const command = member.status === 'ACTIVE' ? restrict : release
  const code = errorCode(command.error)

  const onRestrict = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmed = reason.trim()
    if (trimmed.length === 0 || [...trimmed].length > REASON_MAX) {
      setReasonError(t('members.detail.reasonRequired', { max: REASON_MAX }))
      reasonRef.current?.focus()
      return
    }
    setReasonError(undefined)
    restrict.mutate({ expectedRowVersion: member.rowVersion, reason: trimmed })
  }

  const feedback = command.isError ? (
    <div role="alert" className="mt-4 text-sm text-danger-strong">
      <p>{presentError(command.error)}</p>
      {code === 'FRESH_ASSURANCE_REQUIRED' ? (
        <AppLink
          to={`/login?redirect=${encodeURIComponent(`/admin/members/${member.memberId}`)}`}
          className="mt-2 inline-flex min-h-11 items-center font-semibold underline"
        >
          {t('members.detail.reauthenticate')}
        </AppLink>
      ) : null}
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

  if (member.status === 'RESTRICTED') {
    return (
      <section aria-labelledby="member-release" className="mt-8">
        <h2 id="member-release" className="text-xl font-bold">
          {t('members.detail.releaseTitle')}
        </h2>
        <p className="mt-2 text-muted">{t('members.detail.releaseHint')}</p>
        <Button
          className="mt-4"
          variant="secondary"
          isLoading={release.isPending}
          loadingLabel={t('members.detail.releasing')}
          onClick={() =>
            release.mutate({ expectedRowVersion: member.rowVersion })
          }
        >
          {t('members.detail.release')}
        </Button>
        {feedback}
      </section>
    )
  }

  return (
    <section aria-labelledby="member-restrict" className="mt-8">
      <h2 id="member-restrict" className="text-xl font-bold">
        {t('members.detail.restrictTitle')}
      </h2>
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
          {t('members.detail.restrict')}
        </Button>
      </form>
      {feedback}
    </section>
  )
}

export const AdminMemberDetailPage = (): ReactElement => {
  const { memberId = '' } = useParams()
  const { t, formatAdminDateTime, presentError } = useAdminPresentation()
  const detail = useAdminMemberDetail(memberId)
  const member = detail.data

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
                ['memberId', member.memberId],
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
                <dd className="mt-1 break-all font-semibold">{value}</dd>
              </div>
            ))}
            <div>
              <dt className="text-sm text-muted">
                {t('members.columns.status')}
              </dt>
              <dd className="mt-1">
                <Badge
                  variant={member.status === 'ACTIVE' ? 'success' : 'danger'}
                >
                  {t(`members.status.${member.status}`)}
                </Badge>
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
            onReload={() => void detail.refetch()}
          />
        </>
      )}
    </section>
  )
}
