import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { isPhase7UiApiError } from '@app/admin-question/hooks/usePhase7AdminMutations'
import { usePhase7AdminAuditLogConnection } from '@app/admin-question/hooks/usePhase7AdminQueries'
import { Button } from '@common/components/Button'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'

export const AdminAuditLogPage = (): ReactElement => {
  const audit = usePhase7AdminAuditLogConnection({ limit: 50 })
  const items = audit.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label="현재 위치">
        <Link
          className="font-semibold text-brand underline"
          to="/admin/questions"
        >
          문제 관리
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span aria-current="page">감사 기록</span>
      </nav>
      <header className="mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          ADMIN AUDIT
        </p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">
          관리자 감사 기록
        </h1>
        <p className="mt-4 text-muted">
          민감한 문제 본문 대신 허용된 상태·digest 증거만 표시합니다.
        </p>
      </header>
      {audit.isError && audit.data ? (
        <div
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="alert"
        >
          <p className="font-semibold">
            최신 감사 기록을 확인하지 못했습니다. 현재 기록은 그대로 유지됩니다.
          </p>
          <p className="mt-1 text-sm">
            {isPhase7UiApiError(audit.error)
              ? (audit.error.serverMessage ?? audit.error.message)
              : '감사 기록을 불러오지 못했습니다.'}
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void audit.refetch()}
          >
            감사 기록 다시 확인
          </Button>
        </div>
      ) : null}
      {audit.isPending && !audit.data ? (
        <LoadingState
          className="mt-8"
          message="감사 기록을 불러오는 중입니다…"
        />
      ) : !audit.data ? (
        <ErrorState
          className="mt-8"
          description={
            isPhase7UiApiError(audit.error)
              ? (audit.error.serverMessage ?? audit.error.message)
              : '감사 기록을 불러오지 못했습니다.'
          }
          onRetry={() => void audit.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          className="mt-8"
          description="아직 기록된 관리자 명령이 없습니다."
          title="감사 기록이 없습니다"
        />
      ) : (
        <ol className="mt-8 grid gap-3">
          {items.map((item) => (
            <li
              className="rounded-xl border border-line bg-white p-5"
              key={item.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{item.command}</strong>
                <time className="text-sm text-muted" dateTime={item.occurredAt}>
                  {new Date(item.occurredAt).toLocaleString('ko-KR')}
                </time>
              </div>
              <p className="mt-2 break-all text-sm">
                {item.targetType}: {item.targetId}
              </p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-muted">행위자</dt>
                  <dd className="mt-1 break-all">
                    {item.actor.label}
                    {item.actor.kind === 'ACCOUNT'
                      ? ` · ${item.actor.actorId}`
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted">상태 변경</dt>
                  <dd className="mt-1">
                    {item.beforeState ?? '없음'} → {item.afterState ?? '없음'}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted">rowVersion</dt>
                  <dd className="mt-1">
                    {item.beforeRowVersion ?? '없음'} →{' '}
                    {item.afterRowVersion ?? '없음'}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted">변경 필드</dt>
                  <dd className="mt-1 break-words">
                    {item.changedFields.length > 0
                      ? item.changedFields.join(', ')
                      : '없음'}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-muted">
                요청 {item.requestId} · 환경 {item.environment}
              </p>
            </li>
          ))}
        </ol>
      )}
      {audit.hasNextPage ? (
        <Button
          className="mt-6"
          disabled={audit.isFetchingNextPage}
          variant="outline"
          onClick={() => void audit.fetchNextPage()}
        >
          {audit.isFetchingNextPage
            ? '이전 감사 기록 불러오는 중…'
            : '이전 감사 기록 더 보기'}
        </Button>
      ) : null}
    </section>
  )
}
