import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import type { FieldPath, UseFormRegister } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  updateQuestionVersionRequestSchema,
  type PreviewQuestionVersionResponse,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/content-operations'
import { Button } from '@nihongo/browser/common/components/Button'
import { Input } from '@nihongo/browser/common/components/Input'
import { Select } from '@nihongo/browser/common/components/Select'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { editorInput } from '@app/admin-question/detail/questionWorkflow'
import {
  EditorRebaseNotice,
  editorFields
} from '@app/admin-question/components/EditorRebaseNotice'
import { QuestionOptionsFieldset } from '@app/admin-question/components/QuestionOptionsFieldset'
import { QUESTION_TYPES, SUBJECTS } from '@nihongo/browser/common/types/domain'
type EditorRegister = UseFormRegister<UpdateQuestionVersionRequest>
type FieldError = (
  name: keyof UpdateQuestionVersionRequest
) => string | undefined
type FieldsetProps = {
  register: EditorRegister
  invalid: FieldError
  disabled: boolean
}

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD'] as const

/** Level, subject, type, difficulty, passage and question text. */
const ClassificationFieldset = ({
  register,
  invalid,
  disabled
}: FieldsetProps): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <fieldset className="grid gap-5" disabled={disabled}>
      <legend className="mb-4 text-xl font-bold">
        {t('editor.classificationLegend')}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t('editor.level')}
          options={LEVELS.map((value) => ({ value, label: value }))}
          error={invalid('level')}
          {...register('level')}
        />
        <Select
          label={t('editor.subject')}
          options={SUBJECTS.map((value) => ({
            value,
            label: t(`enums.subjects.${value}`)
          }))}
          error={invalid('subject')}
          {...register('subject')}
        />
        <Select
          label={t('editor.questionType')}
          options={QUESTION_TYPES.map((value) => ({
            value,
            label: t(`enums.questionTypes.${value}`)
          }))}
          error={invalid('questionType')}
          {...register('questionType')}
        />
        <Select
          label={t('editor.difficulty')}
          options={DIFFICULTIES.map((value) => ({
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
  )
}

/** Korean and Japanese explanations and comma separated tags. */
const ExplanationFieldset = ({
  register,
  invalid,
  disabled,
  tagsKey,
  tagNames
}: FieldsetProps & {
  tagsKey: number
  tagNames: readonly string[]
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <fieldset className="grid gap-4" disabled={disabled}>
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
        label={t('editor.selectedTags')}
        key={tagsKey}
        defaultValue={tagNames.join(', ')}
        error={invalid('tagNames')}
        {...register('tagNames', {
          setValueAs: (value: unknown) =>
            typeof value === 'string'
              ? value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean)
              : value
        })}
      />
    </fieldset>
  )
}

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
    setError,
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
  const focusedServerErrors = useRef('')
  useEffect(() => {
    const signature = JSON.stringify(serverFieldErrors)
    if (!Object.keys(serverFieldErrors).length) {
      focusedServerErrors.current = ''
      return
    }
    if (disabled || isSubmitting || signature === focusedServerErrors.current)
      return
    focusedServerErrors.current = signature
    for (const field of editorFields) {
      const path = Object.keys(serverFieldErrors).find(
        (path) =>
          (path === field || path.startsWith(field + '.')) &&
          serverFieldErrors[path]?.length
      )
      if (!path) continue
      const optionIndex = Number(path.split('.')[1])
      const target: FieldPath<UpdateQuestionVersionRequest> =
        field === 'options'
          ? `options.${Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex < options.length ? optionIndex : 0}.text`
          : field
      setError(target, { type: 'server' })
      setFocus(target)
      break
    }
  }, [
    disabled,
    isSubmitting,
    options.length,
    serverFieldErrors,
    setError,
    setFocus
  ])
  const invalid: FieldError = (name) =>
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
  const changed = editorFields.filter(
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
      <ClassificationFieldset
        register={register}
        invalid={invalid}
        disabled={disabled || isSubmitting}
      />
      <QuestionOptionsFieldset
        options={options}
        register={register}
        optionsInvalid={Boolean(errors.options || serverFieldErrors.options)}
        correctError={invalid('correctOptionId')}
        disabled={disabled || isSubmitting}
        onMove={moveOption}
      />
      <ExplanationFieldset
        register={register}
        invalid={invalid}
        disabled={disabled || isSubmitting}
        tagsKey={acceptedRow}
        tagNames={values.tagNames ?? []}
      />
      {rebasePending ? (
        <EditorRebaseNotice
          changed={changed}
          disabled={disabled || acceptedConflict === conflictRevision}
          onRebase={() => {
            const local = getValues()
            reset(
              { ...local, expectedRowVersion: rowVersion },
              { keepDefaultValues: true }
            )
            setAcceptedConflict(conflictRevision)
            setAnnouncement(t('editor.rebaseAnnouncement'))
          }}
        />
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
