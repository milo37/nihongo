import type { ReactElement } from 'react'
import type { UseFormRegister } from 'react-hook-form'
import type { UpdateQuestionVersionRequest } from '@nihongo/contracts/admin/content-operations'
import { Button } from '@nihongo/browser/common/components/Button'
import { Input } from '@nihongo/browser/common/components/Input'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

type EditorOption = UpdateQuestionVersionRequest['options'][number] & {
  fieldKey: string
}

/** Option text, correct-answer radio and keyboard/button reordering. */
export const QuestionOptionsFieldset = ({
  options,
  register,
  optionsInvalid,
  correctError,
  disabled,
  onMove
}: {
  options: EditorOption[]
  register: UseFormRegister<UpdateQuestionVersionRequest>
  optionsInvalid: boolean
  correctError: string | undefined
  disabled: boolean
  onMove: (from: number, to: number) => void
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <fieldset className="grid gap-4" disabled={disabled}>
      <legend className="mb-2 font-bold">{t('editor.optionsLegend')}</legend>
      <p className="text-sm text-muted">{t('editor.reorderHint')}</p>
      {options.map((option, index) => (
        <div
          key={option.fieldKey}
          className="grid gap-3 rounded-xl border border-line p-4"
        >
          <Input
            label={t('editor.optionLabel', { number: index + 1 })}
            error={optionsInvalid ? t('errors.validation') : undefined}
            {...register(`options.${index}.text`)}
            onKeyDown={(event) => {
              if (
                event.altKey &&
                ['ArrowUp', 'ArrowDown'].includes(event.key)
              ) {
                event.preventDefault()
                onMove(index, index + (event.key === 'ArrowUp' ? -1 : 1))
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
              onClick={() => onMove(index, index - 1)}
            >
              {t('editor.moveUp', { number: index + 1 })}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={index === options.length - 1}
              onClick={() => onMove(index, index + 1)}
            >
              {t('editor.moveDown', { number: index + 1 })}
            </Button>
          </div>
        </div>
      ))}
      {correctError ? <p role="alert">{correctError}</p> : null}
    </fieldset>
  )
}
