import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'

type PracticeQuestionBookmarkButtonProps = {
  isBookmarked: boolean
  isDisabled: boolean
  onToggle: () => void
  questionNumber: number
}

export const PracticeQuestionBookmarkButton = ({
  isBookmarked,
  isDisabled,
  onToggle,
  questionNumber
}: PracticeQuestionBookmarkButtonProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { formatCount } = usePracticeNumberFormat()
  return (
    <button
      className="study-bookmark-button"
      type="button"
      // Focus stays here while busy (a toast closed with Esc returns to it).
      aria-disabled={isDisabled || undefined}
      aria-label={t(
        isBookmarked
          ? 'session.bookmark.removeLabel'
          : 'session.bookmark.addLabel',
        { ordinal: formatCount(questionNumber) }
      )}
      aria-pressed={isBookmarked}
      data-selected={isBookmarked}
      onClick={() => {
        if (!isDisabled) onToggle()
      }}
    >
      <Icon name="bookmark" />
    </button>
  )
}
