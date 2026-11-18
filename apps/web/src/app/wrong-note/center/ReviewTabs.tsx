import { useTranslation } from 'react-i18next'
import type { KeyboardEvent, ReactElement, RefObject } from 'react'
import type { WrongNoteReviewState } from '@nihongo/contracts/wrong-note/list-review-list'
import type { UiLocale } from '@nihongo/browser/i18n/types'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'

const STATES: readonly WrongNoteReviewState[] = ['TO_REVIEW', 'REVIEWED']
const TAB_KEYS = { TO_REVIEW: 'toReview', REVIEWED: 'reviewed' } as const

type ReviewTabsProps = {
  counts: { toReview: number; reviewed: number } | undefined
  locale: UiLocale
  onSelect: (state: WrongNoteReviewState) => void
  selected: WrongNoteReviewState
  tabs: RefObject<Map<WrongNoteReviewState, HTMLButtonElement>>
}

/** The two tabs, to review and reviewed; arrow keys move between them. */
export const ReviewTabs = ({
  counts,
  locale,
  onSelect,
  selected,
  tabs
}: ReviewTabsProps): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = selected === 'TO_REVIEW' ? 'REVIEWED' : 'TO_REVIEW'
    onSelect(next)
    tabs.current.get(next)?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={t('title')}
      className="mt-4 grid grid-cols-2 border-b border-line"
    >
      {STATES.map((state) => {
        const isSelected = selected === state
        const count = counts?.[TAB_KEYS[state]] ?? 0
        return (
          <button
            key={state}
            ref={(node) => {
              if (node) tabs.current.set(state, node)
              else tabs.current.delete(state)
            }}
            id={`review-tab-${state}`}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-controls="review-panel"
            tabIndex={isSelected ? 0 : -1}
            className={`-mb-px min-h-12 border-b-[3px] text-[15px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
              isSelected
                ? 'border-brand font-bold text-ink'
                : 'border-transparent font-semibold text-muted'
            }`}
            onClick={() => onSelect(state)}
            onKeyDown={onKeyDown}
          >
            {t(`tabs.${TAB_KEYS[state]}`, {
              count,
              formattedCount: formatNumber(count, locale)
            })}
          </button>
        )
      })}
    </div>
  )
}
