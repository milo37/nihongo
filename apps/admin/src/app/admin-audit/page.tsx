import { useEffect, useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useAdminAuditLog } from '@app/admin-audit/hooks/useAdminAuditLog'
import { PageContainer } from '@nihongo/browser/common/components/PageContainer'

type AuditState = ReturnType<typeof useAdminAuditLog>
type AuditItem = NonNullable<
  AuditState['data']
>['pages'][number]['items'][number]

/** One audited command: what, when, who, state and row version changes. */
const AuditEntry = ({ item }: { item: AuditItem }): ReactElement => {
  const { t, formatAdminDateTime } = useAdminPresentation()
  const state = (value: AuditItem['beforeState']): string =>
    value ? t(`enums.auditStates.${value}`) : t('common.none')
  return (
    <li
      tabIndex={-1}
      className="min-w-0 rounded-xl border border-line bg-surface p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{t(`enums.auditCommands.${item.command}`)}</strong>
        <time className="text-sm text-muted" dateTime={item.occurredAt}>
          {formatAdminDateTime(item.occurredAt)}
        </time>
      </div>
      <p className="mt-2 break-all text-sm">
        {t(`enums.auditTargetTypes.${item.targetType}`)}: {item.targetId}
      </p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-muted">{t('common.actor')}</dt>
          <dd className="mt-1 break-all">
            {t(`enums.actorLabels.${item.actor.label}`)}
            {item.actor.kind === 'ACCOUNT' ? ` · ${item.actor.actorId}` : ''}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-muted">{t('audit.stateChange')}</dt>
          <dd className="mt-1">
            {state(item.beforeState)} → {state(item.afterState)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-muted">{t('common.rowVersion')}</dt>
          <dd className="mt-1">
            {item.beforeRowVersion ?? t('common.none')} →{' '}
            {item.afterRowVersion ?? t('common.none')}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-muted">
            {t('audit.changedFields')}
          </dt>
          <dd className="mt-1 break-words">
            {item.changedFields.length
              ? item.changedFields
                  .map((field) => t(`enums.auditChangedFields.${field}`))
                  .join(', ')
              : t('common.none')}
          </dd>
        </div>
      </dl>
      <p className="mt-2 break-all text-xs text-muted">
        {t('audit.requestEnvironment', {
          environment: t(`enums.auditEnvironments.${item.environment}`),
          requestId: item.requestId
        })}
      </p>
    </li>
  )
}

/** First-load loading or error, empty log, or the entry list. */
const AuditEntries = ({
  audit,
  items,
  listRef,
  onRetry
}: {
  audit: AuditState
  items: AuditItem[]
  listRef: RefObject<HTMLOListElement | null>
  onRetry: () => void
}): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const paused = audit.fetchStatus === 'paused'
  if (!audit.data) {
    if (audit.isPending && !paused)
      return <LoadingState className="mt-8" message={t('audit.loading')} />
    return (
      <ErrorState
        autoFocus
        className="mt-8"
        title={t(paused ? 'common.pausedTitle' : 'audit.error')}
        description={
          paused ? t('common.pausedDescription') : presentError(audit.error)
        }
        onRetry={onRetry}
        retryLabel={t('audit.retry')}
      />
    )
  }
  if (items.length === 0)
    return (
      <EmptyState
        autoFocus
        className="mt-8"
        icon={<Icon name="rotate-ccw" />}
        title={t('audit.emptyTitle')}
        description={t('audit.emptyDescription')}
      />
    )
  return (
    <ol ref={listRef} className="mt-8 grid gap-3" aria-label={t('audit.title')}>
      {items.map((item) => (
        <AuditEntry key={item.id} item={item} />
      ))}
    </ol>
  )
}

export const AdminAuditLogPage = (): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const audit = useAdminAuditLog()
  const items = audit.data?.pages.flatMap((page) => page.items) ?? []
  const paused = audit.fetchStatus === 'paused'
  const headingRef = useRef<HTMLHeadingElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const appendFocusIndex = useRef<number | null>(null)
  const [retryCompletion, setRetryCompletion] = useState(0)

  useEffect(() => {
    const index = appendFocusIndex.current
    if (index !== null && items.length > index) {
      appendFocusIndex.current = null
      const item = listRef.current?.children.item(index)
      if (item instanceof HTMLElement) item.focus()
    }
  }, [items.length])
  useEffect(() => {
    if (retryCompletion > 0) headingRef.current?.focus()
  }, [retryCompletion])
  const retry = (): void => {
    void audit.refetch().then((result) => {
      if (result.isSuccess && result.fetchStatus === 'idle')
        setRetryCompletion((completion) => completion + 1)
    })
  }

  const loadMore = (): void => {
    const index = items.length
    appendFocusIndex.current = index
    void audit.fetchNextPage().then((result) => {
      if (
        result.isError ||
        (result.data?.pages.flatMap((page) => page.items).length ?? 0) <= index
      ) {
        appendFocusIndex.current = null
      }
    })
  }

  return (
    <PageContainer width="6xl">
      <header className="border-b border-line pb-8">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm text-balance text-3xl font-black sm:text-4xl"
        >
          {t('audit.title')}
        </h1>
        <p className="mt-4 max-w-prose text-muted">{t('audit.description')}</p>
      </header>
      {(audit.isError || paused) && audit.data ? (
        <ErrorState
          className="mt-6"
          density="inline"
          title={t(
            paused ? 'common.cachedPausedDescription' : 'audit.cachedError'
          )}
          description={
            paused ? t('common.pausedDescription') : presentError(audit.error)
          }
          onRetry={retry}
          retryLabel={t('audit.retry')}
        />
      ) : null}
      <AuditEntries
        audit={audit}
        items={items}
        listRef={listRef}
        onRetry={retry}
      />
      {audit.hasNextPage ? (
        <Button
          className="mt-6"
          variant="outline"
          disabled={audit.isFetchingNextPage || paused || audit.isError}
          aria-busy={audit.isFetchingNextPage}
          onClick={loadMore}
        >
          {t(audit.isFetchingNextPage ? 'audit.moreLoading' : 'audit.more')}
        </Button>
      ) : null}
    </PageContainer>
  )
}
