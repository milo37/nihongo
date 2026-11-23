import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useLocation } from 'react-router'
import { useReportPresentation } from '@app/question-report/useReportPresentation'
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
  /** 'link' renders a small text link, for screens where reporting is rare. */
  readonly trigger?: 'button' | 'link'
  /** Screen-specific trigger text; the dialog copy stays the same. */
  readonly triggerLabel?: string
}

export const QuestionReportDialog = ({
  questionId,
  questionVersionId,
  ordinal,
  trigger = 'button',
  triggerLabel
}: QuestionReportDialogProps): ReactElement => {
  const { t } = useReportPresentation()
  const { pathname } = useLocation()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  return (
    <>
      {trigger === 'link' ? (
        <button
          ref={triggerRef}
          type="button"
          className="report-trigger-link"
          onClick={() => setOpen(true)}
        >
          {triggerLabel ?? t('questionReportDialog.trigger')}
        </button>
      ) : (
        <Button
          ref={triggerRef}
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
        >
          {triggerLabel ?? t('questionReportDialog.trigger')}
        </Button>
      )}
      <ReportDialog
        copy={{
          title: t('questionReportDialog.title'),
          description: t('questionReportDialog.description'),
          submitted: t('questionReportDialog.sent'),
          error: t('questionReportDialog.error')
        }}
        open={open}
        onOpenChange={setOpen}
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
    </>
  )
}
