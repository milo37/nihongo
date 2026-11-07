import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useLocation } from 'react-router'
import { useEffect, useRef } from 'react'
import type { ReactElement, RefObject } from 'react'
import { FreshAssurance } from '@app/admin/components/FreshAssurance'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { questionErrorCode } from '@app/admin-question/detail/questionWorkflow'
import type { QuestionBatch } from '@app/admin-question/hooks/useQuestionBatch'

const LISTED_IDS = 5

/** Confirmation for the open batch action (approve or publish). */
export const BatchActionDialog = ({
  batch,
  fallbackFocusRef
}: {
  readonly batch: QuestionBatch
  readonly fallbackFocusRef: RefObject<HTMLElement | null>
}): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const { locale } = useUiLocale()
  const { pathname, search } = useLocation()
  const { dialogTargets: selected, mutation } = batch
  const prefix = `questionList.batch.dialog.${batch.dialogAction}` as const
  const count = formatNumber(selected.length, locale)
  const confirmLabel = t(`${prefix}.confirm`, { count })
  const code = questionErrorCode(mutation.error)
  const rest = selected.length - LISTED_IDS
  const confirmButton = useRef<HTMLButtonElement>(null)
  const errorAlert = useRef<HTMLParagraphElement>(null)
  const showError = mutation.isError && code !== 'FRESH_ASSURANCE_REQUIRED'
  useEffect(() => {
    if (showError) errorAlert.current?.focus()
  }, [showError])
  useEffect(() => {
    if (batch.freshConfirmed) confirmButton.current?.focus()
  }, [batch.freshConfirmed])
  return (
    <Dialog
      open={batch.dialogOpen}
      title={t(`${prefix}.title`, { count })}
      description={t(`${prefix}.description`)}
      preventClose={mutation.isPending}
      fallbackFocusRef={fallbackFocusRef}
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
          {/* aria-disabled, not disabled: focus stays on the button while sending. */}
          <Button
            ref={confirmButton}
            className="aria-disabled:cursor-wait aria-disabled:opacity-70"
            aria-disabled={mutation.isPending || undefined}
            aria-busy={mutation.isPending || undefined}
            disabled={selected.length === 0}
            onClick={() => {
              if (!mutation.isPending) batch.confirm()
            }}
          >
            {mutation.isPending ? t(`${prefix}.confirming`) : confirmLabel}
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
      <p className="mt-4 leading-7 text-muted">{t(`${prefix}.body`)}</p>
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
      ) : showError ? (
        <p
          ref={errorAlert}
          tabIndex={-1}
          className="mt-4 rounded-sm text-sm font-semibold text-red-700"
          role="alert"
        >
          {presentError(mutation.error)} {t(`${prefix}.notDone`)}
        </p>
      ) : null}
    </Dialog>
  )
}
