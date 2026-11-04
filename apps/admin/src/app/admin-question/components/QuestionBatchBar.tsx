import { Badge } from '@nihongo/browser/common/components/Badge'
import { Button } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { Link, useLocation } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import type { QuestionBatchPublish } from '@app/admin-question/hooks/useQuestionBatchPublish'

/** Selection bar above the list, replaced by the result of the last publish. */
export const QuestionBatchBar = ({
  batch,
  headingRef
}: {
  readonly batch: QuestionBatchPublish
  readonly headingRef: RefObject<HTMLHeadingElement | null>
}): ReactElement | null => {
  const { t } = useAdminPresentation()
  const { locale } = useUiLocale()
  const location = useLocation()
  const { result } = batch

  if (result) {
    const published = formatNumber(result.published, locale)
    return (
      <section className="mt-8 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="rounded-sm text-lg font-bold"
          >
            {result.failed.length === 0
              ? t('questionList.batch.result.allPublished', { published })
              : t('questionList.batch.result.partial', {
                  published,
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
                  {t(`questionList.batch.result.${outcome}.label`)}
                </Badge>
                <span className="text-sm text-muted">
                  {t(`questionList.batch.result.${outcome}.reason`)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    )
  }

  if (batch.selected.length === 0) return null
  return (
    <section className="mt-8 rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite" className="font-semibold">
          {t('questionList.batch.selected', {
            count: formatNumber(batch.selected.length, locale)
          })}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={batch.clear}
          >
            {t('questionList.batch.clear')}
          </Button>
          <Button className="w-full sm:w-auto" onClick={batch.open}>
            {t('questionList.batch.publish')}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">
        {t('questionList.batch.scopeNote')}
      </p>
    </section>
  )
}
