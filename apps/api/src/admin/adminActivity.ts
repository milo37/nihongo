import type {
  AdminActivityAction,
  AdminActivityItem
} from '@nihongo/contracts/admin/audit'
import type { AdminAuditRecord } from './adminQuestionRepository.js'

type AdminAuditCommand = AdminAuditRecord['command']

export const ADMIN_ACTIVITY_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000

// Only these commands appear in the reduced activity log.
export const ADMIN_ACTIVITY_ACTION_BY_COMMAND = {
  PUBLICATION: 'PUBLISH',
  QUESTION_CREATE: 'UPDATE',
  QUESTION_VERSION_CREATE: 'UPDATE',
  QUESTION_VERSION_UPDATE: 'UPDATE',
  IMPORT_APPLY: 'UPDATE',
  RETIREMENT: 'DELETE_OR_ARCHIVE',
  QUESTION_ARCHIVE: 'DELETE_OR_ARCHIVE',
  REAUTHENTICATION: 'ADMIN_SIGN_IN'
} as const satisfies Partial<Record<AdminAuditCommand, AdminActivityAction>>

export const ADMIN_ACTIVITY_COMMANDS = Object.keys(
  ADMIN_ACTIVITY_ACTION_BY_COMMAND
) as (keyof typeof ADMIN_ACTIVITY_ACTION_BY_COMMAND)[]

const TARGET_LABEL_BY_TYPE: Record<AdminAuditRecord['targetType'], string> = {
  QUESTION: '문항',
  QUESTION_VERSION: '문항 버전',
  QUESTION_REPORT: '제보',
  REVIEW_REQUEST_BATCH: '검수 묶음',
  IMPORT_REQUEST: '가져오기',
  EXPORT_REQUEST: '내보내기',
  ADMIN_SESSION: '관리자 로그인',
  USER_ERASURE: '계정 삭제'
}

export const toAdminActivityItem = (
  record: Pick<
    AdminAuditRecord,
    'command' | 'targetType' | 'targetId' | 'occurredAt'
  >
): AdminActivityItem => {
  const action =
    ADMIN_ACTIVITY_ACTION_BY_COMMAND[
      record.command as keyof typeof ADMIN_ACTIVITY_ACTION_BY_COMMAND
    ]
  if (action === undefined) {
    throw new Error('Audit command is outside the activity log.')
  }
  return {
    occurredAt: record.occurredAt.toISOString(),
    action,
    targetLabel: TARGET_LABEL_BY_TYPE[record.targetType],
    // A session id is a credential-adjacent identifier; never expose it.
    targetId: record.targetType === 'ADMIN_SESSION' ? null : record.targetId,
    result: 'SUCCESS'
  }
}
