import { type AdminQuestionMutationResult } from '@nihongo/contracts/admin/content-operations'
import { Prisma } from '../generated/prisma/client.js'
import {
  type AuditEnvironment,
  type TargetManifest,
  type OperationContext,
  toIso,
  adminAuditContentDigest,
  assertReviewRequestAuthor,
  type AdminAuditDigestFields
} from './adminRepositoryCommon.js'
import {
  armAdminOperation,
  type ArmableOperation
} from './adminOperationArm.js'
import { beginAdminOperation } from './adminOperationAuthority.js'
import { operatorActorOf } from './operatorAdminAuthority.js'

import {
  type QuestionVersionStatus,
  type AdminCommandAuthority,
  type VersionTargetRow,
  type LifecycleVersionTargetRow,
  type EvidenceAccountSnapshot
} from './adminQuestionCommandModel.js'

export const toAuthorSnapshot = (
  version: Pick<
    LifecycleVersionTargetRow,
    | 'createdByUserId'
    | 'createdByActorId'
    | 'createdByRoleSnapshot'
    | 'createdByLabelSnapshot'
  >
): EvidenceAccountSnapshot | null =>
  version.createdByActorId !== null &&
  version.createdByRoleSnapshot === 'ADMIN' &&
  version.createdByLabelSnapshot !== 'SYSTEM_SEED'
    ? {
        userId: version.createdByUserId,
        actorId: version.createdByActorId,
        role: version.createdByRoleSnapshot,
        label: version.createdByLabelSnapshot
      }
    : null

export const toLatestApproverSnapshot = (
  target: VersionTargetRow
): EvidenceAccountSnapshot | null =>
  target.latestApproverActorId !== null &&
  target.latestApproverRole === 'ADMIN' &&
  target.latestApproverLabel !== null
    ? {
        userId: target.latestApproverUserId,
        actorId: target.latestApproverActorId,
        role: target.latestApproverRole,
        label: target.latestApproverLabel
      }
    : null

export const toResult = (input: {
  questionId: string
  versionId: string
  questionRowVersion: number
  versionRowVersion: number
  versionStatus: QuestionVersionStatus
  occurredAt: Date
}): AdminQuestionMutationResult => ({
  questionId: input.questionId,
  questionVersionId: input.versionId,
  lifecycleStatus: 'ACTIVE',
  versionStatus: input.versionStatus,
  questionRowVersion: input.questionRowVersion,
  versionRowVersion: input.versionRowVersion,
  occurredAt: toIso(input.occurredAt)
})

export const toArchiveResult = (input: {
  occurredAt: Date
  questionId: string
  questionRowVersion: number
}): AdminQuestionMutationResult => ({
  questionId: input.questionId,
  questionVersionId: null,
  lifecycleStatus: 'ARCHIVED',
  versionStatus: null,
  questionRowVersion: input.questionRowVersion,
  versionRowVersion: null,
  occurredAt: toIso(input.occurredAt)
})

export const beginOperation = async (
  transaction: Prisma.TransactionClient,
  input: {
    auditEnvironment: AuditEnvironment
    authority: AdminCommandAuthority
    command: string
    referencedUserIds: string[]
  }
): Promise<ArmableOperation> => {
  const operation = await beginAdminOperation(transaction, {
    auditEnvironment: input.auditEnvironment,
    command: input.command,
    operatorActorId: operatorActorOf(input.authority),
    rawSessionToken: input.authority.rawSessionToken,
    referencedUserIds: input.referencedUserIds
  })
  if (!operation || operation.actorUserId !== input.authority.actorId) {
    throw new Error('Operation actor did not match the request actor.')
  }
  return {
    ...operation,
    command: input.command,
    referencedUserIds: input.referencedUserIds
  }
}

export const armOperation = async (
  transaction: Prisma.TransactionClient,
  operation: ArmableOperation,
  targetManifest: TargetManifest
): Promise<OperationContext> => ({
  actorUserId: operation.actorUserId,
  operationId: operation.operationId,
  occurredAt: await armAdminOperation(transaction, operation, targetManifest)
})

export const beginAndArm = async (
  transaction: Prisma.TransactionClient,
  input: {
    auditEnvironment: AuditEnvironment
    authority: AdminCommandAuthority
    command: string
    referencedUserIds: string[]
    targetManifest: TargetManifest
  }
): Promise<OperationContext> => {
  const operation = await beginOperation(transaction, input)
  return armOperation(transaction, operation, input.targetManifest)
}

export const insertAudit = async (
  transaction: Prisma.TransactionClient,
  input: {
    actorId: string
    afterRowVersion: number | null
    afterState: string | null
    beforeRowVersion: number | null
    beforeState: string | null
    changedFields: readonly string[]
    command: string
    environment: AuditEnvironment
    occurredAt: Date
    operationId: string
    requestId: string
    targetId: string
    targetType: 'QUESTION' | 'QUESTION_VERSION'
    metadata?:
      | { kind: 'NONE_V1' }
      | {
          kind: 'QUESTION_ARCHIVE_V1'
          retiredPublishedCount: 0 | 1
          abandonedCandidateCount: 0 | 1
        }
  }
): Promise<void> => {
  const changedFields = JSON.stringify(input.changedFields)
  const metadata = JSON.stringify(input.metadata ?? { kind: 'NONE_V1' })
  await transaction.$executeRawUnsafe(
    `INSERT INTO "AdminAuditLog" (
       "command", "targetType", "targetId", "actorKind",
       "actorUserId", "actorId", "actorRole", "actorLabel",
       "beforeState", "afterState", "beforeRowVersion", "afterRowVersion",
       "changedFields", "metadata", "contentDigest", "operationId",
       "requestId", "environment", "occurredAt"
     ) VALUES (
       $1::"AdminAuditCommand", $2::"AdminAuditTargetType", $3, 'ACCOUNT',
       $4, $4, 'ADMIN', 'ACTIVE_ADMIN', $5::text, $6::text, $7, $8, $9::jsonb,
       $10::jsonb, $15, $11, $12, $13::"AdminAuditEnvironment", $14
     )`,
    input.command,
    input.targetType,
    input.targetId,
    input.actorId,
    input.beforeState,
    input.afterState,
    input.beforeRowVersion,
    input.afterRowVersion,
    changedFields,
    metadata,
    input.operationId,
    input.requestId,
    input.environment,
    input.occurredAt,
    adminAuditContentDigest({
      operationId: input.operationId,
      command: input.command as AdminAuditDigestFields['command'],
      targetType: input.targetType,
      targetId: input.targetId,
      beforeState: input.beforeState as AdminAuditDigestFields['beforeState'],
      afterState: input.afterState as AdminAuditDigestFields['afterState'],
      beforeRowVersion: input.beforeRowVersion,
      afterRowVersion: input.afterRowVersion,
      changedFields:
        input.changedFields as AdminAuditDigestFields['changedFields'],
      metadata: (input.metadata ?? {
        kind: 'NONE_V1'
      }) as AdminAuditDigestFields['metadata']
    })
  )
}

export const insertReview = async (
  transaction: Prisma.TransactionClient,
  input: {
    action: string
    actorId: string
    comment: string | null
    counterpart: EvidenceAccountSnapshot | null
    fromState: QuestionVersionStatus
    occurredAt: Date
    operationId: string
    questionId: string
    reason: string | null
    requestId: string
    toState: QuestionVersionStatus
    versionId: string
  }
): Promise<void> => {
  if (input.action === 'REQUESTED') {
    await assertReviewRequestAuthor(transaction, input.versionId, input.actorId)
  }
  await transaction.$executeRawUnsafe(
    `INSERT INTO "ContentReview" (
       "questionId", "questionVersionId", "action", "fromState", "toState",
       "actorKind", "actorUserId", "actorId", "actorRole", "actorLabel",
       "counterpartUserId", "counterpartActorId", "counterpartRole",
       "counterpartLabel", "reason", "comment", "operationId", "requestId",
       "occurredAt"
     ) VALUES (
       $1, $2, $3::"ContentReviewAction", $4::"QuestionVersionStatus",
       $5::"QuestionVersionStatus", 'ACCOUNT', $6, $6, 'ADMIN',
       'ACTIVE_ADMIN', $7, $8, $9::"UserRole", $10::"AccountActorLabel",
       $11, $12, $13, $14, $15
     )`,
    input.questionId,
    input.versionId,
    input.action,
    input.fromState,
    input.toState,
    input.actorId,
    input.counterpart?.userId ?? null,
    input.counterpart?.actorId ?? null,
    input.counterpart?.role ?? null,
    input.counterpart?.label ?? null,
    input.reason,
    input.comment,
    input.operationId,
    input.requestId,
    input.occurredAt
  )
}
