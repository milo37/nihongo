import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { useGetDashboardInsights } from '@app/dashboard/hooks/useGetDashboardInsights'
import { useDashboardRecommendationAction } from '@app/dashboard/hooks/useDashboardRecommendationAction'
import { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import { Button } from '@common/components/Button'
import { useAppStore } from '@store/index'
import { formatDateTime, formatNumber } from '@libs/localeFormatters'
import { resolveUiLocale } from '@/i18n/types'

interface RetryFocusIntent {
  origin: Element | null
  succeeded: boolean
}

const useEntryRetryFocus = (isReady: boolean) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const requestedRef = useRef<RetryFocusIntent | null>(null)
  const [completion, setCompletion] = useState(0)
  const restoreFocus = useCallback((): void => {
    if (!requestedRef.current?.succeeded) return
    requestedRef.current = null
    containerRef.current?.querySelector<HTMLElement>('h2')?.focus()
  }, [])
  useEffect(() => {
    const cancelOnFocus = (event: FocusEvent): void => {
      if (
        requestedRef.current &&
        event.target !== requestedRef.current.origin
      ) {
        requestedRef.current = null
      }
    }
    const cancelOnInteraction = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key !== 'Tab') return
      if (
        event.type === 'pointerdown' &&
        event.target === requestedRef.current?.origin
      )
        return
      requestedRef.current = null
    }
    document.addEventListener('focusin', cancelOnFocus)
    document.addEventListener('keydown', cancelOnInteraction)
    document.addEventListener('pointerdown', cancelOnInteraction)
    return () => {
      requestedRef.current = null
      document.removeEventListener('focusin', cancelOnFocus)
      document.removeEventListener('keydown', cancelOnInteraction)
      document.removeEventListener('pointerdown', cancelOnInteraction)
    }
  }, [])
  useEffect(() => {
    if (!requestedRef.current?.succeeded) return
    if (isReady) restoreFocus()
    else requestedRef.current = null
  }, [isReady, completion, restoreFocus])
  return {
    containerRef,
    restoreFocus,
    retryWithFocus: async (
      refetch: () => Promise<{ isSuccess: boolean }>
    ): Promise<void> => {
      if (requestedRef.current) return
      const intent = { origin: document.activeElement, succeeded: false }
      requestedRef.current = intent
      try {
        const result = await refetch()
        if (requestedRef.current !== intent) return
        if (!result?.isSuccess) {
          requestedRef.current = null
          return
        }
        intent.succeeded = true
        setCompletion((value) => value + 1)
      } catch {
        if (requestedRef.current === intent) requestedRef.current = null
      }
    }
  }
}

type RecommendedEntryProps = { readonly onReady: () => void }

export const DashboardRecommendedEntry = ({
  onReady
}: RecommendedEntryProps): ReactElement => {
  const { t } = useTranslation('home')
  const { t: dashboardT } = useTranslation('dashboard')
  const query = useGetDashboardInsights()
  const action = useDashboardRecommendationAction({
    refetchInsights: async () => {
      const result = await query.refetch()
      return result.isSuccess
    }
  })
  const recommendation = query.data?.recommendations.reduce<
    NonNullable<typeof query.data>['recommendations'][number] | undefined
  >(
    (first, item) => (!first || item.rank < first.rank ? item : first),
    undefined
  )
  const unavailable = query.isError || query.fetchStatus === 'paused'
  const isReady = query.isSuccess && !query.isFetching && !unavailable
  const { containerRef, retryWithFocus } = useEntryRetryFocus(isReady)
  useEffect(() => {
    if (isReady) onReady()
  }, [isReady, onReady])

  if (query.isPending && !unavailable) {
    return <p role="status">{t('entry.loading')}</p>
  }
  if (unavailable || !query.data) {
    return (
      <div role="alert">
        <p>{t('entry.recommendationError')}</p>
        <Button
          className="mt-4"
          variant="secondary"
          disabled={query.isFetching}
          onClick={() => void retryWithFocus(query.refetch)}
        >
          {t('entry.retry')}
        </Button>
      </div>
    )
  }
  return (
    <div ref={containerRef}>
      <p className="text-xs text-muted">{t('entry.recommended')}</p>
      {query.data.personalizationNotice ? (
        <p className="mt-3 leading-7 text-muted">
          {query.data.personalizationNotice}
        </p>
      ) : null}
      {recommendation ? (
        <>
          <h2
            tabIndex={-1}
            className="mt-3 text-2xl font-semibold focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
          >
            {recommendation.title}
          </h2>
          <p className="mt-4 leading-7 text-muted">
            {recommendation.reason.leading}
            {recommendation.reason.japanesePreview ? (
              <span lang="ja">{recommendation.reason.japanesePreview}</span>
            ) : null}
            {recommendation.reason.trailing}
          </p>
          <p className="mt-3 text-sm text-muted">
            {recommendation.actionSummary}
          </p>
          {recommendation.action.kind === 'START_SESSION' &&
          recommendation.action.mode === 'WEAKNESS' ? (
            <p className="mt-2 text-sm leading-6 text-muted">
              {t('entry.subjectScope')}
            </p>
          ) : null}
          <Button
            className="mt-6 w-full sm:w-auto"
            size="lg"
            disabled={
              action.blockedRecommendationKind === recommendation.kind ||
              action.isActionPending
            }
            isLoading={action.pendingRecommendationKind === recommendation.kind}
            onClick={() => action.runRecommendation(recommendation)}
          >
            {recommendation.actionLabel}
          </Button>
        </>
      ) : (
        <p className="mt-4">{t('entry.noRecommendation')}</p>
      )}
      {action.actionNotice ? (
        <div
          className="mt-4 border-l-2 border-brand pl-4"
          role="status"
          aria-live="polite"
          key={action.actionNotice.id}
        >
          <p>
            {dashboardT(`insights.actionNotice.${action.actionNotice.code}`)}
          </p>
          {action.blockedRecommendationKind ? (
            <Button
              className="mt-3"
              variant="secondary"
              disabled={action.isActionPending}
              onClick={() => void action.retryInsights()}
            >
              {t('entry.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

type LearningEntryProps = { readonly isMember: boolean }

export const LearningEntry = ({
  isMember
}: LearningEntryProps): ReactElement | null => {
  const { i18n, t } = useTranslation('home')
  const { t: commonT } = useTranslation('common')
  const storedSessionId = useAppStore((state) => state.sessionId)
  const enabled = isMember || storedSessionId !== null
  const query = useListResumableStudySessions(1, 5, enabled)
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const unavailable = query.isError || query.fetchStatus === 'paused'
  const { containerRef, restoreFocus, retryWithFocus } = useEntryRetryFocus(
    query.isSuccess && !query.isFetching && !unavailable
  )

  const item = query.data?.items[0]
  if (!enabled) return null
  if (query.isPending && !unavailable)
    return <p role="status">{t('entry.loading')}</p>
  if (unavailable) {
    return (
      <div role="alert">
        <p>{t('entry.resumeError')}</p>
        <Button
          className="mt-4"
          variant="secondary"
          disabled={query.isFetching}
          onClick={() => void retryWithFocus(query.refetch)}
        >
          {t('entry.retry')}
        </Button>
      </div>
    )
  }
  if (item) {
    const canResume =
      item.resumeAvailability === 'SERVER' || storedSessionId === item.id
    return (
      <div ref={containerRef}>
        <p className="text-xs text-muted">{t('entry.resumeEyebrow')}</p>
        <h2
          tabIndex={-1}
          className="mt-3 text-2xl font-semibold focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
        >
          {item.level} · {commonT(`taxonomy.subjects.${item.subject}`)}
        </h2>
        <p className="mt-4 leading-7">
          {t('entry.position', {
            current: formatNumber(item.currentOrdinal ?? 1, locale),
            total: formatNumber(item.actualCount, locale)
          })}
        </p>
        <p className="mt-2 text-sm text-muted">
          {item.draftSavedAt
            ? t('entry.savedAt', {
                date: formatDateTime(item.draftSavedAt, locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                })
              })
            : t('entry.notSaved')}
        </p>
        {canResume ? (
          <Link
            className="note-primary mt-6 w-full sm:w-auto"
            to={`/practice/session/${item.id}`}
          >
            {t('entry.resume')}
          </Link>
        ) : (
          <p className="mt-4" role="status">
            {t('entry.legacyUnavailable')}
          </p>
        )}
      </div>
    )
  }
  return isMember ? (
    <div ref={containerRef}>
      <DashboardRecommendedEntry onReady={restoreFocus} />
    </div>
  ) : null
}
