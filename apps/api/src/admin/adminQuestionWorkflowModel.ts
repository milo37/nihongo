import { createHash } from 'node:crypto'
import {
  type AdminImportValidationResponse,
  type AdminQuestionContentStructureInput,
  type Sha256TextPort
} from '@nihongo/contracts/admin/content-operations'

import { createAuthorityFailureClassifier } from './adminQuestionCommandRepository.js'

export type WorkflowTransactionalOperation =
  | 'requestContentReviewBatch'
  | 'applyQuestionImport'
  | 'exportAdminQuestions'
  | 'triageAdminQuestionReport'
  | 'resolveAdminQuestionReport'

export type AdminImportValidationIssue =
  AdminImportValidationResponse['errors'][number]

export interface ImportTagRow {
  readonly id: string
  readonly label: string
  readonly normalizedName: string
}

export interface BatchTargetRow {
  readonly questionId: string
  readonly questionLifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly questionRowVersion: number
  readonly questionCreatedByUserId: string | null
  readonly versionId: string
  readonly versionStatus:
    | 'DRAFT'
    | 'IN_REVIEW'
    | 'CHANGES_REQUESTED'
    | 'APPROVED'
    | 'PUBLISHED'
    | 'RETIRED'
  readonly versionRowVersion: number
  readonly versionCreatedByUserId: string | null
}

export interface ExportQuestionRow {
  readonly id: string
  readonly lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly currentPublishedVersionId: string | null
  readonly rowVersion: number
  readonly createdByUserId: string | null
}

export interface ExportVersionRow {
  readonly id: string
  readonly questionId: string
  readonly versionNumber: number
  readonly status:
    | 'DRAFT'
    | 'IN_REVIEW'
    | 'CHANGES_REQUESTED'
    | 'APPROVED'
    | 'PUBLISHED'
    | 'RETIRED'
  readonly rowVersion: number
  readonly createdByUserId: string | null
  readonly level: AdminQuestionContentStructureInput['level']
  readonly subject: AdminQuestionContentStructureInput['subject']
  readonly questionType: AdminQuestionContentStructureInput['questionType']
  readonly difficulty: AdminQuestionContentStructureInput['difficulty']
  readonly passage: string | null
  readonly questionText: string
  readonly explanationKo: string
  readonly explanationJa: string | null
  readonly correctOptionId: string
}

export type ExportVersionManifestRow = Pick<
  ExportVersionRow,
  'id' | 'questionId' | 'versionNumber' | 'status' | 'rowVersion'
>

export interface ExportOptionRow {
  readonly id: string
  readonly questionVersionId: string
  readonly ordinal: number
  readonly text: string
}

export interface ExportTagRow {
  readonly id: string
  readonly questionVersionId: string
  readonly label: string
  readonly normalizedName: string
}

export interface ExportReviewUserRow {
  readonly userId: string
}

export interface ExportRetainedManifestRow {
  readonly questionId: string
  readonly versionCount: bigint
  readonly maxVersionNumber: number
  readonly orderedVersionIds: string[]
}

export interface ExportTimestampRow {
  readonly exportedAt: Date
}

export interface ExportAuditReconciliationRow {
  readonly operationId: string
  readonly command: string
  readonly targetType: string
  readonly targetId: string
  readonly actorId: string | null
  readonly requestId: string
  readonly environment: string
  readonly changedFields: unknown
  readonly metadata: unknown
  readonly contentDigest: string
  readonly occurredAt: Date
}

export interface AuditDigestRow {
  readonly contentDigest: string
}

export interface ReportTargetRow {
  readonly id: string
  readonly questionId: string
  readonly questionVersionId: string
  readonly status: 'OPEN' | 'TRIAGED' | 'RESOLVED' | 'DISMISSED'
  readonly rowVersion: number
  readonly reporterUserId: string | null
  readonly assigneeUserId: string | null
  readonly questionLifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly questionRowVersion: number
  readonly questionCreatedByUserId: string | null
  readonly versionStatus: BatchTargetRow['versionStatus']
  readonly versionRowVersion: number
  readonly versionNumber: number
  readonly versionCreatedByUserId: string | null
}

export interface RemediationTargetRow {
  readonly id: string
  readonly questionId: string
  readonly status: BatchTargetRow['versionStatus']
  readonly rowVersion: number
  readonly versionNumber: number
  readonly retirementKind:
    | 'PUBLISHED_RETIREMENT'
    | 'AUTHOR_ERASURE_ABANDONED'
    | 'QUESTION_ARCHIVE_ABANDONED'
    | null
  readonly publishedAt: Date | null
  readonly createdByUserId: string | null
}

export interface ReportMutationRow {
  readonly id: string
  readonly questionId: string
  readonly questionVersionId: string
  readonly status: 'OPEN' | 'TRIAGED' | 'RESOLVED' | 'DISMISSED'
  readonly rowVersion: number
  readonly assigneeActorId: string | null
  readonly assigneeRole: 'ADMIN' | null
  readonly assigneeLabel: 'ACTIVE_ADMIN' | 'DELETED_ADMIN' | null
  readonly resolutionOutcome: 'RESOLVED' | 'DISMISSED' | null
  readonly resolutionReason: string | null
  readonly remediationVersionId: string | null
  readonly resolvedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export const EXPORT_BODY_CAP = 8 * 1024 * 1024
export const EXPORT_VERSION_BATCH_SIZE = 25
export const FRESH_OPERATIONS = new Set<WorkflowTransactionalOperation>([
  'requestContentReviewBatch',
  'applyQuestionImport',
  'exportAdminQuestions',
  'resolveAdminQuestionReport'
])
export const classifyAuthorityFailure =
  createAuthorityFailureClassifier(FRESH_OPERATIONS)
export const sha256Port: Sha256TextPort = {
  digestUtf8: async (value) =>
    createHash('sha256').update(value, 'utf8').digest('hex')
}

export interface AdminQuestionExportAuditEvidence {
  readonly selectionDigest: string
  readonly responseBodyDigest: string
  readonly questionCount: number
  readonly versionCount: number
}
