import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useLocation } from 'react-router'
import type { ReactElement } from 'react'
import { FreshAssurance } from '@app/admin/components/FreshAssurance'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { questionErrorCode } from '@app/admin-question/detail/questionWorkflow'
import type { QuestionBatchPublish } from '@app/admin-question/hooks/useQuestionBatchPublish'

const LISTED_IDS = 5

export const BatchPublishDialog = ({
  batch
}: {
  readonly batch: QuestionBatchPublish
}): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const { locale } = useUiLocale()
  const { pathname, search } = useLocation()
  const { selected, mutation } = batch
  const count = formatNumber(selected.length, locale)
  const confirmLabel = t('questionList.batch.dialog.confirm', { count })
  const code = questionErrorCode(mutation.error)
  const rest = selected.length - LISTED_IDS
  return (
    <Dialog
      open={batch.dialogOpen}
      title={t('questionList.batch.dialog.title', { count })}
      description={t('questionList.batch.dialog.description')}
      preventClose={mutation.isPending}
      onOpenChange={(open) => {
        if (!open) batch.close()
      }}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={mutation.isPending}
            onClick={batch.close}
          >
            {t('questionList.batch.dialog.cancel')}
          </Button>
          <Button
            isLoading={mutation.isPending}
            loadingLabel={t('questionList.batch.dialog.confirming')}
            disabled={selected.length === 0}
            onClick={batch.publish}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {selected.slice(0, LISTED_IDS).map(({ questionId }) => (
          <li key={questionId} className="font-mono text-sm" translate="no">
            {questionId}
          </li>
        ))}
        {rest > 0 ? (
          <li className="text-sm text-muted">
            {t('questionList.batch.dialog.more', {
              rest: formatNumber(rest, locale)
            })}
          </li>
        ) : null}
      </ul>
      <p className="mt-4 leading-7 text-muted">
        {t('questionList.batch.dialog.body')}
      </p>
      {batch.freshConfirmed ? (
        <p role="status" className="mt-4 text-sm leading-6">
          {t('members.detail.fresh.confirmed', { command: confirmLabel })}
        </p>
      ) : code === 'FRESH_ASSURANCE_REQUIRED' ? (
        <FreshAssurance
          commandLabel={confirmLabel}
          returnPath={`/admin${pathname}${search}`}
          onConfirmed={batch.confirmFresh}
        />
      ) : mutation.isError ? (
        <p className="mt-4 text-sm font-semibold text-red-700" role="alert">
          {presentError(mutation.error)}{' '}
          {t('questionList.batch.dialog.notPublished')}
        </p>
      ) : null}
    </Dialog>
  )
}
