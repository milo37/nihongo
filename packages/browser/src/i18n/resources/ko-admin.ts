/** Whole admin copy (KO); the admin app adds it after start (JLP-758). */
import { koAdminLearnerResources as learner } from './ko-admin-learner'
import { koAdminAuditResources } from './ko-admin-audit'
import { koAdminCreateResources } from './ko-admin-create'
import { koAdminEditorResources } from './ko-admin-editor'
import { koAdminEnumsResources } from './ko-admin-enums'
import { koAdminIdleLockResources } from './ko-admin-idle-lock'
import { koAdminImportResources } from './ko-admin-import'
import { koAdminListResources } from './ko-admin-list'
import { koAdminMembersResources } from './ko-admin-members'
import { koAdminNavResources } from './ko-admin-nav'
import { koAdminQuestionListResources } from './ko-admin-question'
import { koAdminQuestionDetailResources } from './ko-admin-question-detail'
import { koAdminReportResources } from './ko-admin-report'
import { koAdminSharedListResources } from './ko-admin-shared-list'

export const koAdminResources = {
  name: learner.name,
  reauth: learner.reauth,
  grid: koAdminListResources,
  adminList: koAdminSharedListResources,
  nav: koAdminNavResources,
  members: koAdminMembersResources,
  idleLock: koAdminIdleLockResources,
  common: learner.common,
  enums: koAdminEnumsResources,
  errors: learner.errors,
  questionList: koAdminQuestionListResources,
  create: koAdminCreateResources,
  editor: koAdminEditorResources,
  questionDetail: koAdminQuestionDetailResources,
  import: koAdminImportResources,
  audit: koAdminAuditResources,
  questionReportDialog: learner.questionReportDialog,
  userReport: koAdminReportResources
} as const
