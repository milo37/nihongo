import { questionVersionStatusSchema } from '@nihongo/contracts/admin/content-operations'
import { Button } from '@nihongo/browser/common/components/Button'
import { Input } from '@nihongo/browser/common/components/Input'
import { Select } from '@nihongo/browser/common/components/Select'
import {
  LEVELS,
  QUESTION_DIFFICULTIES,
  SUBJECTS
} from '@nihongo/browser/common/types/domain'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import type { FormEvent, ReactElement } from 'react'
import { SORTS } from '@app/admin-question/hooks/useQuestionListSearch'
import type { useQuestionListSearch } from '@app/admin-question/hooks/useQuestionListSearch'
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
  | 'hasActiveFilters'
  | 'setFilter'
> & {
  total: number | undefined
  onSearch: (event: FormEvent<HTMLFormElement>) => void
  onReset: () => void
}

export const QuestionListFilters = ({
  search,
  level,
  subject,
  status,
  difficulty,
  sort,
  hasActiveFilters,
  setFilter,
  total,
  onSearch: handleSearch,
  onReset
}: QuestionListFiltersProps): ReactElement => {
  const { t } = useAdminPresentation()
  const { locale } = useUiLocale()
  return (
    <div className="mt-8 rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-6">
      <form
        key={search}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        role="search"
        onSubmit={handleSearch}
      >
        <div className="min-w-0 flex-1">
          <Input
            name="search"
            label={t('questionList.searchLabel')}
            defaultValue={search}
            placeholder={t('questionList.searchPlaceholder')}
            autoComplete="off"
            // Contract q cap (phase7QuestionSearchSchema maxScalars 100).
            maxLength={100}
          />
        </div>
        <Button className="sm:mb-0" type="submit">
          {t('questionList.search')}
        </Button>
      </form>

      <fieldset className="mt-5 border-t border-line pt-5">
        <legend className="sr-only">{t('questionList.filtersLegend')}</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            name="level"
            label={t('questionList.columns.level')}
            value={level ?? ''}
            onChange={(event) => setFilter('level', event.currentTarget.value)}
          >
            <option value="">{t('questionList.allLevels')}</option>
            {LEVELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <Select
            name="subject"
            label={t('questionList.columns.subject')}
            value={subject ?? ''}
            onChange={(event) =>
              setFilter('subject', event.currentTarget.value)
            }
          >
            <option value="">{t('questionList.allSubjects')}</option>
            {SUBJECTS.map((value) => (
              <option key={value} value={value}>
                {t(`enums.subjects.${value}`)}
              </option>
            ))}
          </Select>
          <Select
            name="status"
            label={t('questionList.columns.status')}
            value={status ?? ''}
            onChange={(event) => setFilter('status', event.currentTarget.value)}
          >
            <option value="">{t('questionList.allStatuses')}</option>
            {questionVersionStatusSchema.options.map((value) => (
              <option key={value} value={value}>
                {t(`enums.versionStatuses.${value}`)}
              </option>
            ))}
          </Select>
          <Select
            name="difficulty"
            label={t('questionList.columns.difficulty')}
            value={difficulty ?? ''}
            onChange={(event) =>
              setFilter('difficulty', event.currentTarget.value)
            }
          >
            <option value="">{t('questionList.allDifficulties')}</option>
            {QUESTION_DIFFICULTIES.map((value) => (
              <option key={value} value={value}>
                {t(`enums.difficulties.${value}`)}
              </option>
            ))}
          </Select>
          <Select
            name="sort"
            label={t('questionList.sort')}
            value={sort}
            onChange={(event) => setFilter('sort', event.currentTarget.value)}
          >
            {SORTS.map((value) => (
              <option key={value} value={value}>
                {t(`enums.questionSort.${value}`)}
              </option>
            ))}
          </Select>
        </div>
      </fieldset>

      <div className="mt-5 flex min-h-11 flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-sm text-muted" aria-live="polite">
          {total !== undefined
            ? t('questionList.total', {
                formattedCount: formatNumber(total, locale)
              })
            : t('questionList.totalPending')}
        </p>
        {hasActiveFilters ? (
          <button
            className="min-h-11 rounded-lg px-3 text-sm font-semibold text-brand underline underline-offset-4 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            type="button"
            onClick={onReset}
          >
            {t('questionList.resetFilters')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
