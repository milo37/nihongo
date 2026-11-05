import { useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { AdminMemberDetail } from '@nihongo/contracts/admin/members'
import { Link, useParams } from 'react-router'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { MemberActions } from '@app/admin-member/components/MemberActions'
import { MemberIdText } from '@app/admin-member/components/MemberIdText'
import { MemberStatusBadge } from '@app/admin-member/components/MemberStatusBadge'
import { useAdminMemberDetail } from '@app/admin-member/hooks/useAdminMembers'
import { PageContainer } from '@nihongo/browser/common/components/PageContainer'

/** Member identity, activity counts, status and any restriction. */
const MemberFacts = ({
  member
}: {
  member: AdminMemberDetail
}): ReactElement => {
  const { t, formatAdminDateTime } = useAdminPresentation()
  const facts: ReadonlyArray<
    readonly [
      (
        | 'memberId'
        | 'email'
        | 'joinedAt'
        | 'lastStudiedAt'
        | 'solvedCount'
        | 'reportCount'
      ),
      ReactNode
    ]
  > = [
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
  ]
  return (
    <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {facts.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-sm text-muted">{t(`members.columns.${key}`)}</dt>
          <dd className="mt-1 font-semibold [overflow-wrap:anywhere]">
            {value}
          </dd>
        </div>
      ))}
      <div>
        <dt className="text-sm text-muted">{t('members.columns.status')}</dt>
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
          <dt className="text-sm text-muted">{t('members.detail.reason')}</dt>
          <dd className="mt-1 whitespace-pre-wrap">
            {member.restrictionReason}
          </dd>
        </div>
      ) : null}
    </dl>
  )
}

export const AdminMemberDetailPage = (): ReactElement => {
  const { memberId = '' } = useParams()
  const { t, presentError } = useAdminPresentation()
  const detail = useAdminMemberDetail(memberId)
  const member = detail.data
  const [focusActions, setFocusActions] = useState(false)

  return (
    <PageContainer width="6xl">
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
          <MemberFacts member={member} />
          <MemberActions
            key={`${member.status}-${member.rowVersion}`}
            member={member}
            focusHeading={focusActions}
            onCompleted={() => setFocusActions(true)}
            onReload={() => void detail.refetch()}
          />
        </>
      )}
    </PageContainer>
  )
}
