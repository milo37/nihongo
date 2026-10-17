import { useParams } from 'react-router'
import type { ReactElement } from 'react'
import { ReportDetail } from '@app/admin-report/components/ReportDetail'
import '@app/admin-report/styles.css'
export const AdminReportDetailPage = (): ReactElement => {
  const { reportId = '' } = useParams()
  return <ReportDetail key={reportId} reportId={reportId} />
}
