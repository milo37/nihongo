import { useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { useLocation } from 'react-router'
import { useQuestionReportPresentation as useAdminPresentation } from '@app/content-operations/reports/questionReportPublic'
import { ReportDialog } from '@app/question-report/components/ReportDialog'
import { toReportScreenKey } from '@app/question-report/reportLocation'
import { Button } from '@nihongo/browser/common/components/Button'
import { useAppStore } from '@nihongo/browser/store/index'

const useAppErrorReport = () => {
  const { t } = useAdminPresentation()
  const { pathname } = useLocation()
  return {
    t,
    copy: {
      title: t('questionReportDialog.appErrorTitle'),
      description: t('questionReportDialog.appErrorDescription'),
      submitted: t('questionReportDialog.appErrorSent'),
      error: t('questionReportDialog.appErrorError')
    },
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
  const report = useAppErrorReport()
  if (role !== 'USER' && role !== 'ADMIN') return null
  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        {report.t('questionReportDialog.errorScreenTrigger')}
      </Button>
      <ReportDialog
        copy={report.copy}
        open={open}
        onOpenChange={setOpen}
        returnFocusRef={triggerRef}
        toRequest={report.toRequest}
      />
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
  const report = useAppErrorReport()
  return (
    <>
      <ReportDialog
        copy={report.copy}
        open={open}
        onOpenChange={onOpenChange}
        returnFocusRef={returnFocusRef}
        toRequest={report.toRequest}
      />
    </>
  )
}
