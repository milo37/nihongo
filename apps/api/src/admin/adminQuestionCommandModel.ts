import { type CreateAdminQuestionRequest } from '@nihongo/contracts/admin/content-operations'

export type ContentOperation =
  | 'createAdminQuestion'
  | 'createAdminQuestionVersion'
  | 'updateQuestionVersion'
export type LifecycleOperation =
  | 'requestContentReview'
  | 'requestQuestionChanges'
  | 'approveQuestionVersion'
  | 'withdrawQuestionApproval'
export type PublicationOperation =
  | 'publishQuestionVersion'
  | 'retireQuestionVersion'
  | 'archiveAdminQuestion'
export type AdminQuestionDomainOperation =
  | ContentOperation
  | LifecycleOperation
  | PublicationOperation
export type QuestionVersionStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'RETIRED'

export interface AdminCommandAuthority {
  readonly actorId: string
  readonly rawSessionToken: string
  readonly requestId: string
}

export interface TagRow {
  id: string
  label: string
  normalizedName: string
}

export interface QuestionTargetRow {
  id: string
  lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  rowVersion: number
  currentPublishedVersionId: string | null
  createdByUserId: string | null
  maximumVersionNumber: number
  hasOpenCandidate: boolean
}

export interface VersionTargetRow {
  questionId: string
  questionLifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  questionRowVersion: number
  questionCurrentPublishedVersionId: string | null
  questionCreatedByUserId: string | null
  versionId: string
  versionNumber: number
  versionStatus: QuestionVersionStatus
  versionRowVersion: number
  versionCreatedByUserId: string | null
  versionCreatedByActorId: string | null
  versionCreatedByRoleSnapshot: 'ADMIN' | null
  versionCreatedByLabelSnapshot:
    | 'ACTIVE_ADMIN'
    | 'DELETED_ADMIN'
    | 'SYSTEM_SEED'
  latestApproverUserId: string | null
  latestApproverActorId: string | null
  latestApproverRole: 'ADMIN' | null
  latestApproverLabel: 'ACTIVE_ADMIN' | 'DELETED_ADMIN' | null
  contentFingerprint: string
  isPinned: boolean
  level: CreateAdminQuestionRequest['level']
  subject: CreateAdminQuestionRequest['subject']
  questionType: CreateAdminQuestionRequest['questionType']
  difficulty: CreateAdminQuestionRequest['difficulty']
  passage: string | null
  questionText: string
  explanationKo: string
  explanationJa: string | null
  correctOptionId: string
}

export interface LifecycleVersionTargetRow {
  id: string
  questionId: string
  status: QuestionVersionStatus
  rowVersion: number
  createdByUserId: string | null
  createdByActorId: string | null
  createdByRoleSnapshot: 'ADMIN' | null
  createdByLabelSnapshot: 'ACTIVE_ADMIN' | 'DELETED_ADMIN' | 'SYSTEM_SEED'
  contentFingerprint: string
}

export interface EvidenceAccountSnapshot {
  userId: string | null
  actorId: string
  role: 'ADMIN'
  label: 'ACTIVE_ADMIN' | 'DELETED_ADMIN'
}

export interface OptionRow {
  id: string
  label: string
  ordinal: number
  text: string
}

export interface VersionTagRow extends TagRow {
  assignmentId: string
}

export const UPDATE_CHANGED_FIELD_ORDER = [
  'LEVEL',
  'SUBJECT',
  'QUESTION_TYPE',
  'DIFFICULTY',
  'PASSAGE',
  'QUESTION_TEXT',
  'EXPLANATION_KO',
  'EXPLANATION_JA',
  'OPTIONS',
  'CORRECT_OPTION',
  'TAGS'
] as const

export const CONTENT_OPERATIONS = new Set<AdminQuestionDomainOperation>([
  'createAdminQuestion',
  'createAdminQuestionVersion',
  'updateQuestionVersion',
  'publishQuestionVersion'
])
export const FRESH_OPERATIONS = new Set<AdminQuestionDomainOperation>([
  'approveQuestionVersion',
  'withdrawQuestionApproval',
  'publishQuestionVersion',
  'retireQuestionVersion',
  'archiveAdminQuestion'
])
