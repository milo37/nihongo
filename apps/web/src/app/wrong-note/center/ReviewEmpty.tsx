import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/contracts/common/enum'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import type { ReviewListEmpty } from '@app/wrong-note/hooks/useReviewListController'

type ReviewEmptyProps = {
  empty: ReviewListEmpty
  level: JlptLevel | undefined
  onShowAll: () => void
  startButton: ReactElement
}

/** An empty tab: nothing at this level, or nothing at all yet. */
export const ReviewEmpty = ({
  empty,
  level,
  onShowAll,
  startButton
}: ReviewEmptyProps): ReactElement => {
  const { t } = useTranslation('wrongNote')
  if (empty === 'levelNone')
    return (
      <div className="mt-8 flex flex-col items-start gap-3">
        <p className="text-base text-ink">{t('empty.levelNone', { level })}</p>
        <Button variant="outline" onClick={onShowAll}>
          {t('empty.showAll')}
        </Button>
      </div>
    )
  return (
    // JLP-855: no manuscript paper, message at the start edge.
    <EmptyState
      className="items-start! mx-0! px-0! text-start! [&>h2]:text-pretty [&:lang(ko)>h2]:break-keep"
      title={t(`empty.${empty}.title`)}
      description={
        // 'never' is one sentence (plan-notes §4).
        empty === 'never' ? undefined : t(`empty.${empty}.body`)
      }
      action={
        empty === 'noReviewed' ? (
          startButton
        ) : (
          <Link className={getButtonClassName()} to="/practice">
            {t('empty.startNew')}
          </Link>
        )
      }
    />
  )
}
