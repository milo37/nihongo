import { useKeyboardShortcuts } from '@common/hooks/useKeyboardShortcuts'

interface PracticeKeyboardOptions {
  enabled?: boolean
  optionIds: string[]
  onSelectOption: (optionId: string) => void
  onPrevious: () => void
  onNext: () => void
  onSubmit: () => void
  submitEnabled?: boolean
}

export const usePracticeKeyboard = ({
  enabled = true,
  optionIds,
  onNext,
  onPrevious,
  onSelectOption,
  onSubmit,
  submitEnabled = false
}: PracticeKeyboardOptions): void => {
  useKeyboardShortcuts(
    [
      ...optionIds.map((optionId, index) => ({
        key: String(index + 1),
        onTrigger: () => onSelectOption(optionId)
      })),
      {
        key: 'ArrowLeft',
        onTrigger: onPrevious
      },
      {
        key: 'ArrowRight',
        onTrigger: onNext
      },
      ...(submitEnabled
        ? [
            {
              ctrlKey: true,
              key: 'Enter',
              onTrigger: onSubmit
            },
            {
              key: 'Enter',
              metaKey: true,
              onTrigger: onSubmit
            }
          ]
        : [])
    ],
    { enabled }
  )
}
