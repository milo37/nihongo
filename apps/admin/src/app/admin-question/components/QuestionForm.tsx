import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useBlocker } from 'react-router'
import type { FieldErrors } from 'react-hook-form'
import type { ReactElement } from 'react'
import type { CreateAdminQuestionRequest } from '@api/admin-question/createAdminQuestion/schema'
import {
  createAdminQuestionRequestSchema,
  updateQuestionVersionRequestSchema,
  type PreviewQuestionVersionResponse,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/content-operations'

import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import {
  QuestionClassificationSection,
  QuestionContentSection,
  QuestionExplanationSection,
  type QuestionFormFields
} from '@app/admin-question/components/QuestionFormSections'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import {
  createDefaultValues,
  questionFormSchema,
  toCreateContent,
  VALIDATION_KEY_PREFIX,
  type QuestionFormValues
} from '@app/admin-question/components/questionFormSchema'

type QuestionFormProps = {
  initialQuestion?: PreviewQuestionVersionResponse
  expectedRowVersion?: number
  readOnly?: boolean
  isSubmitting: boolean
  onSubmit: (
    input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
  ) => Promise<void>
  submitLabel: string
  submittingLabel: string
  cancelHref?: string
  serverError?: string
}

export const QuestionForm = ({
  cancelHref = '/questions',
  initialQuestion,
  expectedRowVersion,
  readOnly = false,
  isSubmitting,
  onSubmit,
  serverError,
  submitLabel,
  submittingLabel
}: QuestionFormProps): ReactElement => {
  const { t } = useAdminPresentation()
  // Contract checks without a form key carry raw (often English) text; show
  // the common validation message instead.
  const localError = (message: string | undefined): string | undefined => {
    if (!message) return message
    return t(
      message.startsWith(VALIDATION_KEY_PREFIX)
        ? message
        : `${VALIDATION_KEY_PREFIX}invalid`
    )
  }
  const [revision] = useState(expectedRowVersion)
  const [defaultValues] = useState(() => createDefaultValues(initialQuestion))
  const {
    control,
    formState: { errors, isDirty, isSubmitting: isFormSubmitting },
    handleSubmit,
    register,
    setFocus,
    setValue
  } = useForm<QuestionFormValues>({
    defaultValues,
    resolver: zodResolver(questionFormSchema),
    shouldFocusError: true
  })
  const subject = useWatch({ control, name: 'subject' })
  const correctOptionId = useWatch({ control, name: 'correctOptionId' })
  const fields: QuestionFormFields = {
    register,
    errors,
    localError,
    setValue,
    subject,
    correctOptionId
  }
  const shouldBlockNavigation = isDirty && !isSubmitting && !isFormSubmitting
  const blocker = useBlocker(shouldBlockNavigation)

  useEffect(() => {
    if (!shouldBlockNavigation) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [shouldBlockNavigation])

  const handleInvalidSubmit = (
    formErrors: FieldErrors<QuestionFormValues>
  ): void => {
    if (formErrors.options?.root) {
      setFocus('options.0.text')
      return
    }

    if (formErrors.correctOptionId) {
      document
        .getElementById('correct-answer-group')
        ?.querySelector<HTMLInputElement>('input[type="radio"]')
        ?.focus()
    }
  }

  // On mobile the alert sits above the fold; move focus (and the view) to it.
  const serverErrorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (serverError) serverErrorRef.current?.focus()
  }, [serverError])

  const submitForm = handleSubmit(async (values) => {
    if (readOnly) return
    const content = toCreateContent(values)
    if (initialQuestion) {
      const { options: _options, correctOptionKey: _correct, ...rest } = content
      const request = updateQuestionVersionRequestSchema.parse({
        ...rest,
        expectedRowVersion: revision,
        options: values.options.map((option, index) => ({
          id: option.id,
          ordinal: index + 1,
          text: option.text
        })),
        correctOptionId: values.options.find(
          (option) => option.label === values.correctOptionId
        )?.id
      })
      await onSubmit(request)
    } else {
      await onSubmit(createAdminQuestionRequestSchema.parse(content))
    }
  }, handleInvalidSubmit)

  return (
    <>
      <form
        className="grid gap-8"
        aria-busy={isSubmitting || isFormSubmitting}
        noValidate
        onSubmit={(event) => void submitForm(event)}
      >
        {serverError ? (
          <div
            ref={serverErrorRef}
            tabIndex={-1}
            className="scroll-mt-24 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            role="alert"
          >
            {serverError}
          </div>
        ) : null}

        <fieldset
          className="grid gap-8"
          disabled={readOnly || isSubmitting || isFormSubmitting}
        >
          <legend className="sr-only">
            {t('editor.form.screenReaderLegend')}
          </legend>
          <QuestionClassificationSection fields={fields} />
          <QuestionContentSection fields={fields} />
          <QuestionExplanationSection fields={fields} />
        </fieldset>

        <div className="sticky bottom-0 z-20 -mx-4 flex flex-col-reverse gap-3 border-t border-line bg-white/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:rounded-xl sm:border sm:px-5">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            to={cancelHref}
          >
            {t('editor.form.returnToList')}
          </Link>
          <Button
            type="submit"
            disabled={readOnly}
            isLoading={isSubmitting || isFormSubmitting}
            loadingLabel={submittingLabel}
          >
            {submitLabel}
          </Button>
        </div>
      </form>

      <Dialog
        open={blocker.state === 'blocked'}
        title={t('editor.form.leaveTitle')}
        description={t('editor.form.leaveDescription')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (blocker.state === 'blocked') {
                  blocker.reset()
                }
              }}
            >
              {t('editor.form.keepEditing')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (blocker.state === 'blocked') {
                  blocker.proceed()
                }
              }}
            >
              {t('editor.form.discard')}
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') {
            blocker.reset()
          }
        }}
      />
    </>
  )
}
