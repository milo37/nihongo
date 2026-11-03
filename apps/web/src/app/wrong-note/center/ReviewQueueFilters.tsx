import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { ParsedListReviewQueueQuery } from '@nihongo/contracts/wrong-note/list-review-queue'
import {
  LEVELS,
  QUESTION_TYPES,
  SUBJECTS
} from '@nihongo/browser/common/types/domain'
import { Button } from '@nihongo/browser/common/components/Button'
import { Select } from '@nihongo/browser/common/components/Select'

const views = ['DUE', 'UNREVIEWED', 'REPEATED', 'SOLVED'] as const
const sorts = ['NEXT_REVIEW', 'MOST_WRONG', 'RECENT'] as const

type ReviewQueueFiltersProps = {
  expanded: boolean
  hasAdvancedFilters: boolean
  onChange: (
    key: keyof ParsedListReviewQueueQuery,
    value: string | undefined
  ) => void
  onReset: () => void
  onToggleAdvanced: (open: boolean) => void
  query: ParsedListReviewQueueQuery
  visibleTags: string[]
}

export const ReviewQueueFilters = ({
  expanded,
  hasAdvancedFilters,
  onChange,
  onReset,
  onToggleAdvanced,
  query,
  visibleTags
}: ReviewQueueFiltersProps): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  return (
    <form
      className="review-filters"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="review-basic-filters">
        <Select
          name="review-view"
          label={t('integration.range')}
          value={query.view}
          onChange={(event) => onChange('view', event.currentTarget.value)}
          options={views.map((view) => ({
            value: view,
            label: t(`integration.views.${view}`)
          }))}
        />
        <Select
          name="review-level"
          label={t('center.filters.level')}
          value={query.level ?? ''}
          onChange={(event) =>
            onChange('level', event.currentTarget.value || undefined)
          }
          options={[
            { value: '', label: t('center.filters.allLevels') },
            ...LEVELS.map((level) => ({ value: level, label: level }))
          ]}
        />
        <Select
          name="review-subject"
          label={t('center.filters.subject')}
          value={query.subject ?? ''}
          onChange={(event) =>
            onChange('subject', event.currentTarget.value || undefined)
          }
          options={[
            { value: '', label: t('center.filters.allSubjects') },
            ...SUBJECTS.map((subject) => ({
              value: subject,
              label: commonT(`taxonomy.subjects.${subject}`)
            }))
          ]}
        />
      </div>
      <details
        className="review-advanced"
        open={expanded}
        onToggle={(event) => onToggleAdvanced(event.currentTarget.open)}
      >
        <summary>
          {t('integration.advanced')}
          {hasAdvancedFilters ? (
            <span className="review-applied">{t('integration.applied')}</span>
          ) : null}
        </summary>
        <div className="review-advanced-fields">
          <Select
            name="review-question-type"
            label={t('center.filters.questionType')}
            value={query.questionType ?? ''}
            onChange={(event) =>
              onChange('questionType', event.currentTarget.value || undefined)
            }
            options={[
              { value: '', label: t('center.filters.allQuestionTypes') },
              ...QUESTION_TYPES.map((type) => ({
                value: type,
                label: commonT(`taxonomy.questionTypes.${type}`)
              }))
            ]}
          />
          <Select
            name="review-tag"
            label={t('center.filters.tag')}
            value={query.tag ?? ''}
            onChange={(event) =>
              onChange('tag', event.currentTarget.value || undefined)
            }
            options={[
              { value: '', label: t('center.filters.allTags') },
              ...visibleTags.map((tag) => ({ value: tag, label: tag }))
            ]}
          />
          <Select
            name="review-sort"
            label={t('center.filters.sort')}
            value={query.sort}
            onChange={(event) => onChange('sort', event.currentTarget.value)}
            options={sorts.map((sort) => ({
              value: sort,
              label: t(`integration.sort.${sort}`)
            }))}
          />
        </div>
        <Button variant="ghost" onClick={onReset}>
          {t('integration.reset')}
        </Button>
      </details>
    </form>
  )
}
