import { useKeyboardShortcuts } from '@common/hooks/useKeyboardShortcuts'

interface PracticeKeyboardOptions {
  enabled?: boolean
  optionIds: string[]
  onSelectOption: (optionId: string) => void
  onPrevious: () => void
  onNext: () => void
}

export const usePracticeKeyboard = ({
  enabled = true,
  optionIds,
  onNext,
  onPrevious,
  onSelectOption
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
      }
    ],
    { enabled }
  )
}
