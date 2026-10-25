import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  updateQuestionVersionRequestSchema,
  type PreviewQuestionVersionResponse,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { Button } from '@nihongo/browser/common/components/Button'
import { Input } from '@nihongo/browser/common/components/Input'
import { Select } from '@nihongo/browser/common/components/Select'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { editorInput } from '@app/admin-question/detail/questionWorkflow'
const subjects = ['VOCABULARY', 'GRAMMAR', 'READING'] as const
const types = [
  'KANJI_READING',
  'ORTHOGRAPHY',
  'CONTEXT_VOCABULARY',
  'PARAPHRASE',
  'WORD_USAGE',
  'GRAMMAR_SELECT',
  'SENTENCE_ORDER',
  'TEXT_GRAMMAR',
  'SHORT_READING',
  'MEDIUM_READING',
  'LONG_READING',
  'INFO_RETRIEVAL'
] as const
const fields = [
  'level',
  'subject',
  'questionType',
  'difficulty',
  'questionText',
  'passage',
  'options',
  'correctOptionId',
  'explanationKo',
  'explanationJa',
  'tagNames'
] as const
const fieldKeys = {
  level: 'level',
  subject: 'subject',
  questionType: 'questionType',
  difficulty: 'difficulty',
  questionText: 'questionText',
  passage: 'passage',
  options: 'options',
  correctOptionId: 'correctIdentity',
  explanationKo: 'explanationKo',
  explanationJa: 'explanationJa',
  tagNames: 'tagNames'
} as const
export const QuestionVersionEditor = ({
  preview,
  rowVersion,
  disabled,
  isSubmitting,
  conflictRevision,
  serverFieldErrors,
  onDirtyChange,
  onSubmit
}: {
  preview: PreviewQuestionVersionResponse
  rowVersion: number
  disabled: boolean
  isSubmitting: boolean
  conflictRevision: number
  serverFieldErrors: Readonly<Record<string, readonly string[]>>
  onDirtyChange: (dirty: boolean) => void
  onSubmit: (input: UpdateQuestionVersionRequest) => Promise<boolean>
}): ReactElement => {
  const { t } = useAdminPresentation()
  const {
    control,
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    setFocus,
    formState: { isDirty, errors }
  } = useForm<UpdateQuestionVersionRequest>({
    defaultValues: editorInput(preview, rowVersion),
    resolver: zodResolver(updateQuestionVersionRequestSchema)
  })
  const { fields: options, move } = useFieldArray({
    control,
    name: 'options',
    keyName: 'fieldKey'
  })
  const [acceptedConflict, setAcceptedConflict] = useState(conflictRevision)
  const [announcement, setAnnouncement] = useState('')
  const values = useWatch({ control })
  const acceptedRow = values.expectedRowVersion ?? rowVersion
  const rebasePending = isDirty && acceptedRow !== rowVersion
  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])
  useEffect(() => {
    if (!isDirty && acceptedRow !== rowVersion) {
      reset(editorInput(preview, rowVersion))
    }
  }, [acceptedRow, isDirty, preview, reset, rowVersion])
  const invalid = (
    name: keyof UpdateQuestionVersionRequest
  ): string | undefined =>
    errors[name] ||
    Object.keys(serverFieldErrors).some(
      (path) => path === name || path.startsWith(name + '.')
    )
      ? t('errors.validation')
      : undefined
  const moveOption = (from: number, to: number): void => {
    if (to < 0 || to >= options.length || disabled) return
    move(from, to)
    const reordered = getValues('options').map((option, index) => ({
      ...option,
      ordinal: index + 1
    }))
    setValue('options', reordered, { shouldDirty: true })
    setFocus(`options.${to}.text`)
    setAnnouncement(t('editor.optionMoved', { from: from + 1, to: to + 1 }))
  }
  const latest = editorInput(preview, rowVersion)
  const changed = fields.filter(
    (field) => JSON.stringify(values[field]) !== JSON.stringify(latest[field])
  )
  return (
    <form
      className="grid gap-6"
      noValidate
      aria-busy={isSubmitting}
      onSubmit={(event) =>
        void handleSubmit(async (input) => {
          if (disabled || rebasePending) return
          if (await onSubmit(input)) {
            reset(input)
          }
        })(event)
      }
    >
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <fieldset className="grid gap-5" disabled={disabled || isSubmitting}>
        <legend className="mb-4 text-xl font-bold">
          {t('editor.classificationLegend')}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t('editor.level')}
            options={['N5', 'N4', 'N3', 'N2', 'N1'].map((value) => ({
              value,
              label: value
            }))}
            error={invalid('level')}
            {...register('level')}
          />
          <Select
            label={t('editor.subject')}
            options={subjects.map((value) => ({
              value,
              label: t(`enums.subjects.${value}`)
            }))}
            error={invalid('subject')}
            {...register('subject')}
          />
          <Select
            label={t('editor.questionType')}
            options={types.map((value) => ({
              value,
              label: t(`enums.questionTypes.${value}`)
            }))}
            error={invalid('questionType')}
            {...register('questionType')}
          />
          <Select
            label={t('editor.difficulty')}
            options={(['EASY', 'NORMAL', 'HARD'] as const).map((value) => ({
              value,
              label: t(`enums.difficulties.${value}`)
            }))}
            error={invalid('difficulty')}
            {...register('difficulty')}
          />
        </div>
        <Textarea
          label={t('editor.passage')}
          hint={t('editor.passageHint')}
          rows={5}
          error={invalid('passage')}
          {...register('passage', {
            setValueAs: (value: string) => value || null
          })}
        />
        <Textarea
          label={t('editor.questionText')}
          rows={3}
          error={invalid('questionText')}
          {...register('questionText')}
        />
      </fieldset>
      <fieldset className="grid gap-4" disabled={disabled || isSubmitting}>
        <legend className="mb-2 font-bold">{t('editor.optionsLegend')}</legend>
        <p className="text-sm text-muted">{t('editor.reorderHint')}</p>
        {options.map((option, index) => (
          <div
            key={option.fieldKey}
            className="grid gap-3 rounded-xl border border-line p-4"
          >
            <Input
              label={t('editor.optionLabel', { number: index + 1 })}
              error={
                errors.options || serverFieldErrors.options
                  ? t('errors.validation')
                  : undefined
              }
              {...register(`options.${index}.text`)}
              onKeyDown={(event) => {
                if (
                  event.altKey &&
                  ['ArrowUp', 'ArrowDown'].includes(event.key)
                ) {
                  event.preventDefault()
                  moveOption(index, index + (event.key === 'ArrowUp' ? -1 : 1))
                }
              }}
            />
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="radio"
                value={option.id}
                {...register('correctOptionId')}
              />
              {t('editor.correctOption', { number: index + 1 })}
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={index === 0}
                onClick={() => moveOption(index, index - 1)}
              >
                {t('editor.moveUp', { number: index + 1 })}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={index === options.length - 1}
                onClick={() => moveOption(index, index + 1)}
              >
                {t('editor.moveDown', { number: index + 1 })}
              </Button>
            </div>
          </div>
        ))}
        {invalid('correctOptionId') ? (
          <p role="alert">{invalid('correctOptionId')}</p>
        ) : null}
      </fieldset>
      <fieldset className="grid gap-4" disabled={disabled || isSubmitting}>
        <legend className="mb-2 font-bold">
          {t('editor.explanationLegend')}
        </legend>
        <Textarea
          label={t('editor.explanationKo')}
          rows={4}
          error={invalid('explanationKo')}
          {...register('explanationKo')}
        />
        <Textarea
          label={t('editor.explanationJa')}
          rows={4}
          error={invalid('explanationJa')}
          {...register('explanationJa', {
            setValueAs: (value: string) => value || null
          })}
        />
        <Input
          name="tagNames"
          label={t('editor.selectedTags')}
          key={acceptedRow}
          defaultValue={(values.tagNames ?? []).join(', ')}
          error={invalid('tagNames')}
          onChange={(event) =>
            setValue(
              'tagNames',
              event.target.value
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
              { shouldDirty: true }
            )
          }
        />
      </fieldset>
      {rebasePending ? (
        <section
          className="rounded-xl border border-line p-4"
          aria-labelledby="rebase-title"
        >
          <h3 id="rebase-title" className="font-bold">
            {t('editor.conflictTitle')}
          </h3>
          <p>{t('editor.conflictDescription')}</p>
          <ul>
            {(changed.length ? changed : []).map((field) => (
              <li key={field}>{t(`editor.fields.${fieldKeys[field]}`)}</li>
            ))}
            {!changed.length ? <li>{t('editor.rowVersionOnly')}</li> : null}
          </ul>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || acceptedConflict === conflictRevision}
            onClick={() => {
              const local = getValues()
              reset(
                { ...local, expectedRowVersion: rowVersion },
                { keepDefaultValues: true }
              )
              setAcceptedConflict(conflictRevision)
              setAnnouncement(t('editor.rebaseAnnouncement'))
            }}
          >
            {t('editor.rebaseAction')}
          </Button>
        </section>
      ) : null}
      <Button
        type="submit"
        disabled={disabled || !isDirty || rebasePending || isSubmitting}
        isLoading={isSubmitting}
        loadingLabel={t('editor.saving')}
      >
        {t('questionDetail.saveDraft')}
      </Button>
    </form>
  )
}
