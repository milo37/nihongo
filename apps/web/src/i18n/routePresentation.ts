export type RouteLabelKey =
  | 'routes.home'
  | 'routes.login'
  | 'routes.resetPassword'
  | 'routes.verifyEmail'
  | 'routes.dashboard'
  | 'routes.practiceSetup'
  | 'routes.practiceSession'
  | 'routes.result'
  | 'routes.wrongNoteCenter'
  | 'routes.wrongNoteHistory'
  | 'routes.wrongNoteDetail'
  | 'routes.bookmarks'
  | 'routes.adminQuestionNew'
  | 'routes.adminQuestionImport'
  | 'routes.adminQuestionDetail'
  | 'routes.adminQuestions'
  | 'routes.adminAudit'
  | 'routes.adminReportDetail'
  | 'routes.adminReports'
  | 'routes.forbidden'
  | 'routes.page'

export const getRouteLabelKey = (pathname: string): RouteLabelKey => {
  if (pathname === '/') return 'routes.home'
  if (pathname === '/login') return 'routes.login'
  if (pathname === '/reset-password') return 'routes.resetPassword'
  if (pathname === '/verify-email') return 'routes.verifyEmail'
  if (pathname === '/dashboard') return 'routes.dashboard'
  if (pathname === '/practice') return 'routes.practiceSetup'
  if (pathname.startsWith('/practice/session/')) return 'routes.practiceSession'
  if (pathname.startsWith('/practice/result/')) return 'routes.result'
  if (pathname === '/wrong-notes') return 'routes.wrongNoteCenter'
  if (pathname === '/wrong-notes/history') return 'routes.wrongNoteHistory'
  if (pathname.startsWith('/wrong-notes/')) return 'routes.wrongNoteDetail'
  if (pathname === '/bookmarks') return 'routes.bookmarks'
  if (pathname === '/admin/questions/new') return 'routes.adminQuestionNew'
  if (pathname === '/admin/questions/import') {
    return 'routes.adminQuestionImport'
  }
  if (pathname.startsWith('/admin/questions/')) {
    return 'routes.adminQuestionDetail'
  }
  if (pathname === '/admin/questions') return 'routes.adminQuestions'
  if (pathname === '/admin/audit-log') return 'routes.adminAudit'
  if (pathname.startsWith('/admin/reports/')) {
    return 'routes.adminReportDetail'
  }
  if (pathname === '/admin/reports') return 'routes.adminReports'
  if (pathname === '/forbidden') return 'routes.forbidden'
  return 'routes.page'
}
