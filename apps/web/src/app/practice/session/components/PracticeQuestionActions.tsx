import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'

type PracticeQuestionActionsProps = {
  canSubmit: boolean
  hidePrevious: boolean
  isFirstQuestion: boolean
  isLastQuestion: boolean
  isLocked: boolean
  onNext: () => void
  onPrevious: () => void
  onSubmit: () => void
  submitButtonRef: RefObject<HTMLButtonElement | null>
}

export const PracticeQuestionActions = ({
  canSubmit,
  hidePrevious,
  isFirstQuestion,
  isLastQuestion,
  isLocked,
  onNext,
  onPrevious,
  onSubmit,
  submitButtonRef
}: PracticeQuestionActionsProps): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    // Fixed bar under 1024px; under the options on a wide screen (direction §6-3).
    <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-line bg-surface px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:static lg:mt-8 lg:justify-between lg:border-0 lg:bg-transparent lg:p-0">
      {/* A single review question has nowhere to go back to. */}
      {hidePrevious ? null : (
        <Button
          className="shrink-0 disabled:bg-transparent"
          variant="ghost"
          disabled={isFirstQuestion || isLocked}
          onClick={onPrevious}
        >
          {t('session.navigation.previous')}
        </Button>
      )}

      {isLastQuestion ? (
        <Button
          ref={submitButtonRef}
          className="min-h-[52px] flex-1 lg:flex-none lg:px-8"
          aria-keyshortcuts="Control+Enter Meta+Enter"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {t('session.navigation.submit')}
        </Button>
      ) : (
        <Button
          className="min-h-[52px] flex-1 lg:flex-none lg:px-8"
          disabled={isLocked}
          onClick={onNext}
        >
          {t('session.navigation.next')}
        </Button>
      )}
    </div>
  )
}
