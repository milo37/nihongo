import { Badge } from '@nihongo/browser/common/components/Badge'
import { Button } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { Link, useLocation } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import type { QuestionBatch } from '@app/admin-question/hooks/useQuestionBatch'

/** Result of the last batch action, shown above the list until closed. */
export const QuestionBatchResult = ({
  batch,
  headingRef
}: {
  readonly batch: QuestionBatch
  readonly headingRef: RefObject<HTMLHeadingElement | null>
}): ReactElement | null => {
  const { t } = useAdminPresentation()
  const { locale } = useUiLocale()
  const location = useLocation()
  const { result } = batch

  if (result) {
    const count = formatNumber(result.succeeded, locale)
    const prefix = `questionList.batch.result.${result.action}` as const
    return (
      <section className="mt-8 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="rounded-sm text-lg font-bold"
          >
            {result.failed.length === 0
              ? t(`${prefix}.all`, { count })
              : t(`${prefix}.partial`, {
                  count,
                  failed: formatNumber(result.failed.length, locale)
                })}
          </h2>
          <Button variant="secondary" size="sm" onClick={batch.closeResult}>
            {t('questionList.batch.result.close')}
          </Button>
        </div>
        {result.failed.length > 0 ? (
          <ul className="mt-3 divide-y divide-line">
            {result.failed.map(({ questionId, result: outcome }) => (
              <li
                key={questionId}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-3"
              >
                <Link
                  className="break-all font-mono text-xs font-semibold text-brand underline underline-offset-4"
                  translate="no"
                  to={`/questions/${questionId}?returnTo=${encodeURIComponent('/admin/questions' + location.search)}`}
                >
                  {questionId}
                </Link>
                <Badge
                  variant="warning"
                  className="inline-flex w-fit items-center gap-1 whitespace-nowrap"
                >
                  <Icon name="circle-alert" className="size-3.5 shrink-0" />
                  {t(`${prefix}.${outcome}.label`)}
                </Badge>
                <span className="text-sm text-muted">
                  {t(`${prefix}.${outcome}.reason`)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    )
  }

  return null
}

/** Top toolbar content while rows are selected: count, actions, clear. */
export const QuestionSelectionBar = ({
  batch
}: {
  readonly batch: QuestionBatch
}): ReactElement => {
  const { t } = useAdminPresentation()
  const { locale } = useUiLocale()
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-2 text-sm font-bold">
          {t('adminList.selected', {
            count: formatNumber(batch.selected.length, locale)
          })}
        </p>
        {(['request', 'approve', 'publish'] as const).map((action) =>
          batch.targets[action].length > 0 ? (
            <Button key={action} size="sm" onClick={() => batch.open(action)}>
              {t(`questionList.batch.${action}`, {
                count: formatNumber(batch.targets[action].length, locale)
              })}
            </Button>
          ) : null
        )}
        <Button variant="ghost" size="sm" onClick={batch.clear}>
          {t('adminList.clearSelection')}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {t('questionList.batch.scopeNote')}
      </p>
    </div>
  )
}
