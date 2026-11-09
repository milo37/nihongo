import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import type { MouseEvent, ReactElement } from 'react'
import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { Button } from '@nihongo/browser/common/components/Button'
import type { UiLocale } from '@nihongo/browser/i18n/types'
import { formatDateTime } from '@nihongo/browser/libs/localeFormatters'
import { StudyListRow } from '@common/components/StudyList'

type BookmarkListItemProps = {
  bookmark: BookmarkSummary
  isDeleting: boolean
  isRemoveDisabled: boolean
  locale: UiLocale
  onRemove: (event: MouseEvent<HTMLButtonElement>) => void
  removeButtonRef: (element: HTMLButtonElement | null) => void
}

/** A list row (ux2 §4): not a link, so only the remove button is pressed. */
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
  const isArchived = bookmark.availability === 'ARCHIVED'
  // Two topic labels at most: the question type, then the first tag.
  const topics = [
    questionTypeLabel,
    ...question.tags
      .map((tag) => tag.label)
      .filter((label) => label !== questionTypeLabel)
  ].slice(0, 2)
  // Shown on hover and keyboard focus; Esc hides it (WCAG 1.4.13).
  const [isTipOpen, setIsTipOpen] = useState(false)
  useEffect(() => {
    if (!isTipOpen) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsTipOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [isTipOpen])
  return (
    <StudyListRow
      meta={
        <>
          {question.level} · {commonT(`taxonomy.subjects.${question.subject}`)}
          <span className="ms-2 font-normal">{topics.join(' · ')}</span>
          {isArchived ? (
            <span className="ms-2 rounded-full border border-warning bg-warning-soft px-2 py-0.5 font-bold text-warning">
              {t('availability.archived')}
            </span>
          ) : null}
        </>
      }
      text={question.questionTextPreview}
      sub={
        <>
          {isArchived ? `${t('availability.archivedDescription')} · ` : null}
          <time dateTime={bookmark.createdAt}>
            {t('savedOn', {
              date: formatDateTime(bookmark.createdAt, locale, {
                month: 'long',
                day: 'numeric'
              })
            })}
          </time>
        </>
      }
      end={
        <span
          className="relative"
          onMouseEnter={() => setIsTipOpen(true)}
          onMouseLeave={() => setIsTipOpen(false)}
          onFocus={() => setIsTipOpen(true)}
          onBlur={() => setIsTipOpen(false)}
        >
          <Button
            id={`bookmark-remove-${bookmark.questionId}`}
            ref={removeButtonRef}
            className="-me-3 size-11 p-0 text-brand-strong"
            size="sm"
            variant="ghost"
            aria-label={t('remove')}
            disabled={isRemoveDisabled}
            aria-busy={isDeleting || undefined}
            onClick={onRemove}
          >
            <Icon name="bookmark" className="fill-current" />
          </Button>
          {/* ux2 §4. The text repeats the button name, so it is hidden from
              screen readers. It touches the button so the pointer can move
              onto it. The 44px target reaches into the page margin so the
              question keeps ≥300px. */}
          {isTipOpen ? (
            <span
              aria-hidden="true"
              className="absolute right-0 top-full z-10 whitespace-nowrap rounded-control bg-ink px-2 py-1 text-xs text-on-accent"
            >
              {t('remove')}
            </span>
          ) : null}
        </span>
      }
    />
  )
}
