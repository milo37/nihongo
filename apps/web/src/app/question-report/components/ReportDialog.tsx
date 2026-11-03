import { useEffect, useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import type { CreateReportRequest } from '@nihongo/contracts/report/reports'
import { useQuestionReportPresentation as useAdminPresentation } from '@app/content-operations/reports/questionReportPublic'
import { isAccountRestrictedApiError, isUiApiError } from '@libs/apiError'
import { AccountRestrictedNotice } from '@common/components/AccountRestrictedNotice'
import { useCreateReport } from '@app/question-report/hooks/useCreateReport'
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
  readonly onSubmitted: () => void
  /** Builds the request from the description; location is app-owned. */
  readonly toRequest: (description: string) => CreateReportRequest
  readonly returnFocusRef?: RefObject<HTMLElement | null>
}

/** Shared description-only report form; input survives a failed send. */
export const ReportDialog = ({
  copy,
  open,
  onOpenChange,
  onSubmitted,
  toRequest,
  returnFocusRef
}: ReportDialogProps): ReactElement => {
  const { presentError, presentFieldError, t } = useAdminPresentation()
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const [description, setDescription] = useState('')
  const [descriptionRequired, setDescriptionRequired] = useState(false)
  // A previous attempt's error must not reappear when the dialog reopens.
  const [submittedSinceOpen, setSubmittedSinceOpen] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSubmittedSinceOpen(false)
      setDescriptionRequired(false)
    }
  }
  const mutation = useCreateReport(() => {
    onOpenChange(false)
    setDescription('')
    onSubmitted()
  })

  const visibleError = submittedSinceOpen ? mutation.error : null
  const isRestricted = isAccountRestrictedApiError(visibleError)
  const errorMessage = visibleError
    ? isUiApiError(visibleError)
      ? visibleError.isOffline
        ? t('questionReportDialog.offline')
        : presentError(visibleError)
      : copy.error
    : null
  const fieldErrors =
    visibleError && isUiApiError(visibleError)
      ? visibleError.fieldErrors
      : undefined

  useEffect(() => {
    if (!visibleError) return
    if (fieldErrors?.description?.length) descriptionRef.current?.focus()
    else submitRef.current?.focus()
  }, [fieldErrors, visibleError])

  return (
    <Dialog
      initialFocusRef={descriptionRef}
      open={open}
      preventClose={mutation.isPending}
      returnFocusRef={returnFocusRef}
      title={copy.title}
      description={copy.description}
      onOpenChange={(nextOpen) => {
        if (!mutation.isPending) onOpenChange(nextOpen)
      }}
    >
      <form
        className="grid gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (mutation.isPending) return
          if (description.trim().length === 0) {
            setDescriptionRequired(true)
            descriptionRef.current?.focus()
            return
          }
          setSubmittedSinceOpen(true)
          mutation.mutate(toRequest(description))
        }}
      >
        <Textarea
          ref={descriptionRef}
          disabled={mutation.isPending}
          error={
            descriptionRequired
              ? t('questionReportDialog.descriptionRequired')
              : presentFieldError(fieldErrors?.description)
          }
          label={t('questionReportDialog.details')}
          // UTF-16 units never undercount the contract's 1,000 scalars.
          maxLength={1000}
          name="report-description"
          required
          rows={6}
          value={description}
          onChange={(event) => {
            setDescription(event.currentTarget.value)
            if (event.currentTarget.value.trim()) {
              setDescriptionRequired(false)
            }
          }}
        />
        {isRestricted ? (
          <AccountRestrictedNotice />
        ) : errorMessage && !fieldErrors?.description?.length ? (
          <p className="font-semibold text-red-700" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            disabled={mutation.isPending}
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('questionReportDialog.cancel')}
          </Button>
          <Button
            ref={submitRef}
            disabled={mutation.isPending}
            isLoading={mutation.isPending}
            type="submit"
          >
            {t('questionReportDialog.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
