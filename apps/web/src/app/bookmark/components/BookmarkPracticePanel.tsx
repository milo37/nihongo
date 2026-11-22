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
        className={getButtonClassName({
          size: 'lg',
          className: 'bookmark-practice-start'
        })}
      >
        <Icon name="rotate-ccw" />
        {t('practice.title')}
      </summary>
      <div className="bookmark-practice-options">
        <p className="bookmark-practice-text">{t('practice.description')}</p>
        <div className="bookmark-practice-groups">
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
          <p className="bookmark-offline" role="status">
            {t('practice.offline')}
          </p>
        ) : null}
        {accountRestricted ? (
          <AccountRestrictedNotice className="bookmark-restricted" />
        ) : null}
        {noEligibleQuestions ? (
          <div className="bookmark-changed" role="alert">
            <p className="bookmark-changed-title">
              {t('practice.noneAvailable')}
            </p>
            <Button
              className="bookmark-retry"
              variant="outline"
              onClick={onRefresh}
            >
              {t('practice.refresh')}
            </Button>
          </div>
        ) : null}
        {hasStartError ? (
          <div className="bookmark-start-error" role="alert">
            <p className="bookmark-start-error-title">
              {t('practice.startError')}
            </p>
            <Button
              className="bookmark-retry"
              variant="outline"
              onClick={onRetry}
            >
              {commonT('actions.retry')}
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  )
}
