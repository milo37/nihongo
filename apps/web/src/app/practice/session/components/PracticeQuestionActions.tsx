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
    <div className="study-actions">
      {/* A single review question has nowhere to go back to. */}
      {hidePrevious ? null : (
        <Button
          className="study-action-previous"
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
          className="study-action-main"
          aria-keyshortcuts="Control+Enter Meta+Enter"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {t('session.navigation.submit')}
        </Button>
      ) : (
        <Button
          className="study-action-main"
          disabled={isLocked}
          onClick={onNext}
        >
          {t('session.navigation.next')}
        </Button>
      )}
    </div>
  )
}
