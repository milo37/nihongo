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
  const { t } = useAdminPresentation()
  const { pathname } = useLocation()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  return (
    <>
      {trigger === 'link' ? (
        <button
          ref={triggerRef}
          type="button"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-muted underline underline-offset-4 hover:text-ink"
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
