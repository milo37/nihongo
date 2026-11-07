import { randomUUID } from 'node:crypto'
import {
  type ArchiveAdminQuestionRequest,
  type AdminQuestionMutationResult,
  type ApproveQuestionVersionRequest,
  type CreateAdminQuestionRequest,
  type CreateAdminQuestionVersionRequest,
  type PublishQuestionVersionRequest,
  type RequestContentReviewRequest,
  type RequestQuestionChangesRequest,
  type RetireQuestionVersionRequest,
  type UpdateQuestionVersionRequest,
  type WithdrawQuestionApprovalRequest
} from '@nihongo/contracts/admin/content-operations'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  type AuditEnvironment,
  type TargetManifest,
  CREATE_CHANGED_FIELDS,
  uniqueSorted,
  finishOperation,
  assertEditableUnpinnedVersion,
  assertVersionAuthor
} from './adminRepositoryCommon.js'

import {
  type LifecycleOperation,
  type QuestionVersionStatus,
  type AdminCommandAuthority,
  type TagRow,
  type QuestionTargetRow,
  type VersionTargetRow,
  type LifecycleVersionTargetRow,
  type OptionRow,
  type VersionTagRow
} from './adminQuestionCommandModel.js'
import {
  AdminQuestionCommandRepositoryError,
  repositoryFailure,
  mapTransactionError,
  mapPreflightError,
  isSerializationFailure,
  duplicateRaceFailure,
  postRollbackVersionConflict,
  postRollbackImmutableVersion,
  classifyAuthorityFailure
} from './adminQuestionCommandFailures.js'
import {
  hasCrossQuestionDuplicate,
  hasCrossQuestionFingerprintDuplicate,
  assertNoVisibleCrossQuestionDuplicate,
  resolveTags,
  loadQuestionTarget,
  loadVersionTarget,
  loadLifecycleVersions,
  loadOptions,
  loadVersionTags,
  createVersionContent,
  computeUpdateChangedFields,
  validateUpdate
} from './adminQuestionCommandContent.js'
import {
  toAuthorSnapshot,
  toLatestApproverSnapshot,
  toResult,
  toArchiveResult,
  beginOperation,
  armOperation,
  beginAndArm,
  insertAudit,
  insertReview
} from './adminQuestionCommandEvidence.js'

export type { AdminCommandAuthority } from './adminQuestionCommandModel.js'
export {
  AdminQuestionCommandRepositoryError,
  createAuthorityFailureClassifier,
  repositoryFailure
} from './adminQuestionCommandFailures.js'
export { armOperation } from './adminQuestionCommandEvidence.js'

interface TransitionConfig {
  action: 'REQUESTED' | 'CHANGES_REQUESTED' | 'APPROVED' | 'APPROVAL_WITHDRAWN'
  command:
    | 'REVIEW_REQUEST'
    | 'CHANGE_REQUEST'
    | 'APPROVAL'
    | 'APPROVAL_WITHDRAWAL'
  fromStates: readonly QuestionVersionStatus[]
  toState: 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED'
  authorOnly: boolean
  /** JLP-704: a single operator may decide on their own version. */
  selfDecisionAllowed: boolean
}

const transitionConfigByOperation: Readonly<
  Record<LifecycleOperation, TransitionConfig>
> = {
  requestContentReview: {
    action: 'REQUESTED',
    command: 'REVIEW_REQUEST',
    fromStates: ['DRAFT', 'CHANGES_REQUESTED'],
    toState: 'IN_REVIEW',
    authorOnly: true,
    selfDecisionAllowed: false
  },
  requestQuestionChanges: {
    action: 'CHANGES_REQUESTED',
    command: 'CHANGE_REQUEST',
    fromStates: ['IN_REVIEW'],
    toState: 'CHANGES_REQUESTED',
    authorOnly: false,
    selfDecisionAllowed: false
  },
  approveQuestionVersion: {
    action: 'APPROVED',
    command: 'APPROVAL',
    fromStates: ['IN_REVIEW'],
    toState: 'APPROVED',
    authorOnly: false,
    selfDecisionAllowed: true
  },
  withdrawQuestionApproval: {
    action: 'APPROVAL_WITHDRAWN',
    command: 'APPROVAL_WITHDRAWAL',
    fromStates: ['APPROVED'],
    toState: 'CHANGES_REQUESTED',
    authorOnly: false,
    selfDecisionAllowed: true
  }
}

type TransitionRequest =
  | RequestContentReviewRequest
  | RequestQuestionChangesRequest
  | ApproveQuestionVersionRequest
  | WithdrawQuestionApprovalRequest

export interface AdminQuestionCommandRepository {
  createQuestion: (
    authority: AdminCommandAuthority,
    request: CreateAdminQuestionRequest
  ) => Promise<AdminQuestionMutationResult>
  createVersion: (
    authority: AdminCommandAuthority,
    questionId: string,
    request: CreateAdminQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  updateVersion: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: UpdateQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  transitionVersion: (
    operation: LifecycleOperation,
    authority: AdminCommandAuthority,
    versionId: string,
    request: TransitionRequest
  ) => Promise<AdminQuestionMutationResult>
}

export interface AdminQuestionPublicationCommandRepository {
  publishVersion: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: PublishQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  retireVersion: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: RetireQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  archiveQuestion: (
    authority: AdminCommandAuthority,
    questionId: string,
    request: ArchiveAdminQuestionRequest
  ) => Promise<AdminQuestionMutationResult>
  /** Current question row version for a batch item; null if the version is missing. */
  readPublicationTarget: (versionId: string) => Promise<{
    readonly questionRowVersion: number
    readonly versionStatus: string
  } | null>
}

type AdminQuestionPreparedCommandRepository = AdminQuestionCommandRepository &
  AdminQuestionPublicationCommandRepository

interface AdminQuestionCommandRepositoryOptions {
  readonly auditEnvironment: AuditEnvironment
  readonly client: PrismaClient
}

const createPrismaAdminQuestionCommandRepositoryInternal = (
  { auditEnvironment, client }: AdminQuestionCommandRepositoryOptions,
  includePublication: boolean
): AdminQuestionCommandRepository | AdminQuestionPreparedCommandRepository => {
  const createQuestion: AdminQuestionCommandRepository['createQuestion'] =
    async (authority, request) => {
      let tags: TagRow[]
      const questionId = randomUUID()
      const versionId = randomUUID()
      try {
        tags = await resolveTags(client, request)
        await assertNoVisibleCrossQuestionDuplicate(client, questionId, request)
      } catch (error: unknown) {
        throw mapPreflightError(error)
      }
      try {
        return await client.$transaction(
          async (transaction) => {
            const operation = await beginAndArm(transaction, {
              auditEnvironment,
              authority,
              command: 'QUESTION_CREATE',
              referencedUserIds: [authority.actorId],
              targetManifest: {
                questions: [],
                versions: [],
                reports: [],
                tags: tags.map((tag) => tag.id).sort()
              }
            })
            const lockedTags = await resolveTags(transaction, request)
            await transaction.$executeRawUnsafe(
              `INSERT INTO "Question" (
                 "id", "createdByUserId", "createdByActorId",
                 "createdByRoleSnapshot", "createdByLabelSnapshot",
                 "createdAt", "updatedAt"
               ) VALUES ($1, $2, $2, 'ADMIN', 'ACTIVE_ADMIN', $3, $3)`,
              questionId,
              authority.actorId,
              operation.occurredAt
            )
            await createVersionContent(transaction, {
              actorId: authority.actorId,
              content: request,
              occurredAt: operation.occurredAt,
              questionId,
              tags: lockedTags,
              versionId,
              versionNumber: 1
            })
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: 1,
              afterState: 'ACTIVE',
              beforeRowVersion: null,
              beforeState: null,
              changedFields: CREATE_CHANGED_FIELDS,
              command: 'QUESTION_CREATE',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: questionId,
              targetType: 'QUESTION'
            })
            await finishOperation(transaction, operation.operationId)
            return toResult({
              questionId,
              versionId,
              questionRowVersion: 1,
              versionRowVersion: 1,
              versionStatus: 'DRAFT',
              occurredAt: operation.occurredAt
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        )
      } catch (error: unknown) {
        const authorityFailure = await classifyAuthorityFailure(
          client,
          'createAdminQuestion',
          authority,
          error
        )
        if (authorityFailure) throw authorityFailure
        const mapped = mapTransactionError('createAdminQuestion', error)
        if (isSerializationFailure(error)) {
          let duplicate = false
          try {
            duplicate = await hasCrossQuestionDuplicate(
              client,
              questionId,
              request
            )
          } catch {
            // Keep the original, definite rollback classification when the
            // authoritative post-check is itself unavailable.
          }
          if (duplicate) throw duplicateRaceFailure(error)
        }
        throw mapped
      }
    }

  const createVersion: AdminQuestionCommandRepository['createVersion'] = async (
    authority,
    questionId,
    request
  ) => {
    let target: QuestionTargetRow | null
    let tags: TagRow[]
    try {
      target = await loadQuestionTarget(client, questionId)
      if (!target) {
        throw repositoryFailure(
          'RESOURCE_NOT_FOUND',
          '관리자 문제를 찾을 수 없습니다.'
        )
      }
      if (target.rowVersion !== request.expectedQuestionRowVersion) {
        throw repositoryFailure(
          'VERSION_CONFLICT',
          '다른 요청이 먼저 문제를 변경했습니다.'
        )
      }
      if (target.lifecycleStatus !== 'ACTIVE' || target.hasOpenCandidate) {
        throw repositoryFailure(
          'INVALID_STATE_TRANSITION',
          '현재 문제 상태에서는 새 버전을 만들 수 없습니다.'
        )
      }
      tags = await resolveTags(client, request)
      await assertNoVisibleCrossQuestionDuplicate(client, questionId, request)
    } catch (error: unknown) {
      throw mapPreflightError(error)
    }
    const versionId = randomUUID()
    try {
      return await client.$transaction(
        async (transaction) => {
          const operation = await beginAndArm(transaction, {
            auditEnvironment,
            authority,
            command: 'QUESTION_VERSION_CREATE',
            referencedUserIds: uniqueSorted([
              authority.actorId,
              target.createdByUserId
            ]),
            targetManifest: {
              questions: [
                {
                  id: questionId,
                  rowVersion: target.rowVersion,
                  state: target.lifecycleStatus
                }
              ],
              versions: [],
              reports: [],
              tags: tags.map((tag) => tag.id).sort()
            }
          })
          const lockedTags = await resolveTags(transaction, request)
          await transaction.$executeRawUnsafe(
            `UPDATE "Question" SET "rowVersion" = $2, "updatedAt" = $3
               WHERE "id" = $1`,
            questionId,
            target.rowVersion + 1,
            operation.occurredAt
          )
          await createVersionContent(transaction, {
            actorId: authority.actorId,
            content: request,
            occurredAt: operation.occurredAt,
            questionId,
            tags: lockedTags,
            versionId,
            versionNumber: target.maximumVersionNumber + 1
          })
          await insertAudit(transaction, {
            actorId: authority.actorId,
            afterRowVersion: 1,
            afterState: 'DRAFT',
            beforeRowVersion: null,
            beforeState: null,
            changedFields: [
              'VERSION_STATUS',
              ...CREATE_CHANGED_FIELDS.filter(
                (field) => field !== 'LIFECYCLE_STATUS'
              )
            ],
            command: 'QUESTION_VERSION_CREATE',
            environment: auditEnvironment,
            occurredAt: operation.occurredAt,
            operationId: operation.operationId,
            requestId: authority.requestId,
            targetId: versionId,
            targetType: 'QUESTION_VERSION'
          })
          await finishOperation(transaction, operation.operationId)
          return toResult({
            questionId,
            versionId,
            questionRowVersion: target.rowVersion + 1,
            versionRowVersion: 1,
            versionStatus: 'DRAFT',
            occurredAt: operation.occurredAt
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (error: unknown) {
      const authorityFailure = await classifyAuthorityFailure(
        client,
        'createAdminQuestionVersion',
        authority,
        error
      )
      if (authorityFailure) throw authorityFailure
      const mapped = mapTransactionError('createAdminQuestionVersion', error)
      if (isSerializationFailure(error)) {
        try {
          const current = await loadQuestionTarget(client, questionId)
          if (
            !current ||
            current.rowVersion !== target.rowVersion ||
            current.lifecycleStatus !== target.lifecycleStatus ||
            current.hasOpenCandidate !== target.hasOpenCandidate ||
            current.maximumVersionNumber !== target.maximumVersionNumber
          ) {
            throw postRollbackVersionConflict(error)
          }
          if (await hasCrossQuestionDuplicate(client, questionId, request)) {
            throw duplicateRaceFailure(error)
          }
        } catch (postcheckError: unknown) {
          if (postcheckError instanceof AdminQuestionCommandRepositoryError) {
            throw postcheckError
          }
        }
      }
      throw mapped
    }
  }

  const updateVersion: AdminQuestionCommandRepository['updateVersion'] = async (
    authority,
    versionId,
    request
  ) => {
    let target: VersionTargetRow | null
    let options: OptionRow[]
    let existingTags: VersionTagRow[]
    let desiredTags: TagRow[]
    try {
      target = await loadVersionTarget(client, versionId)
      if (!target) {
        throw repositoryFailure(
          'RESOURCE_NOT_FOUND',
          '문제 버전을 찾을 수 없습니다.'
        )
      }
      options = await loadOptions(client, versionId)
      validateUpdate(target, options, authority, request)
      existingTags = await loadVersionTags(client, versionId)
      desiredTags = await resolveTags(client, request)
      await assertNoVisibleCrossQuestionDuplicate(
        client,
        target.questionId,
        request
      )
    } catch (error: unknown) {
      throw mapPreflightError(error)
    }
    const changedFields = computeUpdateChangedFields(
      target,
      options,
      existingTags,
      request,
      desiredTags
    )
    try {
      return await client.$transaction(
        async (transaction) => {
          const operation = await beginAndArm(transaction, {
            auditEnvironment,
            authority,
            command: 'QUESTION_VERSION_UPDATE',
            referencedUserIds: uniqueSorted([
              authority.actorId,
              target.questionCreatedByUserId,
              target.versionCreatedByUserId
            ]),
            targetManifest: {
              questions: [
                {
                  id: target.questionId,
                  rowVersion: target.questionRowVersion,
                  state: target.questionLifecycleStatus
                }
              ],
              versions: [
                {
                  id: versionId,
                  rowVersion: target.versionRowVersion,
                  state: target.versionStatus
                }
              ],
              reports: [],
              tags: desiredTags.map((tag) => tag.id).sort()
            }
          })
          await assertEditableUnpinnedVersion(transaction, versionId)
          const lockedTags = await resolveTags(transaction, request)
          const currentTags = await loadVersionTags(transaction, versionId)
          await transaction.$executeRawUnsafe(
            `SET CONSTRAINTS
                 "QuestionOption_questionVersionId_label_key",
                 "QuestionOption_questionVersionId_ordinal_key" DEFERRED`
          )
          const desiredTagIds = lockedTags.map((tag) => tag.id)
          await transaction.$executeRawUnsafe(
            `DELETE FROM "QuestionVersionTag"
               WHERE "questionVersionId" = $1
                 AND NOT ("tagId" = ANY($2::uuid[]))`,
            versionId,
            desiredTagIds
          )
          await transaction.$executeRawUnsafe(
            `UPDATE "QuestionVersion" SET
                 "level" = $2::"JlptLevel",
                 "subject" = $3::"QuestionSubject",
                 "questionType" = $4::"QuestionType",
                 "difficulty" = $5::"QuestionDifficulty",
                 "passage" = $6, "questionText" = $7,
                 "explanationKo" = $8, "explanationJa" = $9,
                 "correctOptionId" = $10, "rowVersion" = $11,
                 "updatedAt" = $12
               WHERE "id" = $1`,
            versionId,
            request.level,
            request.subject,
            request.questionType,
            request.difficulty,
            request.passage,
            request.questionText,
            request.explanationKo,
            request.explanationJa,
            request.correctOptionId,
            target.versionRowVersion + 1,
            operation.occurredAt
          )
          for (const option of request.options) {
            const updated = await transaction.$executeRawUnsafe(
              `UPDATE "QuestionOption"
                 SET "label" = $3, "text" = $4, "ordinal" = $5
                 WHERE "questionVersionId" = $1 AND "id" = $2`,
              versionId,
              option.id,
              String(option.ordinal),
              option.text,
              option.ordinal
            )
            if (updated !== 1) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '문제 보기 구성이 변경되었습니다.'
              )
            }
          }
          const currentTagIds = new Set(currentTags.map((tag) => tag.id))
          for (const tag of lockedTags) {
            if (!currentTagIds.has(tag.id)) {
              await transaction.$executeRawUnsafe(
                `INSERT INTO "QuestionVersionTag" ("id", "questionVersionId", "tagId")
                   VALUES ($1, $2, $3)`,
                randomUUID(),
                versionId,
                tag.id
              )
            }
          }
          await assertVersionAuthor(
            transaction,
            versionId,
            operation.actorUserId
          )
          await insertAudit(transaction, {
            actorId: authority.actorId,
            afterRowVersion: target.versionRowVersion + 1,
            afterState: target.versionStatus,
            beforeRowVersion: target.versionRowVersion,
            beforeState: target.versionStatus,
            changedFields,
            command: 'QUESTION_VERSION_UPDATE',
            environment: auditEnvironment,
            occurredAt: operation.occurredAt,
            operationId: operation.operationId,
            requestId: authority.requestId,
            targetId: versionId,
            targetType: 'QUESTION_VERSION'
          })
          await finishOperation(transaction, operation.operationId)
          return toResult({
            questionId: target.questionId,
            versionId,
            questionRowVersion: target.questionRowVersion,
            versionRowVersion: target.versionRowVersion + 1,
            versionStatus: target.versionStatus,
            occurredAt: operation.occurredAt
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (error: unknown) {
      const authorityFailure = await classifyAuthorityFailure(
        client,
        'updateQuestionVersion',
        authority,
        error
      )
      if (authorityFailure) throw authorityFailure
      const mapped = mapTransactionError('updateQuestionVersion', error)
      if (isSerializationFailure(error)) {
        try {
          const current = await loadVersionTarget(client, versionId)
          if (
            !current ||
            current.questionRowVersion !== target.questionRowVersion ||
            current.questionLifecycleStatus !==
              target.questionLifecycleStatus ||
            current.versionRowVersion !== target.versionRowVersion ||
            current.versionStatus !== target.versionStatus
          ) {
            throw postRollbackVersionConflict(error)
          }
          if (current.isPinned) {
            throw postRollbackImmutableVersion(error)
          }
          if (
            await hasCrossQuestionDuplicate(client, target.questionId, request)
          ) {
            throw duplicateRaceFailure(error)
          }
        } catch (postcheckError: unknown) {
          if (postcheckError instanceof AdminQuestionCommandRepositoryError) {
            throw postcheckError
          }
        }
      }
      throw mapped
    }
  }

  const transitionVersion: AdminQuestionCommandRepository['transitionVersion'] =
    async (operationName, authority, versionId, request) => {
      const config = transitionConfigByOperation[operationName]
      const assertTargetAndVersion = (
        candidate: VersionTargetRow | null
      ): VersionTargetRow => {
        if (!candidate) {
          throw repositoryFailure(
            'RESOURCE_NOT_FOUND',
            '문제 버전을 찾을 수 없습니다.'
          )
        }
        if (
          config.authorOnly &&
          candidate.versionCreatedByUserId !== authority.actorId
        ) {
          throw repositoryFailure(
            'FORBIDDEN',
            '작성자만 검수를 요청할 수 있습니다.'
          )
        }
        if (candidate.versionRowVersion !== request.expectedRowVersion) {
          throw repositoryFailure(
            'VERSION_CONFLICT',
            '다른 요청이 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.'
          )
        }
        return candidate
      }
      const assertStateAndDuties = (candidate: VersionTargetRow): void => {
        if (candidate.questionLifecycleStatus !== 'ACTIVE') {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '보관된 문제에서는 검수 상태를 변경할 수 없습니다.'
          )
        }
        if (!config.fromStates.includes(candidate.versionStatus)) {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '현재 버전 상태에서는 요청한 검수 전이를 수행할 수 없습니다.'
          )
        }
        if (
          !config.authorOnly &&
          !config.selfDecisionAllowed &&
          candidate.versionCreatedByUserId === authority.actorId
        ) {
          throw repositoryFailure(
            'SEPARATION_OF_DUTIES_VIOLATION',
            '작성자와 검수자는 서로 달라야 합니다.'
          )
        }
        if (
          toAuthorSnapshot({
            createdByUserId: candidate.versionCreatedByUserId,
            createdByActorId: candidate.versionCreatedByActorId,
            createdByRoleSnapshot: candidate.versionCreatedByRoleSnapshot,
            createdByLabelSnapshot: candidate.versionCreatedByLabelSnapshot
          }) === null
        ) {
          throw repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '시스템 seed 또는 작성자 없는 버전은 검수 전이 대상이 아닙니다.'
          )
        }
      }
      const toTargetManifest = (
        candidate: VersionTargetRow
      ): TargetManifest => ({
        questions: [
          {
            id: candidate.questionId,
            rowVersion: candidate.questionRowVersion,
            state: candidate.questionLifecycleStatus
          }
        ],
        versions: [
          {
            id: versionId,
            rowVersion: candidate.versionRowVersion,
            state: candidate.versionStatus
          }
        ],
        reports: [],
        tags: []
      })
      let target: VersionTargetRow | null
      try {
        target = await loadVersionTarget(client, versionId)
      } catch (error: unknown) {
        throw mapPreflightError(error)
      }
      const reason = 'reason' in request ? request.reason : null
      const comment = request.comment ?? null
      try {
        return await client.$transaction(
          async (transaction) => {
            const command = config.command
            const referencedUserIds = uniqueSorted([
              authority.actorId,
              target?.questionCreatedByUserId ?? null,
              target?.versionCreatedByUserId ?? null,
              operationName === 'withdrawQuestionApproval'
                ? (target?.latestApproverUserId ?? null)
                : null
            ])
            const begun = await beginOperation(transaction, {
              auditEnvironment,
              authority,
              command,
              referencedUserIds
            })
            const commandTarget = assertTargetAndVersion(target)
            const targetManifest = toTargetManifest(commandTarget)
            const operation = await armOperation(
              transaction,
              begun,
              targetManifest
            )
            assertStateAndDuties(commandTarget)
            const counterpart = config.authorOnly
              ? null
              : toAuthorSnapshot({
                  createdByUserId: commandTarget.versionCreatedByUserId,
                  createdByActorId: commandTarget.versionCreatedByActorId,
                  createdByRoleSnapshot:
                    commandTarget.versionCreatedByRoleSnapshot,
                  createdByLabelSnapshot:
                    commandTarget.versionCreatedByLabelSnapshot
                })
            const nextRowVersion = commandTarget.versionRowVersion + 1
            await transaction.$executeRawUnsafe(
              `UPDATE "QuestionVersion"
               SET "status" = $2::"QuestionVersionStatus",
                   "rowVersion" = $3, "updatedAt" = $4
               WHERE "id" = $1`,
              versionId,
              config.toState,
              nextRowVersion,
              operation.occurredAt
            )
            await insertReview(transaction, {
              action: config.action,
              actorId: authority.actorId,
              comment,
              counterpart,
              fromState: commandTarget.versionStatus,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              questionId: commandTarget.questionId,
              reason,
              requestId: authority.requestId,
              toState: config.toState,
              versionId
            })
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: nextRowVersion,
              afterState: config.toState,
              beforeRowVersion: commandTarget.versionRowVersion,
              beforeState: commandTarget.versionStatus,
              changedFields: ['VERSION_STATUS'],
              command,
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: versionId,
              targetType: 'QUESTION_VERSION'
            })
            await finishOperation(transaction, operation.operationId)
            return toResult({
              questionId: commandTarget.questionId,
              versionId,
              questionRowVersion: commandTarget.questionRowVersion,
              versionRowVersion: nextRowVersion,
              versionStatus: config.toState,
              occurredAt: operation.occurredAt
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        )
      } catch (error: unknown) {
        const authorityFailure = await classifyAuthorityFailure(
          client,
          operationName,
          authority,
          error
        )
        if (authorityFailure) throw authorityFailure
        throw mapTransactionError(operationName, error)
      }
    }

  const activeRepository: AdminQuestionCommandRepository = {
    createQuestion,
    createVersion,
    updateVersion,
    transitionVersion
  }
  if (!includePublication) return activeRepository

  const publishVersion: AdminQuestionPublicationCommandRepository['publishVersion'] =
    async (authority, versionId, request) => {
      let target: VersionTargetRow | null
      let aggregateVersions: LifecycleVersionTargetRow[] = []
      try {
        target = await loadVersionTarget(client, versionId)
        if (target) {
          aggregateVersions = await loadLifecycleVersions(
            client,
            target.questionId
          )
        }
      } catch (error: unknown) {
        throw mapPreflightError(error)
      }
      const previousCurrent = target?.questionCurrentPublishedVersionId
        ? (aggregateVersions.find(
            (version) =>
              version.id === target?.questionCurrentPublishedVersionId
          ) ?? null)
        : null

      try {
        return await client.$transaction(
          async (transaction) => {
            const begun = await beginOperation(transaction, {
              auditEnvironment,
              authority,
              command: 'PUBLICATION',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                target?.questionCreatedByUserId ?? null,
                ...aggregateVersions.map((version) => version.createdByUserId),
                target?.latestApproverUserId ?? null
              ])
            })
            if (!target) {
              throw repositoryFailure(
                'RESOURCE_NOT_FOUND',
                '문제 버전을 찾을 수 없습니다.'
              )
            }
            const commandTarget = target
            if (
              commandTarget.questionRowVersion !==
              request.expectedQuestionRowVersion
            ) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '다른 요청이 먼저 문제를 변경했습니다.'
              )
            }
            if (
              commandTarget.versionRowVersion !== request.expectedRowVersion
            ) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '다른 요청이 먼저 버전을 변경했습니다.'
              )
            }
            const currentPublishedVersionId =
              commandTarget.questionCurrentPublishedVersionId
            const operation = await armOperation(transaction, begun, {
              questions: [
                {
                  id: commandTarget.questionId,
                  rowVersion: commandTarget.questionRowVersion,
                  state: commandTarget.questionLifecycleStatus
                }
              ],
              versions: aggregateVersions.map((version) => ({
                id: version.id,
                rowVersion: version.rowVersion,
                state: version.status
              })),
              reports: [],
              tags: []
            })
            const targetManifestVersion = aggregateVersions.find(
              (version) => version.id === versionId
            )
            if (
              commandTarget.questionLifecycleStatus !== 'ACTIVE' ||
              commandTarget.versionStatus !== 'APPROVED' ||
              !targetManifestVersion ||
              targetManifestVersion.status !== 'APPROVED' ||
              (currentPublishedVersionId !== null &&
                (!previousCurrent || previousCurrent.status !== 'PUBLISHED')) ||
              aggregateVersions.some(
                (version) =>
                  version.id !== versionId &&
                  version.id !== currentPublishedVersionId
              )
            ) {
              throw repositoryFailure(
                'INVALID_STATE_TRANSITION',
                '게시 대상과 현재 공개 버전 구성이 유효하지 않습니다.'
              )
            }
            const author = toAuthorSnapshot({
              createdByUserId: commandTarget.versionCreatedByUserId,
              createdByActorId: commandTarget.versionCreatedByActorId,
              createdByRoleSnapshot: commandTarget.versionCreatedByRoleSnapshot,
              createdByLabelSnapshot:
                commandTarget.versionCreatedByLabelSnapshot
            })
            const latestApprover = toLatestApproverSnapshot(commandTarget)
            if (!author || !latestApprover) {
              throw repositoryFailure(
                'INVALID_STATE_TRANSITION',
                '게시 대상에는 작성자와 최신 승인 증거가 필요합니다.'
              )
            }
            if (
              await hasCrossQuestionFingerprintDuplicate(
                transaction,
                commandTarget.questionId,
                commandTarget.contentFingerprint
              )
            ) {
              throw repositoryFailure(
                'DUPLICATE_QUESTION_CONTENT',
                '동일한 내용의 문제가 이미 존재합니다.'
              )
            }
            if (previousCurrent) {
              await transaction.$executeRawUnsafe(
                `UPDATE "Question"
                 SET "currentPublishedVersionId" = NULL, "updatedAt" = $2
                 WHERE "id" = $1`,
                commandTarget.questionId,
                operation.occurredAt
              )
              await transaction.$executeRawUnsafe(
                `UPDATE "QuestionVersion"
                 SET "status" = 'RETIRED',
                     "retirementKind" = 'PUBLISHED_RETIREMENT',
                     "retiredAt" = $2, "rowVersion" = $3, "updatedAt" = $2
                 WHERE "id" = $1`,
                previousCurrent.id,
                operation.occurredAt,
                previousCurrent.rowVersion + 1
              )
            }
            await transaction.$executeRawUnsafe(
              `UPDATE "QuestionVersion"
               SET "status" = 'PUBLISHED', "publishedAt" = $2,
                   "retiredAt" = NULL, "retirementKind" = NULL,
                   "rowVersion" = $3, "updatedAt" = $2
               WHERE "id" = $1`,
              versionId,
              operation.occurredAt,
              commandTarget.versionRowVersion + 1
            )
            await transaction.$executeRawUnsafe(
              `UPDATE "Question"
               SET "currentPublishedVersionId" = $2,
                   "rowVersion" = $3, "updatedAt" = $4
               WHERE "id" = $1`,
              commandTarget.questionId,
              versionId,
              commandTarget.questionRowVersion + 1,
              operation.occurredAt
            )
            if (previousCurrent) {
              await insertReview(transaction, {
                action: 'RETIRED',
                actorId: authority.actorId,
                comment: null,
                counterpart: null,
                fromState: 'PUBLISHED',
                occurredAt: operation.occurredAt,
                operationId: operation.operationId,
                questionId: commandTarget.questionId,
                reason: 'PUBLISHED_REPLACEMENT',
                requestId: authority.requestId,
                toState: 'RETIRED',
                versionId: previousCurrent.id
              })
            }
            await insertReview(transaction, {
              action: 'PUBLISHED',
              actorId: authority.actorId,
              comment: null,
              counterpart: latestApprover,
              fromState: 'APPROVED',
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              questionId: commandTarget.questionId,
              reason: null,
              requestId: authority.requestId,
              toState: 'PUBLISHED',
              versionId
            })
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: commandTarget.versionRowVersion + 1,
              afterState: 'PUBLISHED',
              beforeRowVersion: commandTarget.versionRowVersion,
              beforeState: 'APPROVED',
              changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
              command: 'PUBLICATION',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: versionId,
              targetType: 'QUESTION_VERSION'
            })
            await finishOperation(transaction, operation.operationId)
            return toResult({
              questionId: commandTarget.questionId,
              versionId,
              questionRowVersion: commandTarget.questionRowVersion + 1,
              versionRowVersion: commandTarget.versionRowVersion + 1,
              versionStatus: 'PUBLISHED',
              occurredAt: operation.occurredAt
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        )
      } catch (error: unknown) {
        const authorityFailure = await classifyAuthorityFailure(
          client,
          'publishQuestionVersion',
          authority,
          error
        )
        if (authorityFailure) throw authorityFailure
        const mapped = mapTransactionError('publishQuestionVersion', error)
        if (isSerializationFailure(error) && target) {
          try {
            const current = await loadVersionTarget(client, versionId)
            const currentAggregate = current
              ? await loadLifecycleVersions(client, current.questionId)
              : []
            const oldCurrent = previousCurrent
              ? currentAggregate.find(
                  (version) => version.id === previousCurrent?.id
                )
              : undefined
            if (
              !current ||
              current.questionRowVersion !== target.questionRowVersion ||
              current.questionCurrentPublishedVersionId !==
                target.questionCurrentPublishedVersionId ||
              current.versionRowVersion !== target.versionRowVersion ||
              current.versionStatus !== target.versionStatus ||
              (previousCurrent !== null &&
                (!oldCurrent ||
                  oldCurrent.rowVersion !== previousCurrent.rowVersion ||
                  oldCurrent.status !== previousCurrent.status))
            ) {
              throw postRollbackVersionConflict(error)
            }
            if (
              await hasCrossQuestionFingerprintDuplicate(
                client,
                target.questionId,
                target.contentFingerprint
              )
            ) {
              throw duplicateRaceFailure(error)
            }
          } catch (postcheckError: unknown) {
            if (postcheckError instanceof AdminQuestionCommandRepositoryError) {
              throw postcheckError
            }
          }
        }
        throw mapped
      }
    }

  const retireVersion: AdminQuestionPublicationCommandRepository['retireVersion'] =
    async (authority, versionId, request) => {
      let target: VersionTargetRow | null
      try {
        target = await loadVersionTarget(client, versionId)
      } catch (error: unknown) {
        throw mapPreflightError(error)
      }

      try {
        return await client.$transaction(
          async (transaction) => {
            const begun = await beginOperation(transaction, {
              auditEnvironment,
              authority,
              command: 'RETIREMENT',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                target?.questionCreatedByUserId ?? null,
                target?.versionCreatedByUserId ?? null
              ])
            })
            if (!target) {
              throw repositoryFailure(
                'RESOURCE_NOT_FOUND',
                '문제 버전을 찾을 수 없습니다.'
              )
            }
            const commandTarget = target
            if (
              commandTarget.questionRowVersion !==
              request.expectedQuestionRowVersion
            ) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '다른 요청이 먼저 문제를 변경했습니다.'
              )
            }
            if (
              commandTarget.versionRowVersion !== request.expectedRowVersion
            ) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '다른 요청이 먼저 버전을 변경했습니다.'
              )
            }
            const operation = await armOperation(transaction, begun, {
              questions: [
                {
                  id: commandTarget.questionId,
                  rowVersion: commandTarget.questionRowVersion,
                  state: commandTarget.questionLifecycleStatus
                }
              ],
              versions: [
                {
                  id: versionId,
                  rowVersion: commandTarget.versionRowVersion,
                  state: commandTarget.versionStatus
                }
              ],
              reports: [],
              tags: []
            })
            if (
              commandTarget.questionLifecycleStatus !== 'ACTIVE' ||
              commandTarget.versionStatus !== 'PUBLISHED' ||
              commandTarget.questionCurrentPublishedVersionId !== versionId
            ) {
              throw repositoryFailure(
                'INVALID_STATE_TRANSITION',
                '현재 공개 중인 활성 문제 버전만 단독 폐기할 수 있습니다.'
              )
            }
            await transaction.$executeRawUnsafe(
              `UPDATE "Question"
               SET "currentPublishedVersionId" = NULL,
                   "rowVersion" = $2, "updatedAt" = $3
               WHERE "id" = $1`,
              commandTarget.questionId,
              commandTarget.questionRowVersion + 1,
              operation.occurredAt
            )
            await transaction.$executeRawUnsafe(
              `UPDATE "QuestionVersion"
               SET "status" = 'RETIRED',
                   "retirementKind" = 'PUBLISHED_RETIREMENT',
                   "retiredAt" = $2, "rowVersion" = $3, "updatedAt" = $2
               WHERE "id" = $1`,
              versionId,
              operation.occurredAt,
              commandTarget.versionRowVersion + 1
            )
            await insertReview(transaction, {
              action: 'RETIRED',
              actorId: authority.actorId,
              comment: null,
              counterpart: null,
              fromState: 'PUBLISHED',
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              questionId: commandTarget.questionId,
              reason: 'PUBLISHED_RETIREMENT',
              requestId: authority.requestId,
              toState: 'RETIRED',
              versionId
            })
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: commandTarget.versionRowVersion + 1,
              afterState: 'RETIRED',
              beforeRowVersion: commandTarget.versionRowVersion,
              beforeState: 'PUBLISHED',
              changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
              command: 'RETIREMENT',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: versionId,
              targetType: 'QUESTION_VERSION'
            })
            await finishOperation(transaction, operation.operationId)
            return toResult({
              questionId: commandTarget.questionId,
              versionId,
              questionRowVersion: commandTarget.questionRowVersion + 1,
              versionRowVersion: commandTarget.versionRowVersion + 1,
              versionStatus: 'RETIRED',
              occurredAt: operation.occurredAt
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        )
      } catch (error: unknown) {
        const authorityFailure = await classifyAuthorityFailure(
          client,
          'retireQuestionVersion',
          authority,
          error
        )
        if (authorityFailure) throw authorityFailure
        throw mapTransactionError('retireQuestionVersion', error)
      }
    }

  const archiveQuestion: AdminQuestionPublicationCommandRepository['archiveQuestion'] =
    async (authority, questionId, request) => {
      let target: QuestionTargetRow | null
      let aggregateVersions: LifecycleVersionTargetRow[] = []
      try {
        target = await loadQuestionTarget(client, questionId)
        if (target) {
          aggregateVersions = await loadLifecycleVersions(client, questionId)
        }
      } catch (error: unknown) {
        throw mapPreflightError(error)
      }

      try {
        return await client.$transaction(
          async (transaction) => {
            const begun = await beginOperation(transaction, {
              auditEnvironment,
              authority,
              command: 'QUESTION_ARCHIVE',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                target?.createdByUserId ?? null,
                ...aggregateVersions.map((version) => version.createdByUserId)
              ])
            })
            if (!target) {
              throw repositoryFailure(
                'RESOURCE_NOT_FOUND',
                '관리자 문제를 찾을 수 없습니다.'
              )
            }
            const commandTarget = target
            if (
              commandTarget.rowVersion !== request.expectedQuestionRowVersion
            ) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '다른 요청이 먼저 문제를 변경했습니다.'
              )
            }
            const currentPublishedVersionId =
              commandTarget.currentPublishedVersionId
            const current = currentPublishedVersionId
              ? (aggregateVersions.find(
                  (version) => version.id === currentPublishedVersionId
                ) ?? null)
              : null
            const candidates = aggregateVersions.filter((version) =>
              ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].includes(
                version.status
              )
            )
            const candidate = candidates.length === 1 ? candidates[0]! : null
            if (
              candidates.length > 1 ||
              candidate?.id !==
                (request.expectedOpenCandidateVersionId ?? undefined) ||
              candidate?.rowVersion !==
                (request.expectedOpenCandidateRowVersion ?? undefined)
            ) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '열린 후보 버전 구성이 변경되었습니다.'
              )
            }
            const operation = await armOperation(transaction, begun, {
              questions: [
                {
                  id: questionId,
                  rowVersion: commandTarget.rowVersion,
                  state: commandTarget.lifecycleStatus
                }
              ],
              versions: aggregateVersions.map((version) => ({
                id: version.id,
                rowVersion: version.rowVersion,
                state: version.status
              })),
              reports: [],
              tags: []
            })
            if (
              commandTarget.lifecycleStatus !== 'ACTIVE' ||
              (currentPublishedVersionId !== null &&
                (!current || current.status !== 'PUBLISHED'))
            ) {
              throw repositoryFailure(
                'INVALID_STATE_TRANSITION',
                '활성 문제만 현재 공개·후보 버전과 함께 보관할 수 있습니다.'
              )
            }
            const candidateAuthor = candidate
              ? toAuthorSnapshot(candidate)
              : null
            if (candidate && !candidateAuthor) {
              throw repositoryFailure(
                'INVALID_STATE_TRANSITION',
                '열린 후보 버전에는 작성자 증거가 필요합니다.'
              )
            }
            if (current) {
              await transaction.$executeRawUnsafe(
                `UPDATE "QuestionVersion"
                 SET "status" = 'RETIRED',
                     "retirementKind" = 'PUBLISHED_RETIREMENT',
                     "retiredAt" = $2, "rowVersion" = $3, "updatedAt" = $2
                 WHERE "id" = $1`,
                current.id,
                operation.occurredAt,
                current.rowVersion + 1
              )
            }
            if (candidate) {
              await transaction.$executeRawUnsafe(
                `UPDATE "QuestionVersion"
                 SET "status" = 'RETIRED',
                     "retirementKind" = 'QUESTION_ARCHIVE_ABANDONED',
                     "retiredAt" = $2, "rowVersion" = $3, "updatedAt" = $2
                 WHERE "id" = $1`,
                candidate.id,
                operation.occurredAt,
                candidate.rowVersion + 1
              )
            }
            await transaction.$executeRawUnsafe(
              `UPDATE "Question"
               SET "currentPublishedVersionId" = NULL,
                   "lifecycleStatus" = 'ARCHIVED', "archivedAt" = $2,
                   "rowVersion" = $3, "updatedAt" = $2
               WHERE "id" = $1`,
              questionId,
              operation.occurredAt,
              commandTarget.rowVersion + 1
            )
            if (current) {
              await insertReview(transaction, {
                action: 'RETIRED',
                actorId: authority.actorId,
                comment: null,
                counterpart: null,
                fromState: 'PUBLISHED',
                occurredAt: operation.occurredAt,
                operationId: operation.operationId,
                questionId,
                reason: 'QUESTION_ARCHIVE',
                requestId: authority.requestId,
                toState: 'RETIRED',
                versionId: current.id
              })
            }
            if (candidate) {
              await insertReview(transaction, {
                action: 'ARCHIVE_ABANDONED',
                actorId: authority.actorId,
                comment: null,
                counterpart: candidateAuthor,
                fromState: candidate.status,
                occurredAt: operation.occurredAt,
                operationId: operation.operationId,
                questionId,
                reason: 'QUESTION_ARCHIVE',
                requestId: authority.requestId,
                toState: 'RETIRED',
                versionId: candidate.id
              })
            }
            const changedFields = ['LIFECYCLE_STATUS']
            if (current || candidate) changedFields.push('VERSION_STATUS')
            if (current) changedFields.push('CURRENT_PUBLISHED_VERSION_ID')
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: commandTarget.rowVersion + 1,
              afterState: 'ARCHIVED',
              beforeRowVersion: commandTarget.rowVersion,
              beforeState: 'ACTIVE',
              changedFields,
              command: 'QUESTION_ARCHIVE',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: questionId,
              targetType: 'QUESTION',
              metadata: {
                kind: 'QUESTION_ARCHIVE_V1',
                retiredPublishedCount: current ? 1 : 0,
                abandonedCandidateCount: candidate ? 1 : 0
              }
            })
            await finishOperation(transaction, operation.operationId)
            return toArchiveResult({
              occurredAt: operation.occurredAt,
              questionId,
              questionRowVersion: commandTarget.rowVersion + 1
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        )
      } catch (error: unknown) {
        const authorityFailure = await classifyAuthorityFailure(
          client,
          'archiveAdminQuestion',
          authority,
          error
        )
        if (authorityFailure) throw authorityFailure
        throw mapTransactionError('archiveAdminQuestion', error)
      }
    }

  const readPublicationTarget: AdminQuestionPublicationCommandRepository['readPublicationTarget'] =
    async (versionId) => {
      try {
        const target = await loadVersionTarget(client, versionId)
        return target
          ? {
              questionRowVersion: target.questionRowVersion,
              versionStatus: target.versionStatus
            }
          : null
      } catch (error: unknown) {
        throw mapPreflightError(error)
      }
    }

  return {
    ...activeRepository,
    publishVersion,
    retireVersion,
    archiveQuestion,
    readPublicationTarget
  }
}

export const createPrismaAdminQuestionCommandRepository = (
  options: AdminQuestionCommandRepositoryOptions
): AdminQuestionPreparedCommandRepository =>
  createPrismaAdminQuestionCommandRepositoryInternal(
    options,
    true
  ) as AdminQuestionPreparedCommandRepository

export const createPreparedAdminQuestionCommandRepository = (
  options: AdminQuestionCommandRepositoryOptions
): AdminQuestionPreparedCommandRepository =>
  createPrismaAdminQuestionCommandRepositoryInternal(
    options,
    true
  ) as AdminQuestionPreparedCommandRepository
