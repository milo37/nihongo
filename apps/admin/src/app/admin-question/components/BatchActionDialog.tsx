import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useEffect, useRef } from 'react'
import type { ReactElement, RefObject } from 'react'
import {
  ReauthDialogButton,
  ReauthRequiredNotice
} from '@app/admin/reauth/ReauthRequiredNotice'
import { useAdminReauth } from '@app/admin/reauth/useAdminReauth'
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
  const reauth = useAdminReauth()
  const { dialogTargets: selected, mutation } = batch
  const prefix = `questionList.batch.dialog.${batch.dialogAction}` as const
  const count = formatNumber(selected.length, locale)
  const confirmLabel = t(`${prefix}.confirm`, { count })
  const code = questionErrorCode(mutation.error)
  const rest = selected.length - LISTED_IDS
  const confirmButton = useRef<HTMLButtonElement>(null)
  const errorAlert = useRef<HTMLParagraphElement>(null)
  const needsReauth = code === 'FRESH_ASSURANCE_REQUIRED'
  const showError = mutation.isError && !needsReauth
  useEffect(() => {
    if (showError) errorAlert.current?.focus()
  }, [showError])
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
          {needsReauth ? (
            <ReauthDialogButton reauth={reauth} keep={batch.keepSelection} />
          ) : (
            /* aria-disabled, not disabled: focus stays on the button while sending. */
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
          )}
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
      {needsReauth ? (
        <ReauthRequiredNotice
          command={confirmLabel}
          keeps="selection"
          reauth={reauth}
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
