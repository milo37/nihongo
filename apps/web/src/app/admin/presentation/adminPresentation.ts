import type {
  AdminAuditLogItem,
  AdminContentReviewItem,
  AdminQuestionSummary,
  AdminQuestionVersionSummary,
  AdminImportValidationResponse,
  DiffQuestionVersionResponse,
  ListAdminQuestionReportsQuery,
  ListAdminQuestionsQuery,
  QuestionReportDetail,
  QuestionReportSummary,
  QuestionVersionStatus,
  SafeActorSnapshot
} from '@nihongo/contracts/admin/phase7'

export type AdminQuestionCommand =
  | 'APPROVE'
  | 'ARCHIVE'
  | 'CHANGE_REQUEST'
  | 'CREATE_VERSION'
  | 'PUBLISH'
  | 'REQUEST_REVIEW'
  | 'RETIRE'
  | 'WITHDRAW'

export type FreshAssuranceReasonCode =
  | 'BATCH_REVIEW'
  | 'EXPORT'
  | 'IMPORT_APPLY'
  | 'QUESTION_APPROVE'
  | 'QUESTION_ARCHIVE'
  | 'QUESTION_PUBLISH'
  | 'QUESTION_RETIRE'
  | 'QUESTION_WITHDRAW'
  | 'REPORT_RESOLUTION'

export interface AdminApiErrorPresentation {
  readonly code?: string
  readonly isOffline?: boolean
  readonly retryAfterMs?: number
}

export const adminSubjectKey = {
  VOCABULARY: 'enums.subjects.VOCABULARY',
  GRAMMAR: 'enums.subjects.GRAMMAR',
  READING: 'enums.subjects.READING'
} as const satisfies Record<AdminQuestionSummary['subject'], string>

export const adminQuestionTypeKey = {
  KANJI_READING: 'enums.questionTypes.KANJI_READING',
  ORTHOGRAPHY: 'enums.questionTypes.ORTHOGRAPHY',
  CONTEXT_VOCABULARY: 'enums.questionTypes.CONTEXT_VOCABULARY',
  PARAPHRASE: 'enums.questionTypes.PARAPHRASE',
  WORD_USAGE: 'enums.questionTypes.WORD_USAGE',
  GRAMMAR_SELECT: 'enums.questionTypes.GRAMMAR_SELECT',
  SENTENCE_ORDER: 'enums.questionTypes.SENTENCE_ORDER',
  TEXT_GRAMMAR: 'enums.questionTypes.TEXT_GRAMMAR',
  SHORT_READING: 'enums.questionTypes.SHORT_READING',
  MEDIUM_READING: 'enums.questionTypes.MEDIUM_READING',
  LONG_READING: 'enums.questionTypes.LONG_READING',
  INFO_RETRIEVAL: 'enums.questionTypes.INFO_RETRIEVAL'
} as const satisfies Record<AdminQuestionSummary['questionType'], string>

export const adminDifficultyKey = {
  EASY: 'enums.difficulties.EASY',
  NORMAL: 'enums.difficulties.NORMAL',
  HARD: 'enums.difficulties.HARD'
} as const satisfies Record<AdminQuestionSummary['difficulty'], string>

export const adminLifecycleStatusKey = {
  ACTIVE: 'enums.lifecycleStatuses.ACTIVE',
  ARCHIVED: 'enums.lifecycleStatuses.ARCHIVED'
} as const satisfies Record<AdminQuestionSummary['lifecycleStatus'], string>

export const adminVersionStatusKey = {
  DRAFT: 'enums.versionStatuses.DRAFT',
  IN_REVIEW: 'enums.versionStatuses.IN_REVIEW',
  CHANGES_REQUESTED: 'enums.versionStatuses.CHANGES_REQUESTED',
  APPROVED: 'enums.versionStatuses.APPROVED',
  PUBLISHED: 'enums.versionStatuses.PUBLISHED',
  RETIRED: 'enums.versionStatuses.RETIRED'
} as const satisfies Record<QuestionVersionStatus, string>

export const adminQuestionSortKey = {
  UPDATED_DESC: 'enums.questionSort.UPDATED_DESC',
  CREATED_DESC: 'enums.questionSort.CREATED_DESC',
  LEVEL_ASC: 'enums.questionSort.LEVEL_ASC',
  REPORT_COUNT_DESC: 'enums.questionSort.REPORT_COUNT_DESC'
} as const satisfies Record<ListAdminQuestionsQuery['sort'], string>

export const adminReportSortKey = {
  UPDATED_DESC: 'enums.reportSort.UPDATED_DESC',
  CREATED_DESC: 'enums.reportSort.CREATED_DESC'
} as const satisfies Record<ListAdminQuestionReportsQuery['sort'], string>

export { adminReportReasonKey } from '@app/content-operations/reports/presentation/questionReportPresentation'

export const adminReportStatusKey = {
  OPEN: 'enums.reportStatuses.OPEN',
  TRIAGED: 'enums.reportStatuses.TRIAGED',
  RESOLVED: 'enums.reportStatuses.RESOLVED',
  DISMISSED: 'enums.reportStatuses.DISMISSED'
} as const satisfies Record<QuestionReportSummary['status'], string>

export const adminReportOutcomeKey = {
  RESOLVED: 'enums.reportOutcomes.RESOLVED',
  DISMISSED: 'enums.reportOutcomes.DISMISSED'
} as const satisfies Record<
  NonNullable<QuestionReportDetail['resolution']>['outcome'],
  string
>

export const adminCommandKey = {
  APPROVE: 'enums.commands.APPROVE',
  ARCHIVE: 'enums.commands.ARCHIVE',
  CHANGE_REQUEST: 'enums.commands.CHANGE_REQUEST',
  CREATE_VERSION: 'enums.commands.CREATE_VERSION',
  PUBLISH: 'enums.commands.PUBLISH',
  REQUEST_REVIEW: 'enums.commands.REQUEST_REVIEW',
  RETIRE: 'enums.commands.RETIRE',
  WITHDRAW: 'enums.commands.WITHDRAW'
} as const satisfies Record<AdminQuestionCommand, string>

export const adminReviewActionKey = {
  REQUESTED: 'enums.reviewActions.REQUESTED',
  CHANGES_REQUESTED: 'enums.reviewActions.CHANGES_REQUESTED',
  APPROVED: 'enums.reviewActions.APPROVED',
  APPROVAL_WITHDRAWN: 'enums.reviewActions.APPROVAL_WITHDRAWN',
  PUBLISHED: 'enums.reviewActions.PUBLISHED',
  RETIRED: 'enums.reviewActions.RETIRED',
  ARCHIVE_ABANDONED: 'enums.reviewActions.ARCHIVE_ABANDONED',
  AUTHOR_ERASURE_ABANDONED: 'enums.reviewActions.AUTHOR_ERASURE_ABANDONED'
} as const satisfies Record<AdminContentReviewItem['action'], string>

export const adminAuditCommandKey = {
  QUESTION_CREATE: 'enums.auditCommands.QUESTION_CREATE',
  QUESTION_VERSION_CREATE: 'enums.auditCommands.QUESTION_VERSION_CREATE',
  QUESTION_VERSION_UPDATE: 'enums.auditCommands.QUESTION_VERSION_UPDATE',
  REVIEW_REQUEST: 'enums.auditCommands.REVIEW_REQUEST',
  CHANGE_REQUEST: 'enums.auditCommands.CHANGE_REQUEST',
  APPROVAL: 'enums.auditCommands.APPROVAL',
  APPROVAL_WITHDRAWAL: 'enums.auditCommands.APPROVAL_WITHDRAWAL',
  PUBLICATION: 'enums.auditCommands.PUBLICATION',
  RETIREMENT: 'enums.auditCommands.RETIREMENT',
  QUESTION_ARCHIVE: 'enums.auditCommands.QUESTION_ARCHIVE',
  REVIEW_REQUEST_BATCH: 'enums.auditCommands.REVIEW_REQUEST_BATCH',
  IMPORT_APPLY: 'enums.auditCommands.IMPORT_APPLY',
  EXPORT: 'enums.auditCommands.EXPORT',
  REPORT_TRIAGE: 'enums.auditCommands.REPORT_TRIAGE',
  REPORT_RESOLUTION: 'enums.auditCommands.REPORT_RESOLUTION',
  REAUTHENTICATION: 'enums.auditCommands.REAUTHENTICATION',
  AUTHOR_ERASURE_ABANDON: 'enums.auditCommands.AUTHOR_ERASURE_ABANDON'
} as const satisfies Record<AdminAuditLogItem['command'], string>

export const adminAuditTargetTypeKey = {
  QUESTION: 'enums.auditTargetTypes.QUESTION',
  QUESTION_VERSION: 'enums.auditTargetTypes.QUESTION_VERSION',
  QUESTION_REPORT: 'enums.auditTargetTypes.QUESTION_REPORT',
  REVIEW_REQUEST_BATCH: 'enums.auditTargetTypes.REVIEW_REQUEST_BATCH',
  IMPORT_REQUEST: 'enums.auditTargetTypes.IMPORT_REQUEST',
  EXPORT_REQUEST: 'enums.auditTargetTypes.EXPORT_REQUEST',
  ADMIN_SESSION: 'enums.auditTargetTypes.ADMIN_SESSION',
  USER_ERASURE: 'enums.auditTargetTypes.USER_ERASURE'
} as const satisfies Record<AdminAuditLogItem['targetType'], string>

export const adminAuditStateKey = {
  ACTIVE: 'enums.auditStates.ACTIVE',
  ARCHIVED: 'enums.auditStates.ARCHIVED',
  DRAFT: 'enums.auditStates.DRAFT',
  IN_REVIEW: 'enums.auditStates.IN_REVIEW',
  CHANGES_REQUESTED: 'enums.auditStates.CHANGES_REQUESTED',
  APPROVED: 'enums.auditStates.APPROVED',
  PUBLISHED: 'enums.auditStates.PUBLISHED',
  RETIRED: 'enums.auditStates.RETIRED',
  OPEN: 'enums.auditStates.OPEN',
  TRIAGED: 'enums.auditStates.TRIAGED',
  RESOLVED: 'enums.auditStates.RESOLVED',
  DISMISSED: 'enums.auditStates.DISMISSED',
  SESSION_STALE: 'enums.auditStates.SESSION_STALE',
  SESSION_FRESH: 'enums.auditStates.SESSION_FRESH'
} as const satisfies Record<
  NonNullable<AdminAuditLogItem['beforeState']>,
  string
>

export const adminAuditChangedFieldKey = {
  LIFECYCLE_STATUS: 'enums.auditChangedFields.LIFECYCLE_STATUS',
  VERSION_STATUS: 'enums.auditChangedFields.VERSION_STATUS',
  CURRENT_PUBLISHED_VERSION_ID:
    'enums.auditChangedFields.CURRENT_PUBLISHED_VERSION_ID',
  LEVEL: 'enums.auditChangedFields.LEVEL',
  SUBJECT: 'enums.auditChangedFields.SUBJECT',
  QUESTION_TYPE: 'enums.auditChangedFields.QUESTION_TYPE',
  DIFFICULTY: 'enums.auditChangedFields.DIFFICULTY',
  PASSAGE: 'enums.auditChangedFields.PASSAGE',
  QUESTION_TEXT: 'enums.auditChangedFields.QUESTION_TEXT',
  EXPLANATION_KO: 'enums.auditChangedFields.EXPLANATION_KO',
  EXPLANATION_JA: 'enums.auditChangedFields.EXPLANATION_JA',
  OPTIONS: 'enums.auditChangedFields.OPTIONS',
  CORRECT_OPTION: 'enums.auditChangedFields.CORRECT_OPTION',
  TAGS: 'enums.auditChangedFields.TAGS',
  ASSIGNEE: 'enums.auditChangedFields.ASSIGNEE',
  RESOLUTION: 'enums.auditChangedFields.RESOLUTION',
  REPORT_STATUS: 'enums.auditChangedFields.REPORT_STATUS',
  SESSION_ROTATION: 'enums.auditChangedFields.SESSION_ROTATION',
  IMPORT_ITEMS: 'enums.auditChangedFields.IMPORT_ITEMS',
  EXPORT_SELECTION: 'enums.auditChangedFields.EXPORT_SELECTION',
  AUTHOR_TOMBSTONE: 'enums.auditChangedFields.AUTHOR_TOMBSTONE'
} as const satisfies Record<AdminAuditLogItem['changedFields'][number], string>

export const adminAuditEnvironmentKey = {
  TEST: 'enums.auditEnvironments.TEST',
  DEVELOPMENT: 'enums.auditEnvironments.DEVELOPMENT'
} as const satisfies Record<AdminAuditLogItem['environment'], string>

export const adminActorLabelKey = {
  ACTIVE_USER: 'enums.actorLabels.ACTIVE_USER',
  DELETED_USER: 'enums.actorLabels.DELETED_USER',
  ACTIVE_ADMIN: 'enums.actorLabels.ACTIVE_ADMIN',
  DELETED_ADMIN: 'enums.actorLabels.DELETED_ADMIN',
  ACCOUNT_ERASURE: 'enums.actorLabels.ACCOUNT_ERASURE'
} as const satisfies Record<SafeActorSnapshot['label'], string>

export const adminDiffFieldKey = {
  LEVEL: 'enums.diffFields.LEVEL',
  SUBJECT: 'enums.diffFields.SUBJECT',
  QUESTION_TYPE: 'enums.diffFields.QUESTION_TYPE',
  DIFFICULTY: 'enums.diffFields.DIFFICULTY',
  PASSAGE: 'enums.diffFields.PASSAGE',
  QUESTION_TEXT: 'enums.diffFields.QUESTION_TEXT',
  EXPLANATION_KO: 'enums.diffFields.EXPLANATION_KO',
  EXPLANATION_JA: 'enums.diffFields.EXPLANATION_JA',
  OPTIONS: 'enums.diffFields.OPTIONS',
  TAGS: 'enums.diffFields.TAGS'
} as const satisfies Record<
  DiffQuestionVersionResponse['changes'][number]['field'],
  string
>

export const adminImportIssueCodeKey = {
  DUPLICATE_CLIENT_ITEM_ID: 'enums.importIssueCodes.DUPLICATE_CLIENT_ITEM_ID',
  DUPLICATE_CLIENT_OPTION_KEY:
    'enums.importIssueCodes.DUPLICATE_CLIENT_OPTION_KEY',
  DUPLICATE_OPTION_TEXT: 'enums.importIssueCodes.DUPLICATE_OPTION_TEXT',
  DUPLICATE_TAG: 'enums.importIssueCodes.DUPLICATE_TAG',
  CORRECT_OPTION_KEY_NOT_FOUND:
    'enums.importIssueCodes.CORRECT_OPTION_KEY_NOT_FOUND',
  UNKNOWN_TAG: 'enums.importIssueCodes.UNKNOWN_TAG',
  INVALID_READING_PASSAGE: 'enums.importIssueCodes.INVALID_READING_PASSAGE',
  INVALID_CONTENT: 'enums.importIssueCodes.INVALID_CONTENT',
  DUPLICATE_QUESTION_CONTENT:
    'enums.importIssueCodes.DUPLICATE_QUESTION_CONTENT'
} as const satisfies Record<
  AdminImportValidationResponse['errors'][number]['code'],
  string
>

export const freshAssuranceReasonKey = {
  BATCH_REVIEW: 'freshAssurance.reasons.BATCH_REVIEW',
  EXPORT: 'freshAssurance.reasons.EXPORT',
  IMPORT_APPLY: 'freshAssurance.reasons.IMPORT_APPLY',
  QUESTION_APPROVE: 'freshAssurance.reasons.QUESTION_APPROVE',
  QUESTION_ARCHIVE: 'freshAssurance.reasons.QUESTION_ARCHIVE',
  QUESTION_PUBLISH: 'freshAssurance.reasons.QUESTION_PUBLISH',
  QUESTION_RETIRE: 'freshAssurance.reasons.QUESTION_RETIRE',
  QUESTION_WITHDRAW: 'freshAssurance.reasons.QUESTION_WITHDRAW',
  REPORT_RESOLUTION: 'freshAssurance.reasons.REPORT_RESOLUTION'
} as const satisfies Record<FreshAssuranceReasonCode, string>

export type AdminStableErrorCode =
  | 'ADMIN_REQUIRED'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTH_SESSION_EXPIRED'
  | 'DUPLICATE_QUESTION_CONTENT'
  | 'FORBIDDEN'
  | 'FRESH_ASSURANCE_REQUIRED'
  | 'IMPORT_IDENTITY_CONFLICT'
  | 'IMPORT_VALIDATION_FAILED'
  | 'INTERNAL_SERVER_ERROR'
  | 'INVALID_ID'
  | 'INVALID_JSON'
  | 'INVALID_REQUEST'
  | 'INVALID_STATE_TRANSITION'
  | 'QUESTION_REPORT_DUPLICATE'
  | 'QUESTION_VERSION_IMMUTABLE'
  | 'RATE_LIMITED'
  | 'REAUTHENTICATION_FAILED'
  | 'REQUEST_TOO_LARGE'
  | 'RESOURCE_NOT_FOUND'
  | 'SEPARATION_OF_DUTIES_VIOLATION'
  | 'SERVICE_UNAVAILABLE'
  | 'UNTRUSTED_ORIGIN'
  | 'VALIDATION_ERROR'
  | 'VERSION_CONFLICT'

export const adminApiErrorKeyByCode = {
  AUTHENTICATION_REQUIRED: 'errors.authenticationRequired',
  AUTH_SESSION_EXPIRED: 'errors.sessionExpired',
  ADMIN_REQUIRED: 'errors.adminRequired',
  FORBIDDEN: 'errors.forbidden',
  FRESH_ASSURANCE_REQUIRED: 'errors.freshAssuranceRequired',
  INVALID_ID: 'errors.invalidId',
  INVALID_JSON: 'errors.invalidRequest',
  INVALID_REQUEST: 'errors.invalidRequest',
  REQUEST_TOO_LARGE: 'errors.requestTooLarge',
  VALIDATION_ERROR: 'errors.validation',
  RESOURCE_NOT_FOUND: 'errors.notFound',
  VERSION_CONFLICT: 'errors.versionConflict',
  QUESTION_VERSION_IMMUTABLE: 'errors.questionVersionImmutable',
  INVALID_STATE_TRANSITION: 'errors.invalidState',
  SEPARATION_OF_DUTIES_VIOLATION: 'errors.separationOfDuties',
  DUPLICATE_QUESTION_CONTENT: 'errors.duplicateQuestionContent',
  UNTRUSTED_ORIGIN: 'errors.untrustedOrigin',
  RATE_LIMITED: 'errors.rateLimited',
  INTERNAL_SERVER_ERROR: 'errors.server',
  SERVICE_UNAVAILABLE: 'errors.unavailable',
  QUESTION_REPORT_DUPLICATE: 'errors.reportDuplicate',
  IMPORT_IDENTITY_CONFLICT: 'errors.importIdentityConflict',
  IMPORT_VALIDATION_FAILED: 'errors.importValidationFailed',
  REAUTHENTICATION_FAILED: 'errors.reauthenticationFailed'
} as const satisfies Record<AdminStableErrorCode, string>

export type AdminErrorKey =
  | (typeof adminApiErrorKeyByCode)[keyof typeof adminApiErrorKeyByCode]
  | 'errors.offline'
  | 'errors.generic'

export const getAdminApiErrorKey = (
  error: AdminApiErrorPresentation | null | undefined,
  fallback: AdminErrorKey = 'errors.generic'
): AdminErrorKey => {
  if (!error) return fallback
  if (error.isOffline) return 'errors.offline'
  if (error.code && error.code in adminApiErrorKeyByCode) {
    return adminApiErrorKeyByCode[
      error.code as keyof typeof adminApiErrorKeyByCode
    ]
  }
  return fallback
}

export const getAdminRetryAfterSeconds = (
  error: AdminApiErrorPresentation | null | undefined
): number | null =>
  error?.retryAfterMs ? Math.max(1, Math.ceil(error.retryAfterMs / 1000)) : null

export const hasAdminFieldError = (
  messages: readonly string[] | undefined
): boolean => Boolean(messages?.length)

export const getFreshAssuranceReasonCode = (
  command: AdminQuestionCommand
): FreshAssuranceReasonCode | null => {
  switch (command) {
    case 'APPROVE':
      return 'QUESTION_APPROVE'
    case 'ARCHIVE':
      return 'QUESTION_ARCHIVE'
    case 'PUBLISH':
      return 'QUESTION_PUBLISH'
    case 'RETIRE':
      return 'QUESTION_RETIRE'
    case 'WITHDRAW':
      return 'QUESTION_WITHDRAW'
    case 'CHANGE_REQUEST':
    case 'CREATE_VERSION':
    case 'REQUEST_REVIEW':
      return null
  }
}

export const getSelectedVersionStatus = (
  version: AdminQuestionVersionSummary
): QuestionVersionStatus => version.versionStatus
