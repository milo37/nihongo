import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { AdminMemberDetail } from '@nihongo/contracts/admin/members'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useAppStore } from '@nihongo/browser/store/index'
import {
  ReauthDialogButton,
  ReauthRequiredNotice
} from '@app/admin/reauth/ReauthRequiredNotice'
import {
  clearReauthKeep,
  readReauthKeep,
  saveReauthKeep
} from '@app/admin/reauth/reauthKeep'
import { useAdminReauth } from '@app/admin/reauth/useAdminReauth'
import { MemberIdText } from '@app/admin-member/components/MemberIdText'
import {
  useReleaseAdminMemberRestriction,
  useRestrictAdminMember
} from '@app/admin-member/hooks/useAdminMemberCommands'

const REASON_MAX = 500

const errorCode = (error: unknown): string | null =>
  error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : null

/** A restriction reason kept for this member before re-verification. */
const restoredReason = (
  actorId: string | undefined,
  memberId: string
): string | null => {
  if (!actorId) return null
  const kept = readReauthKeep(actorId, 'member-detail')
  return typeof kept === 'object' &&
    kept !== null &&
    'memberId' in kept &&
    kept.memberId === memberId &&
    'reason' in kept &&
    typeof kept.reason === 'string'
    ? kept.reason
    : null
}

type MemberActionsProps = {
  readonly member: AdminMemberDetail
  readonly focusHeading: boolean
  readonly onCompleted: () => void
  readonly onReload: () => void
}

export const MemberActions = ({
  member,
  focusHeading,
  onCompleted,
  onReload
}: MemberActionsProps): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const { addToast } = useToast()
  const actorId = useAppStore((state) => state.currentUser?.id)
  const reauth = useAdminReauth()
  const [restored] = useState(() => restoredReason(actorId, member.memberId))
  useEffect(() => {
    if (actorId) clearReauthKeep(actorId, 'member-detail')
  }, [actorId])
  const [reason, setReason] = useState(restored ?? '')
  const [reasonError, setReasonError] = useState<string | undefined>()
  const [confirming, setConfirming] = useState(false)
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
  const keepReason = (): boolean =>
    Boolean(actorId) &&
    saveReauthKeep(actorId as string, 'member-detail', {
      memberId: member.memberId,
      reason
    })
  const run = (): void => {
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

  const feedback =
    code === 'FRESH_ASSURANCE_REQUIRED' ? (
      <div className="max-w-xl">
        <ReauthRequiredNotice
          command={commandLabel}
          keeps="input"
          reauth={reauth}
        />
        <div className="mt-3">
          <ReauthDialogButton
            reauth={reauth}
            keep={restricted ? undefined : keepReason}
          />
        </div>
      </div>
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
      {restored !== null ? (
        <p role="status" className="mt-2 text-sm font-semibold">
          {t('reauth.restored')}
        </p>
      ) : null}
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
