import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { PracticeResultBookmark } from '@app/practice/hooks/usePracticeResultBookmark'
import { Button } from '@nihongo/browser/common/components/Button'
import { WarningNotice } from '@app/practice/result/WarningNotice'

type ResultBookmarkNoticesProps = {
  bookmark: PracticeResultBookmark
  isGuest: boolean
}

export const ResultBookmarkNotices = ({
  bookmark,
  isGuest
}: ResultBookmarkNoticesProps): ReactElement => {
  const { t } = useTranslation('result')
  const { bookmarksQuery, isMutationPaused } = bookmark
  return (
    <>
      {isMutationPaused ? (
        <WarningNotice live>{t('bookmark.offline')}</WarningNotice>
      ) : null}
      {!isGuest && bookmarksQuery.fetchStatus === 'paused' ? (
        <WarningNotice>{t('bookmark.loadOffline')}</WarningNotice>
      ) : !isGuest && bookmarksQuery.isError ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-lg border border-danger-line bg-danger-soft p-4 text-sm font-semibold text-danger"
          role="alert"
        >
          <span>{t('bookmark.loadError')}</span>
          <Button
            variant="outline"
            onClick={() => void bookmarksQuery.refetch()}
          >
            {t('bookmark.retry')}
          </Button>
        </div>
      ) : null}
    </>
  )
}
