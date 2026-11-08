import { questionVersionStatusSchema } from '@nihongo/contracts/admin/content-operations'
import { Select } from '@nihongo/browser/common/components/Select'
import {
  LEVELS,
  QUESTION_DIFFICULTIES,
  SUBJECTS
} from '@nihongo/browser/common/types/domain'
import type { FormEvent, ReactElement } from 'react'
import { SORTS } from '@app/admin-question/hooks/useQuestionListSearch'
import type { useQuestionListSearch } from '@app/admin-question/hooks/useQuestionListSearch'
import { AdminListFilters } from '@app/admin/components/list/AdminListFilters'
import { AdminListSearch } from '@app/admin/components/list/AdminListSearch'
import type { AdminListFilter } from '@app/admin/components/list/FilterChip'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

type QuestionListSearch = ReturnType<typeof useQuestionListSearch>

type QuestionListFiltersProps = Pick<
  QuestionListSearch,
  | 'search'
  | 'level'
  | 'subject'
  | 'status'
  | 'difficulty'
  | 'sort'
  | 'setFilter'
> & {
  total: number | undefined
  onSearch: (event: FormEvent<HTMLFormElement>) => void
  onReset: () => void
}

type FilterKey = 'level' | 'subject' | 'status' | 'difficulty'

export const QuestionListFilters = ({
  search,
  level,
  subject,
  status,
  difficulty,
  sort,
  setFilter,
  total,
  onSearch,
  onReset
}: QuestionListFiltersProps): ReactElement => {
  const { t } = useAdminPresentation()
  const filter = (
    key: FilterKey,
    value: string | undefined,
    options: AdminListFilter['options']
  ): AdminListFilter => ({
    key,
    label: t(`questionList.columns.${key}`),
    value,
    options,
    onChange: (next) => setFilter(key, next ?? '')
  })
  const filters = [
    filter(
      'level',
      level,
      LEVELS.map((value) => ({ value, label: value }))
    ),
    filter(
      'subject',
      subject,
      SUBJECTS.map((value) => ({
        value,
        label: t(`enums.subjects.${value}`)
      }))
    ),
    filter(
      'status',
      status,
      questionVersionStatusSchema.options.map((value) => ({
        value,
        label: t(`enums.versionStatuses.${value}`)
      }))
    ),
    filter(
      'difficulty',
      difficulty,
      QUESTION_DIFFICULTIES.map((value) => ({
        value,
        label: t(`enums.difficulties.${value}`)
      }))
    )
  ]

  return (
    <AdminListFilters
      search={
        <AdminListSearch
          formKey={search}
          name="search"
          label={t('questionList.searchLabel')}
          defaultValue={search}
          placeholder={t('questionList.searchPlaceholder')}
          // Contract q cap (contentQuestionSearchSchema maxScalars 100).
          maxLength={100}
          submitLabel={t('questionList.search')}
          onSearch={onSearch}
        />
      }
      filters={filters}
      resultCount={total}
      onReset={onReset}
      sort={
        <Select
          name="sort"
          label={t('questionList.sort')}
          hideLabel
          value={sort}
          onChange={(event) => setFilter('sort', event.currentTarget.value)}
        >
          {SORTS.map((value) => (
            <option key={value} value={value}>
              {t(`enums.questionSort.${value}`)}
            </option>
          ))}
        </Select>
      }
    />
  )
}
