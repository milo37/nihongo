import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { CreateQuestionReportRequest } from '@nihongo/contracts/admin/phase7'
import { adminReportReasonKey } from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { isPhase7UiApiError } from '@app/admin-question/hooks/usePhase7AdminMutations'
import { useCreatePhase7QuestionReport } from '@app/question-report/hooks/useCreatePhase7QuestionReport'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { Select } from '@common/components/Select'
import { Textarea } from '@common/components/Textarea'

const reasons = [
  'ANSWER_ERROR',
  'EXPLANATION_ERROR',
  'TYPO_OR_GRAMMAR',
  'AMBIGUOUS',
  'LEVEL_OR_TAXONOMY',
  'OTHER'
] as const

interface QuestionReportDialogProps {
  readonly questionId: string
  readonly questionVersionId: string
}

export const QuestionReportDialog = ({
  questionId,
  questionVersionId
}: QuestionReportDialogProps): ReactElement => {
  const { presentError, presentFieldError, t } = useAdminPresentation()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const reasonRef = useRef<HTMLSelectElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] =
    useState<CreateQuestionReportRequest['reason']>('OTHER')
  const [description, setDescription] = useState('')
  const [wasSubmitted, setWasSubmitted] = useState(false)
  const mutation = useCreatePhase7QuestionReport(() => {
    setOpen(false)
    setDescription('')
    setWasSubmitted(true)
  })

  const errorMessage = mutation.error
    ? isPhase7UiApiError(mutation.error)
      ? mutation.error.isOffline
        ? t('questionReportDialog.offline')
        : presentError(mutation.error)
      : t('questionReportDialog.error')
    : null
  const fieldErrors =
    mutation.error && isPhase7UiApiError(mutation.error)
      ? mutation.error.fieldErrors
      : undefined

  useEffect(() => {
    if (!mutation.error) return
    if (fieldErrors?.reason?.length) reasonRef.current?.focus()
    else if (fieldErrors?.description?.length) descriptionRef.current?.focus()
    else submitRef.current?.focus()
  }, [fieldErrors, mutation.error])

  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        variant="outline"
        onClick={() => {
          mutation.reset()
          setWasSubmitted(false)
          setOpen(true)
        }}
      >
        {t('questionReportDialog.trigger')}
      </Button>
      <Dialog
        initialFocusRef={descriptionRef}
        open={open}
        preventClose={mutation.isPending}
        returnFocusRef={triggerRef}
        title={t('questionReportDialog.title')}
        description={t('questionReportDialog.description')}
        onOpenChange={(nextOpen) => {
          if (!mutation.isPending) setOpen(nextOpen)
        }}
      >
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (mutation.isPending) return
            mutation.mutate({
              questionId,
              request: { questionVersionId, reason, description }
            })
          }}
        >
          <Select
            ref={reasonRef}
            disabled={mutation.isPending}
            error={presentFieldError(fieldErrors?.reason)}
            label={t('questionReportDialog.reason')}
            name="report-reason"
            value={reason}
            onChange={(event) =>
              setReason(
                event.currentTarget
                  .value as CreateQuestionReportRequest['reason']
              )
            }
          >
            {reasons.map((item) => (
              <option key={item} value={item}>
                {t(adminReportReasonKey[item])}
              </option>
            ))}
          </Select>
          <Textarea
            ref={descriptionRef}
            disabled={mutation.isPending}
            error={presentFieldError(fieldErrors?.description)}
            label={t('questionReportDialog.details')}
            maxLength={2000}
            name="report-description"
            required
            rows={6}
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
          {errorMessage && !fieldErrors?.description?.length ? (
            <p className="font-semibold text-red-700" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              disabled={mutation.isPending}
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t('questionReportDialog.cancel')}
            </Button>
            <Button
              ref={submitRef}
              disabled={mutation.isPending || description.trim().length === 0}
              isLoading={mutation.isPending}
              type="submit"
            >
              {t('questionReportDialog.submit')}
            </Button>
          </div>
        </form>
      </Dialog>
      <p className="sr-only" aria-live="polite">
        {wasSubmitted ? t('questionReportDialog.submitted') : ''}
      </p>
    </>
  )
}
