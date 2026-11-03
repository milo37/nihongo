import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'

type PracticeQuestionActionsProps = {
  canSubmit: boolean
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
    <div className="study-question-actions mt-5 grid grid-cols-[1fr_2fr] gap-3 sm:flex sm:items-center sm:justify-between">
      <Button
        variant="outline"
        disabled={isFirstQuestion || isLocked}
        onClick={onPrevious}
      >
        {t('session.navigation.previous')}
      </Button>

      {isLastQuestion ? (
        <Button
          ref={submitButtonRef}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {t('session.navigation.submit')}
        </Button>
      ) : (
        <Button disabled={isLocked} onClick={onNext}>
          {t('session.navigation.next')}
        </Button>
      )}
    </div>
  )
}
