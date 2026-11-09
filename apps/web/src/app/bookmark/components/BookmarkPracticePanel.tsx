import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { AccountRestrictedNotice } from '@common/components/AccountRestrictedNotice'
import type { BookmarkPracticeGroup } from '@app/bookmark/hooks/useBookmarkPageController'
import { BOOKMARK_PRACTICE_COUNT } from '@app/bookmark/hooks/useBookmarkPageController'

type BookmarkPracticePanelProps = {
  accountRestricted: boolean
  formatCount: (value: number) => string
  groups: BookmarkPracticeGroup[]
  hasStartError: boolean
  isOffline: boolean
  isStarting: boolean
  noEligibleQuestions: boolean
  onRefresh: () => void
  onRetry: () => void
  onStart: (group: BookmarkPracticeGroup) => void
  pendingGroup: Partial<BookmarkPracticeGroup> | undefined
}

export const BookmarkPracticePanel = ({
  accountRestricted,
  formatCount,
  groups,
  hasStartError,
  isOffline,
  isStarting,
  noEligibleQuestions,
  onRefresh,
  onRetry,
  onStart,
  pendingGroup
}: BookmarkPracticePanelProps): ReactElement => {
  const { t } = useTranslation('bookmark')
  const { t: commonT } = useTranslation('common')
  return (
    <details className="bookmark-practice">
      <summary
        className={getButtonClassName({ size: 'lg', className: 'h-12' })}
      >
        <Icon name="rotate-ccw" />
        {t('practice.title')}
      </summary>
      <div className="bookmark-practice-options">
        <p className="mt-2 text-sm leading-6 text-muted">
          {t('practice.description')}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {groups.map((group) => (
            <Button
              key={`${group.level}:${group.subject}`}
              variant="outline"
              disabled={isStarting}
              isLoading={
                pendingGroup?.level === group.level &&
                pendingGroup.subject === group.subject
              }
              onClick={() => onStart(group)}
            >
              {t('practice.groupAction', {
                level: group.level,
                subject: commonT(`taxonomy.subjects.${group.subject}`),
                formattedCount: formatCount(BOOKMARK_PRACTICE_COUNT)
              })}
            </Button>
          ))}
        </div>
        {isOffline ? (
          <p
            className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900"
            role="status"
          >
            {t('practice.offline')}
          </p>
        ) : null}
        {accountRestricted ? (
          <AccountRestrictedNotice className="mt-5" />
        ) : null}
        {noEligibleQuestions ? (
          <div
            className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4"
            role="alert"
          >
            <p className="font-bold text-amber-900">
              {t('practice.noneAvailable')}
            </p>
            <Button className="mt-3" variant="outline" onClick={onRefresh}>
              {t('practice.refresh')}
            </Button>
          </div>
        ) : null}
        {hasStartError ? (
          <div
            className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4"
            role="alert"
          >
            <p className="font-bold text-red-800">{t('practice.startError')}</p>
            <Button className="mt-3" variant="outline" onClick={onRetry}>
              {commonT('actions.retry')}
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  )
}
