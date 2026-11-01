import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useBlocker } from 'react-router'
import { z } from 'zod'
import type { FieldErrors } from 'react-hook-form'
import type { ReactElement } from 'react'
import type { CreateAdminQuestionRequest } from '@nihongo/browser/api/admin-question/createAdminQuestion/schema'
import {
  createAdminQuestionRequestSchema,
  countUnicodeScalars,
  isWellFormedPhase7Text,
  normalizePhase7Text,
  updateQuestionVersionRequestSchema,
  type PreviewQuestionVersionResponse,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/content-operations'
import {
  LEVELS,
  OPTION_LABELS,
  QUESTION_DIFFICULTIES,
  QUESTION_TYPES,
  SUBJECTS
} from '@nihongo/browser/common/types/domain'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { Input } from '@nihongo/browser/common/components/Input'
import { RadioGroup } from '@nihongo/browser/common/components/RadioGroup'
import { Select } from '@nihongo/browser/common/components/Select'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

const TAG_SEPARATOR_REGEX = /[,，\n]/
const OPTION_LABEL_SET: ReadonlySet<string> = new Set(OPTION_LABELS)

const localValidationKeys = new Map<string, string>([
  ['급수를 선택해 주세요.', 'editor.form.validation.level'],
  ['과목을 선택해 주세요.', 'editor.form.validation.subject'],
  ['문제 유형을 선택해 주세요.', 'editor.form.validation.questionType'],
  ['난이도를 선택해 주세요.', 'editor.form.validation.difficulty'],
  ['질문을 입력해 주세요.', 'editor.form.validation.question'],
  [
    'editor.form.validation.questionLength',
    'editor.form.validation.questionLength'
  ],
  ['독해 문제는 지문을 입력해 주세요.', 'editor.form.validation.passage'],
  ['보기 내용을 입력해 주세요.', 'editor.form.validation.option'],
  ['보기는 정확히 4개여야 합니다.', 'editor.form.validation.optionCount'],
  [
    '동일한 보기를 중복해서 입력할 수 없습니다.',
    'editor.form.validation.optionDuplicate'
  ],
  [
    '정답은 보기 중 정확히 하나를 선택해 주세요.',
    'editor.form.validation.correct'
  ],
  ['한국어 해설을 입력해 주세요.', 'editor.form.validation.explanationKo'],
  ['태그를 1개 이상 입력해 주세요.', 'editor.form.validation.tags']
])

const formOptionSchema = z
  .object({
    id: z.string().optional(),
    label: z.enum(OPTION_LABELS),
    text: z.string().trim().min(1, '보기 내용을 입력해 주세요.')
  })
  .strict()

export const questionFormSchema = z
  .object({
    level: z.enum(LEVELS, { error: '급수를 선택해 주세요.' }),
    subject: z.enum(SUBJECTS, { error: '과목을 선택해 주세요.' }),
    questionType: z.enum(QUESTION_TYPES, {
      error: '문제 유형을 선택해 주세요.'
    }),
    passage: z.string(),
    questionText: z.string().trim().min(1, '질문을 입력해 주세요.'),
    options: z
      .array(formOptionSchema)
      .length(4, '보기는 정확히 4개여야 합니다.'),
    correctOptionId: z
      .string()
      .refine(
        (value) => OPTION_LABEL_SET.has(value),
        '정답은 보기 중 정확히 하나를 선택해 주세요.'
      ),
    explanationKo: z.string().trim().min(1, '한국어 해설을 입력해 주세요.'),
    explanationJa: z.string(),
    difficulty: z.enum(QUESTION_DIFFICULTIES, {
      error: '난이도를 선택해 주세요.'
    }),
    tagsText: z.string().refine((value) => {
      return value
        .split(TAG_SEPARATOR_REGEX)
        .some((tag) => tag.trim().length > 0)
    }, '태그를 1개 이상 입력해 주세요.')
  })
  .strict()
  .superRefine((value, context) => {
    if (value.subject === 'READING' && value.passage.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['passage'],
        message: '독해 문제는 지문을 입력해 주세요.'
      })
    }

    const canonical = createAdminQuestionRequestSchema.safeParse(
      toCreateContent(value)
    )
    if (!canonical.success) {
      for (const issue of canonical.error.issues) {
        const field =
          issue.path[0] === 'tagNames'
            ? 'tagsText'
            : issue.path[0] === 'correctOptionKey'
              ? 'correctOptionId'
              : issue.path[0]
        context.addIssue({
          code: 'custom',
          path:
            field === undefined
              ? []
              : field === 'tagsText'
                ? ['tagsText']
                : [field, ...issue.path.slice(1)],
          message:
            issue.code === 'custom' &&
            issue.path.length === 1 &&
            issue.path[0] === 'questionText' &&
            canonical.error.issues.filter(
              (candidate) =>
                candidate.path.length === 1 &&
                candidate.path[0] === 'questionText'
            ).length === 1 &&
            isWellFormedPhase7Text(value.questionText) &&
            countUnicodeScalars(normalizePhase7Text(value.questionText)) > 2000
              ? 'editor.form.validation.questionLength'
              : issue.message
        })
      }
    }

    const normalizedOptions = value.options
      .map((option) => option.text.trim())
      .filter((option) => option.length > 0)

    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      context.addIssue({
        code: 'custom',
        path: ['options', 'root'],
        message: '동일한 보기를 중복해서 입력할 수 없습니다.'
      })
    }
  })

export type QuestionFormValues = z.infer<typeof questionFormSchema>

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

const parseTags = (value: string): string[] => {
  const tags: string[] = []
  const seenTags = new Set<string>()

  for (const rawTag of value.split(TAG_SEPARATOR_REGEX)) {
    const tag = rawTag.trim()

    if (tag.length === 0 || seenTags.has(tag)) {
      continue
    }

    seenTags.add(tag)
    tags.push(tag)
  }

  return tags
}

const createDefaultValues = (
  preview?: PreviewQuestionVersionResponse
): QuestionFormValues => {
  const question = preview?.question
  if (!question) {
    return {
      level: 'N3',
      subject: 'GRAMMAR',
      questionType: 'GRAMMAR_SELECT',
      passage: '',
      questionText: '',
      options: OPTION_LABELS.map((label) => ({
        label,
        text: ''
      })),
      correctOptionId: '',
      explanationKo: '',
      explanationJa: '',
      difficulty: 'NORMAL',
      tagsText: ''
    }
  }

  const optionByLabel = new Map(
    question.options.map((option) => [option.label, option])
  )
  const correctOption = question.options.find(
    (option) => option.id === preview?.adminAnswer.correctOptionId
  )

  return {
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    passage: question.passage ?? '',
    questionText: question.questionText,
    options: OPTION_LABELS.map((label) => {
      const option = optionByLabel.get(label)

      return {
        id: option?.id,
        label,
        text: option?.text ?? ''
      }
    }),
    correctOptionId: correctOption?.label ?? '',
    explanationKo: preview?.adminAnswer.explanationKo ?? '',
    explanationJa: preview?.adminAnswer.explanationJa ?? '',
    difficulty: question.difficulty,
    tagsText: question.tags.map((tag) => tag.label).join(', ')
  }
}

const toCreateContent = (
  values: QuestionFormValues
): CreateAdminQuestionRequest => ({
  level: values.level,
  subject: values.subject,
  questionType: values.questionType,
  passage: values.passage.trim() || null,
  questionText: values.questionText,
  options: values.options.map((option) => ({
    clientOptionKey: option.label,
    text: option.text
  })),
  correctOptionKey: values.correctOptionId,
  explanationKo: values.explanationKo,
  explanationJa: values.explanationJa.trim() || null,
  difficulty: values.difficulty,
  tagNames: parseTags(values.tagsText)
})

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
  const localError = (message: string | undefined): string | undefined => {
    if (!message) return message
    const key = localValidationKeys.get(message)
    return key ? t(key) : message
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
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
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
          <section
            className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-7"
            aria-labelledby="question-basic-information"
          >
            <div className="border-b border-line pb-5">
              <h2
                className="text-balance text-xl font-bold"
                id="question-basic-information"
              >
                {t('editor.form.basicTitle')}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                {t('editor.form.basicDescription')}
              </p>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label={t('editor.level')}
                error={localError(errors.level?.message)}
                options={LEVELS.map((level) => ({
                  value: level,
                  label: level
                }))}
                {...register('level')}
              />
              <Select
                label={t('editor.subject')}
                error={localError(errors.subject?.message)}
                options={SUBJECTS.map((value) => ({
                  value,
                  label: t(`enums.subjects.${value}`)
                }))}
                {...register('subject')}
              />
              <Select
                label={t('editor.questionType')}
                error={localError(errors.questionType?.message)}
                options={QUESTION_TYPES.map((value) => ({
                  value,
                  label: t(`enums.questionTypes.${value}`)
                }))}
                {...register('questionType')}
              />
              <Select
                label={t('editor.difficulty')}
                error={localError(errors.difficulty?.message)}
                options={QUESTION_DIFFICULTIES.map((value) => ({
                  value,
                  label: t(`enums.difficulties.${value}`)
                }))}
                {...register('difficulty')}
              />
              <div className="rounded-lg border border-line bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-ink">
                  {t('editor.form.sourceTitle')}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {t('editor.form.sourceDescription')}
                </p>
              </div>
            </div>
          </section>

          <section
            className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-7"
            aria-labelledby="question-content"
          >
            <div className="border-b border-line pb-5">
              <h2
                className="text-balance text-xl font-bold"
                id="question-content"
              >
                {t('editor.form.contentTitle')}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                {t('editor.form.contentDescription')}
              </p>
            </div>

            <div className="mt-6 grid gap-6">
              <Textarea
                label={t(
                  subject === 'READING'
                    ? 'editor.form.passageRequired'
                    : 'editor.form.passageOptional'
                )}
                hint={t('editor.form.passageHint')}
                error={localError(errors.passage?.message)}
                rows={7}
                placeholder={t('editor.form.passagePlaceholder')}
                {...register('passage')}
              />
              <Textarea
                label={t('editor.questionText')}
                error={localError(errors.questionText?.message)}
                rows={4}
                placeholder={t('editor.form.questionPlaceholder')}
                {...register('questionText')}
              />

              <div>
                <h3 className="text-base font-bold">
                  {t('editor.form.optionsTitle')}
                </h3>
                <p className="mt-1 text-sm leading-6 text-muted">
                  {t('editor.form.optionsHint')}
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {OPTION_LABELS.map((label, index) => (
                    <div key={label}>
                      <input
                        type="hidden"
                        {...register(`options.${index}.id`)}
                      />
                      <input
                        type="hidden"
                        value={label}
                        {...register(`options.${index}.label`)}
                      />
                      <Input
                        label={t('editor.optionLabel', { number: label })}
                        error={localError(
                          errors.options?.[index]?.text?.message
                        )}
                        placeholder={t('editor.form.optionPlaceholder', {
                          number: label
                        })}
                        {...register(`options.${index}.text`)}
                      />
                    </div>
                  ))}
                </div>
                {errors.options?.root?.message ? (
                  <p
                    className="mt-3 text-sm font-medium text-red-700"
                    role="alert"
                  >
                    {localError(errors.options.root.message)}
                  </p>
                ) : null}
              </div>

              <div id="correct-answer-group">
                <input type="hidden" {...register('correctOptionId')} />
                <RadioGroup
                  name="correct-answer"
                  legend={t('editor.form.correctAnswer')}
                  value={correctOptionId}
                  error={localError(errors.correctOptionId?.message)}
                  orientation="horizontal"
                  options={OPTION_LABELS.map((label) => ({
                    value: label,
                    label: t('editor.optionLabel', { number: label })
                  }))}
                  onValueChange={(value) => {
                    setValue('correctOptionId', value, {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: true
                    })
                  }}
                />
              </div>
            </div>
          </section>

          <section
            className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-7"
            aria-labelledby="question-explanation"
          >
            <div className="border-b border-line pb-5">
              <h2
                className="text-balance text-xl font-bold"
                id="question-explanation"
              >
                {t('editor.explanationLegend')}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                {t('editor.form.explanationDescription')}
              </p>
            </div>

            <div className="mt-6 grid gap-6">
              <Textarea
                label={t('editor.explanationKo')}
                error={localError(errors.explanationKo?.message)}
                rows={6}
                placeholder={t('editor.form.explanationKoPlaceholder')}
                {...register('explanationKo')}
              />
              <Textarea
                label={t('editor.form.explanationJaOptional')}
                error={localError(errors.explanationJa?.message)}
                rows={5}
                placeholder={t('editor.form.explanationJaPlaceholder')}
                {...register('explanationJa')}
              />
              <Textarea
                label={t('editor.fields.tagNames')}
                hint={t('editor.tagTextHint')}
                error={localError(errors.tagsText?.message)}
                placeholder={t('editor.form.tagPlaceholder')}
                {...register('tagsText')}
              />
            </div>
          </section>
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
