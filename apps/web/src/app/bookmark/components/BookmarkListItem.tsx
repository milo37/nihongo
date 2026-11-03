import { useTranslation } from 'react-i18next'
import type { MouseEvent, ReactElement } from 'react'
import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { Button } from '@nihongo/browser/common/components/Button'
import type { UiLocale } from '@nihongo/browser/i18n/types'
import { formatDateTime } from '@nihongo/browser/libs/localeFormatters'

type BookmarkListItemProps = {
  bookmark: BookmarkSummary
  isDeleting: boolean
  isRemoveDisabled: boolean
  locale: UiLocale
  onRemove: (event: MouseEvent<HTMLButtonElement>) => void
  removeButtonRef: (element: HTMLButtonElement | null) => void
}

export const BookmarkListItem = ({
  bookmark,
  isDeleting,
  isRemoveDisabled,
  locale,
  onRemove,
  removeButtonRef
}: BookmarkListItemProps): ReactElement => {
  const { t } = useTranslation('bookmark')
  const { t: commonT } = useTranslation('common')
  const { question } = bookmark
  const questionTypeLabel = commonT(
    `taxonomy.questionTypes.${question.questionType}`
  )
  return (
    <article className="bookmark-item content-auto">
      <div className="bookmark-content">
        <p className="bookmark-meta">
          <strong>
            {question.level} ·{' '}
            {commonT(`taxonomy.subjects.${question.subject}`)}
          </strong>
          <span>{questionTypeLabel}</span>
          {question.tags
            .filter((tag) => tag.label !== questionTypeLabel)
            .map((tag) => (
              <span key={tag.id}>{tag.label}</span>
            ))}
          {bookmark.availability === 'ARCHIVED' ? (
            <span className="bookmark-archive">
              {t('availability.archived')}
            </span>
          ) : null}
        </p>
        <details className="bookmark-preview">
          <summary aria-label={t('preview.expand')}>
            <span lang="ja">{question.questionTextPreview}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <p className="bookmark-preview-note">{t('preview.description')}</p>
        </details>
        {bookmark.availability === 'ARCHIVED' ? (
          <p className="bookmark-archive-description">
            {t('availability.archivedDescription')}
          </p>
        ) : null}
      </div>
      <time className="bookmark-added" dateTime={bookmark.createdAt}>
        {formatDateTime(bookmark.createdAt, locale, {
          month: 'numeric',
          day: 'numeric'
        })}
      </time>
      <Button
        id={`bookmark-remove-${bookmark.questionId}`}
        ref={removeButtonRef}
        className="bookmark-remove"
        size="sm"
        variant="ghost"
        aria-label={t('remove')}
        title={t('remove')}
        disabled={isRemoveDisabled}
        aria-busy={isDeleting || undefined}
        onClick={onRemove}
      >
        <Icon name="bookmark" />
      </Button>
    </article>
  )
}
