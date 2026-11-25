import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import {
  ResumableError,
  ResumableRecord,
  ResumableStatusNotices
} from '@app/practice/components/ResumableSections'
import type { ResumableQuery } from '@app/practice/components/ResumableSections'

type ResumablePracticeProps = {
  query: ResumableQuery
  canLoad: boolean
  sourceUnavailable: boolean
  interactionLocked: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
  onCancel: (sessionId: string) => void
}

/** The most recent saved session only: no list or pages (subtract table 6). */
export const ResumablePractice = ({
  query,
  canLoad,
  sourceUnavailable,
  interactionLocked,
  headingRef,
  onCancel
}: ResumablePracticeProps): ReactElement | null => {
  const { t } = useTranslation('practice')
  const data = query.data
  const recent = query.isPlaceholderData ? undefined : data?.items[0]
  const confirmedEmpty =
    query.isSuccess &&
    data?.total === 0 &&
    !query.isPlaceholderData &&
    !sourceUnavailable &&
    !query.isFetching

  if (!canLoad || confirmedEmpty) return null

  return (
    <section
      className="practice-resumable"
      aria-labelledby="resumable-practice-title"
    >
      <h2
        ref={headingRef}
        id="resumable-practice-title"
        className={
          data?.items.length
            ? 'practice-resume-heading practice-title-quiet sr-only practice-resume-heading-peek'
            : 'practice-resume-heading practice-title-quiet'
        }
        tabIndex={-1}
      >
        {t('setup.resume.title')}
      </h2>

      <ResumableStatusNotices
        query={query}
        sourceUnavailable={sourceUnavailable}
      />

      {query.isPending ? (
        query.fetchStatus === 'paused' ? (
          <p className="practice-resume-status" role="status">
            {t('setup.resume.offline')}
          </p>
        ) : (
          <LoadingState
            className="practice-resume-status"
            density="inline"
            message={t('setup.resume.loading')}
          />
        )
      ) : query.isError && !data ? (
        <ResumableError
          query={query}
          description={t('setup.resume.error')}
          withRetry
        />
      ) : recent ? (
        <div className="practice-recent practice-recent-single">
          <ResumableRecord
            item={recent}
            interactionLocked={interactionLocked}
            onCancel={onCancel}
          />
        </div>
      ) : null}
    </section>
  )
}
