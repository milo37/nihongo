import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { AdminNavigation } from '@app/admin/components/AdminNavigation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useAdminAuditLog } from '@app/admin-audit/hooks/useAdminAuditLog'

export const AdminAuditLogPage = (): ReactElement => {
  const { t, formatAdminDateTime, presentError } = useAdminPresentation()
  const audit = useAdminAuditLog()
  const items = audit.data?.pages.flatMap((page) => page.items) ?? []
  const paused = audit.fetchStatus === 'paused'
  const headingRef = useRef<HTMLHeadingElement>(null)
  const retryFocus = useRef(false)
  const newItemRef = useRef<HTMLLIElement>(null)
  const [newItemsStart, setNewItemsStart] = useState<number | null>(null)

  useEffect(() => {
    if (newItemsStart !== null && items.length > newItemsStart)
      newItemRef.current?.focus()
  }, [items.length, newItemsStart])
  useEffect(() => {
    if (audit.isSuccess && retryFocus.current) {
      retryFocus.current = false
      headingRef.current?.focus()
    }
  }, [audit.isSuccess])
  const retry = (): void => {
    retryFocus.current = true
    void audit.refetch()
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <AdminNavigation />
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
      {!audit.data ? (
        audit.isPending && !paused ? (
          <LoadingState className="mt-8" message={t('audit.loading')} />
        ) : (
          <ErrorState
            autoFocus
            className="mt-8"
            title={t(paused ? 'common.pausedTitle' : 'audit.error')}
            description={
              paused ? t('common.pausedDescription') : presentError(audit.error)
            }
            onRetry={retry}
            retryLabel={t('audit.retry')}
          />
        )
      ) : items.length === 0 ? (
        <EmptyState
          autoFocus
          className="mt-8"
          icon={<Icon name="rotate-ccw" />}
          title={t('audit.emptyTitle')}
          description={t('audit.emptyDescription')}
        />
      ) : (
        <ol className="mt-8 grid gap-3" aria-label={t('audit.title')}>
          {items.map((item, index) => (
            <li
              key={item.id}
              ref={index === newItemsStart ? newItemRef : undefined}
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
                {t(`enums.auditTargetTypes.${item.targetType}`)}:{' '}
                {item.targetId}
              </p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-muted">
                    {t('common.actor')}
                  </dt>
                  <dd className="mt-1 break-all">
                    {t(`enums.actorLabels.${item.actor.label}`)}
                    {item.actor.kind === 'ACCOUNT'
                      ? ` · ${item.actor.actorId}`
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted">
                    {t('audit.stateChange')}
                  </dt>
                  <dd className="mt-1">
                    {item.beforeState
                      ? t(`enums.auditStates.${item.beforeState}`)
                      : t('common.none')}{' '}
                    →{' '}
                    {item.afterState
                      ? t(`enums.auditStates.${item.afterState}`)
                      : t('common.none')}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted">
                    {t('common.rowVersion')}
                  </dt>
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
                          .map((field) =>
                            t(`enums.auditChangedFields.${field}`)
                          )
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
          ))}
        </ol>
      )}
      {audit.hasNextPage ? (
        <Button
          className="mt-6"
          variant="outline"
          disabled={audit.isFetchingNextPage || paused || audit.isError}
          aria-busy={audit.isFetchingNextPage}
          onClick={() => {
            setNewItemsStart(items.length)
            void audit.fetchNextPage()
          }}
        >
          {t(audit.isFetchingNextPage ? 'audit.moreLoading' : 'audit.more')}
        </Button>
      ) : null}
    </section>
  )
}
