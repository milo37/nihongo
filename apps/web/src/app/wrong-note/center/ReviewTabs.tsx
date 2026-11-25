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
  // Left uncompiled: the compiled parent already caches this section, and
  // compiling it too adds about 200 bytes gzip (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('wrongNote')
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = selected === 'TO_REVIEW' ? 'REVIEWED' : 'TO_REVIEW'
    onSelect(next)
    tabs.current.get(next)?.focus()
  }
  return (
    <div role="tablist" aria-label={t('title')} className="wrong-note-tabs">
      {STATES.map((state) => {
        const isSelected = selected === state
        // #1262: an unknown count shows no number, never a made-up 0.
        const count = counts?.[TAB_KEYS[state]]
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
            className={`wrong-note-tab${isSelected ? ' is-selected' : ''}`}
            onClick={() => onSelect(state)}
            onKeyDown={onKeyDown}
          >
            {t(`tabs.${TAB_KEYS[state]}`, {
              count: count ?? 0,
              formattedCount:
                count === undefined ? '' : formatNumber(count, locale)
            }).trim()}
          </button>
        )
      })}
    </div>
  )
}
