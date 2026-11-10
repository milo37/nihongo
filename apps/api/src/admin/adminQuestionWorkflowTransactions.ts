import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  type AuditEnvironment,
  rawDatabaseIdentity,
  adminAuditContentDigest,
  assertReviewRequestAuthor,
  type AdminAuditDigestFields
} from './adminRepositoryCommon.js'
import { type ArmableOperation } from './adminOperationArm.js'
import { beginAdminOperation } from './adminOperationAuthority.js'
import { operatorActorOf } from './operatorAdminAuthority.js'
import {
  AdminQuestionCommandRepositoryError,
  type AdminCommandAuthority
} from './adminQuestionCommandRepository.js'

import {
  type WorkflowTransactionalOperation,
  type BatchTargetRow,
  type AuditDigestRow,
  FRESH_OPERATIONS,
  classifyAuthorityFailure
} from './adminQuestionWorkflowModel.js'

export const repositoryInvariantFailure = (
  message: string,
  cause?: unknown
): AdminQuestionCommandRepositoryError =>
  new AdminQuestionCommandRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message,
    disposition: 'NO_TX',
    ...(cause === undefined ? {} : { cause })
  })

export const rawSqlState = (error: unknown): string | undefined => {
  const identity = rawDatabaseIdentity(error)
  if (identity) return identity.sqlState
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  ) {
    return '40001'
  }
  return undefined
}

export const isSerializationFailure = (error: unknown): boolean =>
  ['40001', '40P01'].includes(rawSqlState(error) ?? '') ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034')

export const beginOperation = async (
  transaction: Prisma.TransactionClient,
  input: {
    readonly auditEnvironment: AuditEnvironment
    readonly authority: AdminCommandAuthority
    readonly command: string
    readonly referencedUserIds: readonly string[]
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
    throw repositoryInvariantFailure(
      'Operation actor did not match the request actor.'
    )
  }
  return {
    ...operation,
    command: input.command,
    referencedUserIds: input.referencedUserIds
  }
}

export type AuditMetadata =
  | { readonly kind: 'NONE_V1' }
  | { readonly kind: 'REVIEW_REQUEST_BATCH_V1'; readonly itemCount: number }
  | {
      readonly kind: 'IMPORT_APPLY_V1'
      readonly validationDigest: string
      readonly mappingDigest: string
      readonly itemCount: number
    }
  | {
      readonly kind: 'EXPORT_V1'
      readonly selectionDigest: string
      readonly responseBodyDigest: string
      readonly questionCount: number
      readonly versionCount: number
    }

export const insertAudit = async (
  transaction: Prisma.TransactionClient,
  input: {
    readonly actorId: string
    readonly afterRowVersion: number | null
    readonly afterState: string | null
    readonly beforeRowVersion: number | null
    readonly beforeState: string | null
    readonly changedFields: readonly string[]
    readonly command: string
    readonly environment: AuditEnvironment
    readonly occurredAt: Date
    readonly operationId: string
    readonly requestId: string
    readonly targetId: string
    readonly targetType:
      | 'QUESTION'
      | 'QUESTION_VERSION'
      | 'QUESTION_REPORT'
      | 'REVIEW_REQUEST_BATCH'
      | 'IMPORT_REQUEST'
      | 'EXPORT_REQUEST'
    readonly metadata?: AuditMetadata
  }
): Promise<string> => {
  const changedFields = JSON.stringify(input.changedFields)
  const metadata = JSON.stringify(input.metadata ?? { kind: 'NONE_V1' })
  const rows = await transaction.$queryRawUnsafe<AuditDigestRow[]>(
    `INSERT INTO "AdminAuditLog" (
       "command", "targetType", "targetId", "actorKind",
       "actorUserId", "actorId", "actorRole", "actorLabel",
       "beforeState", "afterState", "beforeRowVersion", "afterRowVersion",
       "changedFields", "metadata", "contentDigest", "operationId",
       "requestId", "environment", "occurredAt"
     ) VALUES (
       $1::"AdminAuditCommand", $2::"AdminAuditTargetType", $3, 'ACCOUNT',
       $4, $4, 'ADMIN', 'ACTIVE_ADMIN', $5::text, $6::text, $7, $8,
       $9::jsonb, $10::jsonb, $15, $11, $12, $13::"AdminAuditEnvironment", $14
     ) RETURNING "contentDigest"`,
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
  const contentDigest = rows[0]?.contentDigest
  if (
    rows.length !== 1 ||
    typeof contentDigest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(contentDigest)
  ) {
    throw repositoryInvariantFailure(
      'Admin audit content digest is unavailable.'
    )
  }
  return contentDigest
}

export const insertReview = async (
  transaction: Prisma.TransactionClient,
  input: {
    readonly actorId: string
    readonly comment: string | null
    readonly fromState: BatchTargetRow['versionStatus']
    readonly occurredAt: Date
    readonly operationId: string
    readonly questionId: string
    readonly requestId: string
    readonly versionId: string
  }
): Promise<void> => {
  await assertReviewRequestAuthor(transaction, input.versionId, input.actorId)
  await transaction.$executeRawUnsafe(
    `INSERT INTO "ContentReview" (
       "questionId", "questionVersionId", "action", "fromState", "toState",
       "actorKind", "actorUserId", "actorId", "actorRole", "actorLabel",
       "counterpartUserId", "counterpartActorId", "counterpartRole",
       "counterpartLabel", "reason", "comment", "operationId", "requestId",
       "occurredAt"
     ) VALUES (
       $1, $2, 'REQUESTED', $3::"QuestionVersionStatus", 'IN_REVIEW',
       'ACCOUNT', $4, $4, 'ADMIN', 'ACTIVE_ADMIN', NULL, NULL, NULL, NULL,
       NULL, $5, $6, $7, $8
     )`,
    input.questionId,
    input.versionId,
    input.fromState,
    input.actorId,
    input.comment,
    input.operationId,
    input.requestId,
    input.occurredAt
  )
}

export const mapTransactionError = (
  operation: WorkflowTransactionalOperation,
  error: unknown
): AdminQuestionCommandRepositoryError => {
  if (error instanceof AdminQuestionCommandRepositoryError) {
    return new AdminQuestionCommandRepositoryError({
      code: error.code,
      message: error.message,
      disposition: 'DEFINITE_ROLLBACK',
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      ...(error.internalReason ? { internalReason: error.internalReason } : {}),
      ...(error.retryAfterSeconds
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
      cause: error
    })
  }
  const identity = rawDatabaseIdentity(error)
  const sqlState = rawSqlState(error)
  if (sqlState === '40001' || sqlState === '40P01') {
    if (
      [
        'requestContentReviewBatch',
        'triageAdminQuestionReport',
        'resolveAdminQuestionReport'
      ].includes(operation) &&
      (identity?.message === 'Question target changed before arm.' ||
        identity?.message === 'QuestionVersion target changed before arm.' ||
        identity?.message === 'QuestionReport target changed before arm.')
    ) {
      return new AdminQuestionCommandRepositoryError({
        code: 'VERSION_CONFLICT',
        message:
          '다른 요청이 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: error
      })
    }
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '동시 요청을 안전하게 확정할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    identity.message === 'Cross-question canonical duplicate is forbidden.' &&
    operation === 'applyQuestionImport'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '동시 콘텐츠 중복으로 import를 확정하지 못했습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    [
      'Admin content command requires an ACTIVE Question.',
      'REVIEW_REQUEST_BATCH target state is invalid.',
      'QuestionReport command manifest is not canonical.',
      'Invalid QuestionReport transition.'
    ].includes(identity.message)
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'INVALID_STATE_TRANSITION',
      message: '현재 상태에서는 요청한 전이를 수행할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    identity.message ===
      'QuestionReport remediation must be later published lineage.'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'RESOURCE_NOT_FOUND',
      message: '사용할 수 있는 조치 버전을 찾을 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '42501' &&
    identity.message === 'Authority expired before commit.'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: FRESH_OPERATIONS.has(operation)
        ? 'FRESH_ASSURANCE_REQUIRED'
        : 'AUTH_SESSION_EXPIRED',
      message: '관리자 세션 권한을 다시 확인해 주세요.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    sqlState !== undefined &&
    (['55P03', '57014'].includes(sqlState) ||
      ['22', '23', '25', '2D', '40', '42'].some((prefix) =>
        sqlState.startsWith(prefix)
      ))
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '관리자 명령을 안전하게 완료할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P1001', 'P1002', 'P2024'].includes(error.code))
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '관리자 명령 결과를 확인할 수 없습니다.',
      disposition: 'COMMIT_UNKNOWN',
      cause: error
    })
  }
  return new AdminQuestionCommandRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message: '관리자 명령 결과를 확인할 수 없습니다.',
    disposition: 'COMMIT_UNKNOWN',
    cause: error
  })
}

export const executeTransaction = async <Result>(
  client: PrismaClient,
  operation: WorkflowTransactionalOperation,
  authority: AdminCommandAuthority,
  action: () => Promise<Result>,
  callbackCompleted: () => boolean
): Promise<Result> => {
  try {
    return await action()
  } catch (error: unknown) {
    const authorityFailure = await classifyAuthorityFailure(
      client,
      operation,
      authority,
      error
    )
    if (authorityFailure) throw authorityFailure
    const mapped = mapTransactionError(operation, error)
    if (!callbackCompleted() && mapped.disposition === 'COMMIT_UNKNOWN') {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 명령 트랜잭션을 완료하지 못했습니다.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: error
      })
    }
    throw mapped
  }
}
