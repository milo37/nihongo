import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormEvent, ReactElement } from 'react'
import type { ListAdminQuestionReportsQuery } from '@nihongo/contracts/admin/phase7'
import {
  adminReportReasonKey,
  adminReportSortKey,
  adminReportStatusKey
} from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { Button } from '@common/components/Button'
import { Input } from '@common/components/Input'
import { Select } from '@common/components/Select'
import { Icon } from '@common/components/Icon'
const advancedKeys = [
  'assigneeActorId',
  'createdFrom',
  'createdTo',
  'updatedFrom',
  'updatedTo'
] as const
type ReportListFiltersProps = {
  readonly search: URLSearchParams
  readonly query: ListAdminQuestionReportsQuery
  readonly onChange: (search: URLSearchParams) => void
}
export const ReportListFilters = ({
  search,
  query,
  onChange
}: ReportListFiltersProps): ReactElement => {
  const { t } = useAdminPresentation()
  const { t: labels } = useTranslation('adminReports')
  const [expanded, setExpanded] = useState(
    advancedKeys.some((key) => search.has(key))
  )
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(
      ['questionId', ...advancedKeys].map((key) => [key, search.get(key) ?? ''])
    )
  )
  const immediate = (
    key: 'status' | 'reason' | 'sort',
    value: string
  ): void => {
    const next = new URLSearchParams(search)
    next.delete('focusReport')
    next.set('page', '1')
    if (value) next.set(key, value)
    else next.delete(key)
    onChange(next)
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const next = new URLSearchParams(search)
    next.delete('focusReport')
    next.set('page', '1')
    for (const [key, value] of Object.entries(draft)) {
      if (value.trim()) next.set(key, value.trim())
      else next.delete(key)
    }
    onChange(next)
  }
  return (
    <form className="admin-report-filter" onSubmit={submit} noValidate>
      <div className="admin-report-filter-core">
        <Select
          label={t('reportList.status')}
          name="status"
          value={search.get('status') ?? ''}
          options={[
            { value: '', label: t('reportList.allStatuses') },
            ...Object.entries(adminReportStatusKey).map(([value, key]) => ({
              value,
              label: t(key)
            }))
          ]}
          onChange={(event) => immediate('status', event.currentTarget.value)}
        />
        <Select
          label={t('reportList.reason')}
          name="reason"
          value={search.get('reason') ?? ''}
          options={[
            { value: '', label: t('reportList.allReasons') },
            ...Object.entries(adminReportReasonKey).map(([value, key]) => ({
              value,
              label: t(key)
            }))
          ]}
          onChange={(event) => immediate('reason', event.currentTarget.value)}
        />
        <Input
          label={t('reportList.questionId')}
          name="questionId"
          value={draft.questionId}
          onChange={(event) =>
            setDraft({ ...draft, questionId: event.currentTarget.value })
          }
        />
        <Select
          label={t('reportList.sort')}
          name="sort"
          value={query.sort}
          options={Object.entries(adminReportSortKey).map(([value, key]) => ({
            value,
            label: t(key)
          }))}
          onChange={(event) => immediate('sort', event.currentTarget.value)}
        />
      </div>
      <Button
        className="admin-report-filter-toggle"
        variant="ghost"
        aria-expanded={expanded}
        aria-controls="report-advanced-filters"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name="chevron-right" />
        {labels('advanced')}
      </Button>
      <div
        className="admin-report-filter-advanced"
        id="report-advanced-filters"
        hidden={!expanded}
      >
        {advancedKeys.map((key) => (
          <Input
            key={key}
            label={t(`reportList.${key}`)}
            name={key}
            value={draft[key]}
            hint={key === 'assigneeActorId' ? undefined : 'ISO 8601'}
            onChange={(event) =>
              setDraft({ ...draft, [key]: event.currentTarget.value })
            }
          />
        ))}
      </div>
      <div className="admin-report-actions">
        <Button type="submit">{t('reportList.applySearch')}</Button>
        <Button
          variant="ghost"
          onClick={() => {
            setDraft(
              Object.fromEntries(
                ['questionId', ...advancedKeys].map((key) => [key, ''])
              )
            )
            onChange(new URLSearchParams())
          }}
        >
          {t('reportList.resetFilters')}
        </Button>
      </div>
    </form>
  )
}
