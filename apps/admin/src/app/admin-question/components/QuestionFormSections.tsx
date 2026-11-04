import type { ReactElement } from 'react'
import type {
  FieldErrors,
  UseFormRegister,
  UseFormSetValue
} from 'react-hook-form'
import {
  LEVELS,
  OPTION_LABELS,
  QUESTION_DIFFICULTIES,
  QUESTION_TYPES,
  SUBJECTS
} from '@nihongo/browser/common/types/domain'
import { Input } from '@nihongo/browser/common/components/Input'
import { RadioGroup } from '@nihongo/browser/common/components/RadioGroup'
import { Select } from '@nihongo/browser/common/components/Select'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import type { QuestionFormValues } from '@app/admin-question/components/questionFormSchema'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export type QuestionFormFields = {
  register: UseFormRegister<QuestionFormValues>
  errors: FieldErrors<QuestionFormValues>
  localError: (message: string | undefined) => string | undefined
  setValue: UseFormSetValue<QuestionFormValues>
  subject: QuestionFormValues['subject']
  correctOptionId: string
}

/** Level, subject, question type and difficulty selects. */
export const QuestionClassificationSection = ({
  fields
}: {
  fields: QuestionFormFields
}): ReactElement => {
  const { t } = useAdminPresentation()
  const { register, errors, localError } = fields
  return (
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
  )
}

/** Passage, question text, four options and the correct option. */
export const QuestionContentSection = ({
  fields
}: {
  fields: QuestionFormFields
}): ReactElement => {
  const { t } = useAdminPresentation()
  const { register, errors, localError, subject, correctOptionId, setValue } =
    fields
  return (
    <section
      className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-7"
      aria-labelledby="question-content"
    >
      <div className="border-b border-line pb-5">
        <h2 className="text-balance text-xl font-bold" id="question-content">
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
                <input type="hidden" {...register(`options.${index}.id`)} />
                <input
                  type="hidden"
                  value={label}
                  {...register(`options.${index}.label`)}
                />
                <Input
                  label={t('editor.optionLabel', { number: label })}
                  error={localError(errors.options?.[index]?.text?.message)}
                  placeholder={t('editor.form.optionPlaceholder', {
                    number: label
                  })}
                  {...register(`options.${index}.text`)}
                />
              </div>
            ))}
          </div>
          {errors.options?.root?.message ? (
            <p className="mt-3 text-sm font-medium text-red-700" role="alert">
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
  )
}

/** Korean and Japanese explanations and tags. */
export const QuestionExplanationSection = ({
  fields
}: {
  fields: QuestionFormFields
}): ReactElement => {
  const { t } = useAdminPresentation()
  const { register, errors, localError } = fields
  return (
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
  )
}
