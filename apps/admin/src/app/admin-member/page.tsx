import { useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { createColumnHelper } from '@tanstack/react-table'
import type {
  ColumnVisibilityState,
  PaginationState,
  SortingState
} from '@tanstack/react-table'
import {
  adminMemberEmailQuerySchema,
  adminMemberSortSchema,
  type AdminMemberSort,
  type AdminMemberSummary,
  type ParsedListAdminMembersQuery
} from '@nihongo/contracts/admin/members'
import { Button } from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import {
  ADMIN_GRID_PAGE_SIZES,
  AdminDataGrid,
  type AdminGridFeatures
} from '@app/admin/components/data-grid/AdminDataGrid'
import { AdminListSkeleton } from '@app/admin/components/list/AdminListSkeleton'
import { AdminListFilters } from '@app/admin/components/list/AdminListFilters'
import { AdminListSearch } from '@app/admin/components/list/AdminListSearch'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useAdminMembersList } from '@app/admin-member/hooks/useAdminMembers'
import { MemberStatusBadge } from '@app/admin-member/components/MemberStatusBadge'
import { PageContainer } from '@nihongo/browser/common/components/PageContainer'

type PageSize = (typeof ADMIN_GRID_PAGE_SIZES)[number]

// U8 widths; the email column takes what is left (13.5rem or more within
// the table minimum width) and truncates, with the full value in its title.
const COLUMN_CLASS_NAMES: Readonly<Record<string, string>> = {
  memberId: 'w-[7.5rem]',
  maskedEmail: 'truncate',
  joinedAt: 'w-[7.5rem]',
  lastStudiedAt: 'w-[7.5rem]',
  solvedCount: 'w-28 text-right tabular-nums',
  reportCount: 'w-16 text-right tabular-nums',
  status: 'w-[6.5rem]',
  actions: 'w-[4.5rem]'
}

const readQuery = (params: URLSearchParams): ParsedListAdminMembersQuery => {
  const sort = adminMemberSortSchema.safeParse(params.get('sort'))
  const page = Number(params.get('page'))
  const pageSize = Number(params.get('pageSize'))
  const email = adminMemberEmailQuerySchema.safeParse(params.get('email'))
  return {
    sort: sort.success ? sort.data : 'joinedAt',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
    pageSize: ADMIN_GRID_PAGE_SIZES.includes(pageSize as PageSize)
      ? (pageSize as PageSize)
      : 25,
    ...(email.success ? { email: email.data } : {})
  }
}

export const AdminMembersPage = (): ReactElement => {
  const { t, formatAdminDate, formatAdminDateTime, presentError } =
    useAdminPresentation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const query = readQuery(searchParams)
  const members = useAdminMembersList(query)
  const [emailDraft, setEmailDraft] = useState(query.email ?? '')
  const [emailError, setEmailError] = useState<string | undefined>()
  const emailRef = useRef<HTMLInputElement>(null)
  const [columnVisibility, setColumnVisibility] =
    useState<ColumnVisibilityState>({})
  const memberHref = (memberId: string): string =>
    `/members/${encodeURIComponent(memberId)}`
  const date = (value: string): ReactElement => (
    <span title={formatAdminDateTime(value)}>{formatAdminDate(value)}</span>
  )
  const lastStudied = (value: string | null): ReactElement =>
    value === null ? (
      <span className="text-muted">{t('members.never')}</span>
    ) : (
      date(value)
    )

  const helper = createColumnHelper<AdminGridFeatures, AdminMemberSummary>()
  const columns = helper.columns([
    helper.accessor('memberId', {
      header: t('members.columns.memberId'),
      enableSorting: false,
      enableHiding: false,
      cell: (info) => (
        <Link
          to={memberHref(info.getValue())}
          title={info.getValue()}
          aria-label={info.getValue()}
          className="inline-flex min-h-11 items-center whitespace-nowrap font-mono text-sm font-semibold underline"
        >
          {`${info.getValue().slice(0, 8)}…`}
        </Link>
      )
    }),
    helper.accessor('maskedEmail', {
      header: t('members.columns.email'),
      enableSorting: false,
      cell: (info) => <span title={info.getValue()}>{info.getValue()}</span>
    }),
    helper.accessor('joinedAt', {
      header: t('members.columns.joinedAt'),
      cell: (info) => date(info.getValue())
    }),
    helper.accessor('lastStudiedAt', {
      header: t('members.columns.lastStudiedAt'),
      cell: (info) => lastStudied(info.getValue())
    }),
    helper.accessor('solvedCount', {
      header: t('members.columns.solvedCount')
    }),
    helper.accessor('reportCount', {
      header: t('members.columns.reportCount')
    }),
    helper.accessor('status', {
      header: t('members.columns.status'),
      cell: (info) => <MemberStatusBadge status={info.getValue()} />
    }),
    helper.display({
      id: 'actions',
      header: t('members.columns.actions'),
      cell: (info) => (
        <Link
          to={memberHref(info.row.original.memberId)}
          className="inline-flex min-h-11 items-center font-semibold underline"
        >
          {t('members.openDetail')}
        </Link>
      )
    })
  ])

  const sorting: SortingState = [
    { id: query.sort, desc: query.order !== 'asc' }
  ]
  const pagination: PaginationState = {
    pageIndex: query.page - 1,
    pageSize: query.pageSize
  }

  const update = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setSearchParams(next)
  }
  const onSortingChange = (next: SortingState): void => {
    const first = next[0]
    const sort = adminMemberSortSchema.safeParse(first?.id)
    if (!first || !sort.success) {
      update({ sort: null, order: null, page: null })
      return
    }
    const nextSort: AdminMemberSort = sort.data
    update({
      sort: nextSort === 'joinedAt' ? null : nextSort,
      order: first.desc ? null : 'asc',
      page: null
    })
  }
  const onPaginationChange = (next: PaginationState): void => {
    update({
      page: next.pageIndex === 0 ? null : String(next.pageIndex + 1),
      pageSize: next.pageSize === 25 ? null : String(next.pageSize)
    })
  }
  const onSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmed = emailDraft.trim()
    if (trimmed.length === 0) {
      setEmailError(undefined)
      update({ email: null, page: null })
      return
    }
    const email = adminMemberEmailQuerySchema.safeParse(trimmed)
    if (!email.success) {
      setEmailError(t('members.search.invalid'))
      emailRef.current?.focus()
      return
    }
    setEmailError(undefined)
    update({ email: email.data, page: null })
  }

  return (
    <PageContainer width="6xl">
      <header className="border-b border-line pb-8">
        <h1 className="text-balance text-3xl font-black sm:text-4xl">
          {t('members.title')}
        </h1>
        <p className="mt-4 max-w-prose text-muted">
          {t('members.description')}
        </p>
      </header>
      <AdminListFilters
        search={
          <AdminListSearch
            ref={emailRef}
            type="email"
            name="email"
            autoComplete="off"
            label={t('members.search.label')}
            placeholder={t('members.search.label')}
            hint={t('members.search.hint')}
            error={emailError}
            value={emailDraft}
            onChange={(event) => setEmailDraft(event.target.value)}
            submitLabel={t('members.search.submit')}
            onSearch={onSearch}
            actions={
              query.email ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEmailDraft('')
                    setEmailError(undefined)
                    update({ email: null, page: null })
                  }}
                >
                  {t('members.search.clear')}
                </Button>
              ) : null
            }
          />
        }
      />
      <div className="mt-6">
        {members.isPending ? (
          <AdminListSkeleton message={t('members.loading')} />
        ) : members.isError && !members.data ? (
          <ErrorState
            title={t('members.loadError')}
            description={presentError(members.error)}
            onRetry={() => void members.refetch()}
            retryLabel={t('common.retry')}
          />
        ) : (
          <AdminDataGrid
            label={t('members.gridLabel')}
            columns={columns}
            columnClassNames={COLUMN_CLASS_NAMES}
            minTableWidth="min-w-[58rem]"
            data={members.data?.items ?? []}
            rowCount={members.data?.total ?? 0}
            getRowId={(member) => member.memberId}
            sorting={sorting}
            onSortingChange={onSortingChange}
            pagination={pagination}
            onPaginationChange={onPaginationChange}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            emptyMessage={t(query.email ? 'members.noMatch' : 'members.empty')}
            onRowActivate={(member) =>
              void navigate(memberHref(member.memberId))
            }
            renderCard={(member) => (
              <div className="grid gap-1">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to={memberHref(member.memberId)}
                    title={member.memberId}
                    aria-label={member.memberId}
                    className="font-mono text-sm font-semibold underline"
                  >
                    {`${member.memberId.slice(0, 8)}…`}
                  </Link>
                  <MemberStatusBadge status={member.status} />
                </div>
                <p className="break-all">{member.maskedEmail}</p>
                <div className="flex items-end justify-between gap-2">
                  <p className="text-sm text-muted">
                    {t('members.columns.joinedAt')} {date(member.joinedAt)} ·{' '}
                    {t('members.columns.lastStudiedAt')}{' '}
                    {lastStudied(member.lastStudiedAt)} ·{' '}
                    {t('members.columns.solvedCount')} {member.solvedCount} ·{' '}
                    {t('members.columns.reportCount')} {member.reportCount}
                  </p>
                  <Link
                    to={memberHref(member.memberId)}
                    className="inline-flex min-h-11 shrink-0 items-center font-semibold text-brand underline"
                  >
                    {t('members.openDetail')} ›
                  </Link>
                </div>
              </div>
            )}
          />
        )}
      </div>
    </PageContainer>
  )
}
