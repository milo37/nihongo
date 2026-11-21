import type { ReactElement, RefObject } from 'react'
import type { CreateReportRequest } from '@nihongo/contracts/report/reports'
import { AccountRestrictedNotice } from '@common/components/AccountRestrictedNotice'
import { useReportDialogForm } from '@app/question-report/hooks/useReportDialogForm'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { Textarea } from '@nihongo/browser/common/components/Textarea'

export type ReportDialogCopy = {
  readonly title: string
  readonly description: string
  readonly submitted: string
  readonly error: string
}

interface ReportDialogProps {
  readonly copy: ReportDialogCopy
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmitted?: () => void
  /** Builds the request from the description; location is app-owned. */
  readonly toRequest: (description: string) => CreateReportRequest
  readonly returnFocusRef?: RefObject<HTMLElement | null>
}

/** Shared description-only report form (state: useReportDialogForm). */
export const ReportDialog = ({
  copy,
  open,
  onOpenChange,
  onSubmitted,
  toRequest,
  returnFocusRef
}: ReportDialogProps): ReactElement => {
  const {
    t,
    description,
    descriptionError,
    descriptionRef,
    submitRef,
    isPending,
    isRestricted,
    formError,
    submit,
    changeDescription
  } = useReportDialogForm({
    open,
    onOpenChange,
    onSubmitted,
    submittedMessage: copy.submitted,
    errorMessage: copy.error,
    toRequest
  })
  return (
    <Dialog
      initialFocusRef={descriptionRef}
      open={open}
      preventClose={isPending}
      returnFocusRef={returnFocusRef}
      title={copy.title}
      description={copy.description}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen)
      }}
    >
      <form className="grid gap-5" noValidate onSubmit={submit}>
        <Textarea
          ref={descriptionRef}
          disabled={isPending}
          error={descriptionError}
          label={t('questionReportDialog.details')}
          // UTF-16 units never undercount the contract's 1,000 scalars.
          maxLength={1000}
          name="report-description"
          required
          rows={6}
          value={description}
          onChange={changeDescription}
        />
        {isRestricted ? (
          <AccountRestrictedNotice />
        ) : formError ? (
          <p className="font-semibold text-red-700" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            disabled={isPending}
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('questionReportDialog.cancel')}
          </Button>
          <Button
            ref={submitRef}
            disabled={isPending}
            isLoading={isPending}
            type="submit"
          >
            {t('questionReportDialog.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
