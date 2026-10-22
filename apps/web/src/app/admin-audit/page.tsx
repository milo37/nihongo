import { Link } from 'react-router'
import type { ReactElement } from 'react'
import {
  adminActorLabelKey,
  adminAuditChangedFieldKey,
  adminAuditCommandKey,
  adminAuditEnvironmentKey,
  adminAuditStateKey,
  adminAuditTargetTypeKey
} from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { usePhase7AdminAuditLogConnection } from '@app/admin-question/hooks/usePhase7AdminQueries'
import { Button } from '@common/components/Button'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'

export const AdminAuditLogPage = (): ReactElement => {
  const { formatAdminDateTime, presentError, t } = useAdminPresentation()
  const audit = usePhase7AdminAuditLogConnection({ limit: 50 })
  const items = audit.data?.pages.flatMap((page) => page.items) ?? []
  const isPaused = audit.fetchStatus === 'paused'

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label={t('common.breadcrumbLabel')}>
        <Link
          className="font-semibold text-brand underline"
          to="/admin/questions"
        >
          {t('common.questions')}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span aria-current="page">{t('common.auditLog')}</span>
      </nav>
      <header className="mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          {t('audit.eyebrow')}
        </p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">
          {t('audit.title')}
        </h1>
        <p className="mt-4 text-muted">{t('audit.description')}</p>
      </header>
      {(audit.isError || isPaused) && audit.data ? (
        <div
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="alert"
        >
          <p className="font-semibold">
            {isPaused
              ? t('common.cachedPausedDescription')
              : t('audit.cachedError')}
          </p>
          <p className="mt-1 text-sm">
            {isPaused
              ? t('common.pausedDescription')
              : presentError(audit.error)}
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void audit.refetch()}
          >
            {t('audit.retry')}
          </Button>
        </div>
      ) : null}
      {audit.isPending && !audit.data && isPaused ? (
        <ErrorState
          autoFocus
          className="mt-8"
          description={t('common.pausedDescription')}
          onRetry={() => void audit.refetch()}
          title={t('common.pausedTitle')}
        />
      ) : audit.isPending && !audit.data ? (
        <LoadingState className="mt-8" message={t('audit.loading')} />
      ) : !audit.data ? (
        <ErrorState
          className="mt-8"
          description={presentError(audit.error)}
          onRetry={() => void audit.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          className="mt-8"
          description={t('audit.emptyDescription')}
          title={t('audit.emptyTitle')}
        />
      ) : (
        <ol className="mt-8 grid gap-3">
          {items.map((item) => (
            <li
              className="content-auto rounded-xl border border-line bg-white p-5"
              key={item.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{t(adminAuditCommandKey[item.command])}</strong>
                <time className="text-sm text-muted" dateTime={item.occurredAt}>
                  {formatAdminDateTime(item.occurredAt)}
                </time>
              </div>
              <p className="mt-2 break-all text-sm">
                {t(adminAuditTargetTypeKey[item.targetType])}: {item.targetId}
              </p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-muted">
                    {t('common.actor')}
                  </dt>
                  <dd className="mt-1 break-all">
                    {t(adminActorLabelKey[item.actor.label])}
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
                      ? t(adminAuditStateKey[item.beforeState])
                      : t('common.none')}{' '}
                    →{' '}
                    {item.afterState
                      ? t(adminAuditStateKey[item.afterState])
                      : t('common.none')}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted">rowVersion</dt>
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
                    {item.changedFields.length > 0
                      ? item.changedFields
                          .map((field) => t(adminAuditChangedFieldKey[field]))
                          .join(', ')
                      : t('common.none')}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 break-all text-xs text-muted">
                {t('audit.requestEnvironment', {
                  environment: t(adminAuditEnvironmentKey[item.environment]),
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
          disabled={audit.isFetchingNextPage || isPaused || audit.isError}
          variant="outline"
          onClick={() => void audit.fetchNextPage()}
        >
          {t(audit.isFetchingNextPage ? 'audit.moreLoading' : 'audit.more')}
        </Button>
      ) : null}
    </section>
  )
}
