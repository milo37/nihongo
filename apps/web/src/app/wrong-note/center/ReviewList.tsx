import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import type {
  ReviewListItem as ReviewListEntry,
  WrongNoteReviewState
} from '@nihongo/contracts/wrong-note/list-review-list'
import { ReviewListItem } from '@app/wrong-note/center/ReviewListItem'

type ReviewListProps = {
  busy: boolean
  formatDate: (value: string) => string
  formatShortDate: (value: string) => string
  items: readonly ReviewListEntry[]
  returnTo: string
  rowLinks: RefObject<Map<string, HTMLAnchorElement>>
  state: WrongNoteReviewState
}

/** The list card: PC column heads, then one row per question. */
export const ReviewList = ({
  busy,
  formatDate,
  formatShortDate,
  items,
  returnTo,
  rowLinks,
  state
}: ReviewListProps): ReactElement => {
  // Left uncompiled: the compiled parent already caches this section, and
  // compiling it too adds about 200 bytes gzip (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('wrongNote')
  return (
    <div className="wrong-note-list">
      {/* PC column heads; each row already reads in full, so the
          heads are for sighted users only. */}
      <div aria-hidden="true" className="wrong-note-list-head">
        <span>{t('list.head.levelSubject')}</span>
        <span>{t('list.head.question')}</span>
        <span className="wrong-note-list-end">
          {state === 'TO_REVIEW' ? t('list.head.wrongCount') : null}
        </span>
        <span className="wrong-note-list-end">
          {state === 'TO_REVIEW'
            ? t('list.head.wrongDate')
            : t('list.head.reviewedDate')}
        </span>
      </div>
      <ol aria-busy={busy}>
        {items.map((item) => (
          <ReviewListItem
            key={item.questionId}
            item={item}
            formatDate={formatDate}
            formatShortDate={formatShortDate}
            returnTo={returnTo}
            linkRef={(node) => {
              if (node) rowLinks.current.set(item.questionId, node)
              else rowLinks.current.delete(item.questionId)
            }}
          />
        ))}
      </ol>
    </div>
  )
}
