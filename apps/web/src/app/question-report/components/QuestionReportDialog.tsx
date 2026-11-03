import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useLocation } from 'react-router'
import { useQuestionReportPresentation as useAdminPresentation } from '@app/content-operations/reports/questionReportPublic'
import { ReportDialog } from '@app/question-report/components/ReportDialog'
import {
  toQuestionReportLocation,
  toReportScreenKey
} from '@app/question-report/reportLocation'
import { Button } from '@nihongo/browser/common/components/Button'

interface QuestionReportDialogProps {
  readonly questionId: string
  readonly questionVersionId: string
  /** 1-based question number on the current screen. */
  readonly ordinal: number
}

export const QuestionReportDialog = ({
  questionId,
  questionVersionId,
  ordinal
}: QuestionReportDialogProps): ReactElement => {
  const { t } = useAdminPresentation()
  const { pathname } = useLocation()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [wasSubmitted, setWasSubmitted] = useState(false)

  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        variant="outline"
        onClick={() => {
          setWasSubmitted(false)
          setOpen(true)
        }}
      >
        {t('questionReportDialog.trigger')}
      </Button>
      <ReportDialog
        copy={{
          title: t('questionReportDialog.title'),
          description: t('questionReportDialog.description'),
          submitted: t('questionReportDialog.submitted'),
          error: t('questionReportDialog.error')
        }}
        open={open}
        onOpenChange={setOpen}
        onSubmitted={() => setWasSubmitted(true)}
        returnFocusRef={triggerRef}
        toRequest={(description) => ({
          kind: 'QUESTION',
          location: toQuestionReportLocation(
            toReportScreenKey(pathname),
            ordinal
          ),
          questionId,
          questionVersionId,
          description
        })}
      />
      <p className="sr-only" aria-live="polite">
        {wasSubmitted ? t('questionReportDialog.submitted') : ''}
      </p>
    </>
  )
}
