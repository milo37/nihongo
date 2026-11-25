import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { CreateReportRequest } from '@nihongo/contracts/report/reports'
import { useReportPresentation } from '@app/question-report/useReportPresentation'
import { isAccountRestrictedApiError, isUiApiError } from '@libs/apiError'
import { useCreateReport } from '@app/question-report/hooks/useCreateReport'
import { useToast } from '@nihongo/browser/common/components/Toast'

type ReportDialogFormOptions = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmitted?: () => void
  readonly submittedMessage: string
  readonly errorMessage: string
  readonly toRequest: (description: string) => CreateReportRequest
}

/**
 * The report form's description, send and errors. Input survives a failed
 * send; a previous attempt's error does not reappear when the dialog
 * reopens; an error moves focus to the field it names or to [보내기].
 */
export const useReportDialogForm = ({
  open,
  onOpenChange,
  onSubmitted,
  submittedMessage,
  errorMessage: fallbackError,
  toRequest
}: ReportDialogFormOptions) => {
  // Left uncompiled: its caller is compiled and caches what it reads, and
  // compiling the hook too adds a second cache (#1174 bundle).
  'use no memo'
  const { presentError, presentFieldError, t } = useReportPresentation()
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
  const { addToast } = useToast()
  const mutation = useCreateReport(() => {
    onOpenChange(false)
    setDescription('')
    // The dialog closes, so success is a toast.
    addToast({ key: 'report', title: submittedMessage, variant: 'success' })
    onSubmitted?.()
  })

  const visibleError = submittedSinceOpen ? mutation.error : null
  const isRestricted = isAccountRestrictedApiError(visibleError)
  const errorMessage = visibleError
    ? isUiApiError(visibleError)
      ? visibleError.isOffline
        ? t('questionReportDialog.offline')
        : presentError(visibleError, fallbackError)
      : fallbackError
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

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (mutation.isPending) return
    if (description.trim().length === 0) {
      setDescriptionRequired(true)
      descriptionRef.current?.focus()
      return
    }
    setSubmittedSinceOpen(true)
    mutation.mutate(toRequest(description))
  }

  const changeDescription = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setDescription(event.currentTarget.value)
    if (event.currentTarget.value.trim()) {
      setDescriptionRequired(false)
    }
  }

  return {
    t,
    description,
    descriptionError: descriptionRequired
      ? t('questionReportDialog.descriptionRequired')
      : presentFieldError(fieldErrors?.description),
    descriptionRef,
    submitRef,
    isPending: mutation.isPending,
    isRestricted,
    // A field error shows under its field instead.
    formError:
      errorMessage && !fieldErrors?.description?.length ? errorMessage : null,
    submit,
    changeDescription
  }
}
