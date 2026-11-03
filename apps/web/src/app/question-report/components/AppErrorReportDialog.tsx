import { useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { useLocation } from 'react-router'
import { useQuestionReportPresentation as useAdminPresentation } from '@app/content-operations/reports/questionReportPublic'
import { ReportDialog } from '@app/question-report/components/ReportDialog'
import { toReportScreenKey } from '@app/question-report/reportLocation'
import { Button } from '@nihongo/browser/common/components/Button'
import { useAppStore } from '@nihongo/browser/store/index'

const useAppErrorReport = (onSubmitted: () => void) => {
  const { t } = useAdminPresentation()
  const { pathname } = useLocation()
  return {
    t,
    copy: {
      title: t('questionReportDialog.appErrorTitle'),
      description: t('questionReportDialog.appErrorDescription'),
      submitted: t('questionReportDialog.appErrorSubmitted'),
      error: t('questionReportDialog.appErrorError')
    },
    onSubmitted,
    toRequest: (description: string) => ({
      kind: 'APP_ERROR' as const,
      location: toReportScreenKey(pathname),
      description
    })
  }
}

/** Error and load-failure screens: members only, guests see nothing. */
export const AppErrorReportButton = (): ReactElement | null => {
  const role = useAppStore((state) => state.currentUser?.role)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [wasSubmitted, setWasSubmitted] = useState(false)
  const report = useAppErrorReport(() => setWasSubmitted(true))
  if (role !== 'USER' && role !== 'ADMIN') return null
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
        {report.t('questionReportDialog.errorScreenTrigger')}
      </Button>
      <ReportDialog
        copy={report.copy}
        open={open}
        onOpenChange={setOpen}
        onSubmitted={report.onSubmitted}
        returnFocusRef={triggerRef}
        toRequest={report.toRequest}
      />
      <p className="sr-only" aria-live="polite">
        {wasSubmitted ? report.copy.submitted : ''}
      </p>
    </>
  )
}

interface AppErrorReportMenuDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The menu item is gone before the dialog opens, so focus returns here. */
  readonly returnFocusRef: RefObject<HTMLElement | null>
}

/** Layout menu entry: the dialog lives outside the closing account menu. */
export const AppErrorReportMenuDialog = ({
  open,
  onOpenChange,
  returnFocusRef
}: AppErrorReportMenuDialogProps): ReactElement => {
  const [wasSubmitted, setWasSubmitted] = useState(false)
  const report = useAppErrorReport(() => setWasSubmitted(true))
  return (
    <>
      <ReportDialog
        copy={report.copy}
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setWasSubmitted(false)
          onOpenChange(nextOpen)
        }}
        onSubmitted={report.onSubmitted}
        returnFocusRef={returnFocusRef}
        toRequest={report.toRequest}
      />
      <p className="sr-only" aria-live="polite">
        {wasSubmitted ? report.copy.submitted : ''}
      </p>
    </>
  )
}
