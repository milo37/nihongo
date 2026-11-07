import { randomUUID } from 'node:crypto'
import {
  assertAdminQuestionExportDocumentForRequest,
  createAdminImportMappingDigest,
  createAdminImportValidationDigest,
  normalizeContentTagKey,
  type AdminImportApplyItem,
  type AdminImportApplyResponse,
  type AdminImportValidationResponse,
  type AdminQuestionExportDocumentV1,
  type AdminReviewRequestBatchResult,
  type ApplyQuestionImportRequest,
  type ExportAdminQuestionsRequest,
  type QuestionReportMutationResult,
  type RequestContentReviewBatchRequest,
  type ResolveAdminQuestionReportRequest,
  type TriageAdminQuestionReportRequest,
  type ValidateQuestionImportRequest
} from '@nihongo/contracts/admin/content-operations'
import {
  insertStoredImportResult,
  readStoredImportResult,
  type StoredImportResult
} from './questionImportResultStore.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  type AuditEnvironment,
  CREATE_CHANGED_FIELDS,
  toIso,
  uniqueSorted,
  finishOperation
} from './adminRepositoryCommon.js'
import {
  AdminQuestionCommandRepositoryError,
  armOperation,
  repositoryFailure,
  type AdminCommandAuthority
} from './adminQuestionCommandRepository.js'

import {
  type BatchTargetRow,
  type ExportReviewUserRow,
  type ExportTimestampRow,
  type ReportTargetRow,
  type RemediationTargetRow,
  classifyAuthorityFailure,
  sha256Port,
  type AdminQuestionExportAuditEvidence
} from './adminQuestionWorkflowModel.js'
import {
  repositoryInvariantFailure,
  isSerializationFailure,
  beginOperation,
  insertAudit,
  insertReview,
  mapTransactionError,
  executeTransaction
} from './adminQuestionWorkflowTransactions.js'
import {
  loadExistingFingerprints,
  eligibleImportFingerprints,
  collectImportValidation,
  type ImportValidationResult,
  assertImportApplyValidation,
  createVersionContent,
  loadBatchTargets
} from './adminQuestionWorkflowImport.js'
import {
  loadExportReferencedUsers,
  buildBoundedExportSnapshot,
  reconcileCommittedExport
} from './adminQuestionWorkflowExport.js'
import {
  loadReportTarget,
  loadRemediationTarget,
  loadReportMutation
} from './adminQuestionWorkflowReports.js'

export type { AdminQuestionExportAuditEvidence } from './adminQuestionWorkflowModel.js'

export interface AdminQuestionWorkflowRepository {
  readonly requestReviewBatch: (
    authority: AdminCommandAuthority,
    request: RequestContentReviewBatchRequest
  ) => Promise<AdminReviewRequestBatchResult>
  readonly validateImport: (
    request: ValidateQuestionImportRequest
  ) => Promise<AdminImportValidationResponse>
  readonly applyImport: (
    authority: AdminCommandAuthority,
    request: ApplyQuestionImportRequest
  ) => Promise<AdminImportApplyRepositoryResult>
  readonly exportQuestions: (
    authority: AdminCommandAuthority,
    request: ExportAdminQuestionsRequest
  ) => Promise<AdminQuestionExportRepositoryResult>
  readonly triageReport: (
    authority: AdminCommandAuthority,
    reportId: string,
    request: TriageAdminQuestionReportRequest
  ) => Promise<QuestionReportMutationResult>
  readonly resolveReport: (
    authority: AdminCommandAuthority,
    reportId: string,
    request: ResolveAdminQuestionReportRequest
  ) => Promise<QuestionReportMutationResult>
}

export interface AdminImportApplyRepositoryResult {
  readonly response: AdminImportApplyResponse
  readonly mappingDigest: string
}

export interface AdminQuestionExportRepositoryResult {
  readonly document: AdminQuestionExportDocumentV1
  readonly canonicalBody: string
  readonly auditEvidence: AdminQuestionExportAuditEvidence
}

export const createPrismaAdminQuestionWorkflowRepository = ({
  auditEnvironment,
  client
}: {
  readonly auditEnvironment: AuditEnvironment
  readonly client: PrismaClient
}): AdminQuestionWorkflowRepository => ({
  requestReviewBatch: async (authority, request) => {
    let targets: BatchTargetRow[]
    try {
      targets = await loadBatchTargets(
        client,
        request.items.map((item) => item.versionId)
      )
    } catch (error: unknown) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '일괄 검수 요청 대상을 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    const targetByVersion = new Map(
      targets.map((target) => [target.versionId, target])
    )
    const plannedTargets: Array<{
      readonly requestIndex: number
      readonly target: BatchTargetRow
    }> = []
    let firstFailure:
      | {
          readonly requestIndex: number
          readonly kind: 'PRE_ARM' | 'STATE'
          readonly error: AdminQuestionCommandRepositoryError
        }
      | undefined
    for (const [requestIndex, item] of request.items.entries()) {
      const target = targetByVersion.get(item.versionId)
      if (!target) {
        firstFailure ??= {
          requestIndex,
          kind: 'PRE_ARM',
          error: repositoryFailure(
            'RESOURCE_NOT_FOUND',
            '일괄 검수 요청 대상 문제 버전을 찾을 수 없습니다.'
          )
        }
        continue
      }
      plannedTargets.push({ requestIndex, target })
      if (target.versionCreatedByUserId !== authority.actorId) {
        firstFailure ??= {
          requestIndex,
          kind: 'PRE_ARM',
          error: repositoryFailure(
            'FORBIDDEN',
            '각 문제 버전의 작성자만 일괄 검수를 요청할 수 있습니다.'
          )
        }
      } else if (target.versionRowVersion !== item.expectedRowVersion) {
        firstFailure ??= {
          requestIndex,
          kind: 'PRE_ARM',
          error: repositoryFailure(
            'VERSION_CONFLICT',
            '일괄 검수 요청 대상이 다른 요청으로 변경되었습니다.'
          )
        }
      } else if (
        target.questionLifecycleStatus !== 'ACTIVE' ||
        !['DRAFT', 'CHANGES_REQUESTED'].includes(target.versionStatus)
      ) {
        firstFailure ??= {
          requestIndex,
          kind: 'STATE',
          error: repositoryFailure(
            'INVALID_STATE_TRANSITION',
            '현재 상태에서는 일괄 검수를 요청할 수 없습니다.'
          )
        }
      }
    }
    const referenceTargets = plannedTargets.filter(({ requestIndex }) => {
      if (!firstFailure) return true
      return firstFailure.kind === 'PRE_ARM'
        ? requestIndex < firstFailure.requestIndex
        : requestIndex <= firstFailure.requestIndex
    })
    const armTargets = referenceTargets.map(({ target }) => target)
    const orderedTargets = plannedTargets.map(({ target }) => target)
    let callbackCompleted = false
    return executeTransaction(
      client,
      'requestContentReviewBatch',
      authority,
      () =>
        client.$transaction(
          async (transaction) => {
            const begun = await beginOperation(transaction, {
              auditEnvironment,
              authority,
              command: 'REVIEW_REQUEST_BATCH',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                ...referenceTargets.flatMap(({ target }) => [
                  target.questionCreatedByUserId,
                  target.versionCreatedByUserId
                ])
              ])
            })
            if (firstFailure?.kind === 'PRE_ARM' && armTargets.length === 0) {
              throw firstFailure.error
            }
            const questions = [
              ...new Map(
                armTargets.map((target) => [
                  target.questionId,
                  {
                    id: target.questionId,
                    rowVersion: target.questionRowVersion,
                    state: target.questionLifecycleStatus
                  }
                ])
              ).values()
            ]
            const operation = await armOperation(transaction, begun, {
              questions,
              versions: armTargets.map((target) => ({
                id: target.versionId,
                rowVersion: target.versionRowVersion,
                state: target.versionStatus
              })),
              reports: [],
              tags: []
            })
            if (firstFailure) {
              throw firstFailure.error
            }
            const resultItems: AdminReviewRequestBatchResult['items'] = []
            for (const [index, target] of orderedTargets.entries()) {
              const requested = request.items[index]!
              const nextRowVersion = target.versionRowVersion + 1
              await transaction.$executeRawUnsafe(
                `UPDATE "QuestionVersion"
                 SET "status" = 'IN_REVIEW', "rowVersion" = $2,
                     "updatedAt" = $3
                 WHERE "id" = $1`,
                target.versionId,
                nextRowVersion,
                operation.occurredAt
              )
              await insertReview(transaction, {
                actorId: authority.actorId,
                comment: requested.comment ?? null,
                fromState: target.versionStatus,
                occurredAt: operation.occurredAt,
                operationId: operation.operationId,
                questionId: target.questionId,
                requestId: authority.requestId,
                versionId: target.versionId
              })
              await insertAudit(transaction, {
                actorId: authority.actorId,
                afterRowVersion: nextRowVersion,
                afterState: 'IN_REVIEW',
                beforeRowVersion: target.versionRowVersion,
                beforeState: target.versionStatus,
                changedFields: ['VERSION_STATUS'],
                command: 'REVIEW_REQUEST',
                environment: auditEnvironment,
                occurredAt: operation.occurredAt,
                operationId: operation.operationId,
                requestId: authority.requestId,
                targetId: target.versionId,
                targetType: 'QUESTION_VERSION'
              })
              resultItems.push({
                questionId: target.questionId,
                questionVersionId: target.versionId,
                lifecycleStatus: 'ACTIVE',
                versionStatus: 'IN_REVIEW',
                questionRowVersion: target.questionRowVersion,
                versionRowVersion: nextRowVersion,
                occurredAt: toIso(operation.occurredAt)
              })
            }
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: null,
              afterState: null,
              beforeRowVersion: null,
              beforeState: null,
              changedFields: ['VERSION_STATUS'],
              command: 'REVIEW_REQUEST_BATCH',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: operation.operationId,
              targetType: 'REVIEW_REQUEST_BATCH',
              metadata: {
                kind: 'REVIEW_REQUEST_BATCH_V1',
                itemCount: orderedTargets.length
              }
            })
            await finishOperation(transaction, operation.operationId)
            callbackCompleted = true
            return { items: resultItems }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        ),
      () => callbackCompleted
    )
  },

  validateImport: async (request) => {
    try {
      return (await collectImportValidation(client, request.items)).response
    } catch (error: unknown) {
      if (error instanceof AdminQuestionCommandRepositoryError) throw error
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'import 검증 결과를 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
  },

  applyImport: async (authority, request) => {
    let requestedValidationDigest: string
    try {
      requestedValidationDigest = await createAdminImportValidationDigest(
        sha256Port,
        request.items
      )
    } catch (error: unknown) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'import 적용 요청의 검증 digest를 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    if (requestedValidationDigest !== request.validationDigest) {
      throw repositoryFailure(
        'IMPORT_IDENTITY_CONFLICT',
        'import 검증 digest와 적용 요청이 일치하지 않습니다.'
      )
    }
    let stored: StoredImportResult | null
    try {
      stored = await readStoredImportResult(client, request.importId)
    } catch (error: unknown) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'import 적용 결과를 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    if (stored) {
      if (
        stored.actorUserId !== authority.actorId ||
        stored.requestDigest !== request.validationDigest
      ) {
        throw repositoryFailure(
          'IMPORT_IDENTITY_CONFLICT',
          '같은 importId로 다른 가져오기가 이미 적용됐습니다.'
        )
      }
      return { response: stored.response, mappingDigest: stored.mappingDigest }
    }
    let preflight: ImportValidationResult
    try {
      preflight = await collectImportValidation(client, request.items)
    } catch (error: unknown) {
      if (error instanceof AdminQuestionCommandRepositoryError) throw error
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'import 적용 전 검증 결과를 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    assertImportApplyValidation(request, preflight)

    let callbackCompleted = false
    try {
      return await client.$transaction(
        async (transaction) => {
          const begun = await beginOperation(transaction, {
            auditEnvironment,
            authority,
            command: 'IMPORT_APPLY',
            referencedUserIds: [authority.actorId]
          })
          const validation = await collectImportValidation(
            transaction,
            request.items
          )
          assertImportApplyValidation(request, validation)
          const tagByName = new Map(
            validation.importTags.map((tag) => [tag.reference, tag])
          )
          const tagsByItem = request.items.map((item) =>
            item.content.tagNames.map((name) => {
              const tag = tagByName.get(normalizeContentTagKey(name))
              if (!tag) {
                throw repositoryFailure(
                  'IMPORT_VALIDATION_FAILED',
                  'import 태그 구성이 적용 시점에 변경되었습니다.'
                )
              }
              return tag
            })
          )
          const operation = await armOperation(transaction, begun, {
            questions: [],
            versions: [],
            reports: [],
            tags: uniqueSorted(
              tagsByItem.flatMap((tags) => tags.map((tag) => tag.id))
            )
          })
          const mappings: AdminImportApplyItem[] = request.items.map(
            (item) => ({
              clientItemId: item.clientItemId,
              questionId: randomUUID(),
              questionVersionId: randomUUID(),
              lifecycleStatus: 'ACTIVE',
              versionStatus: 'DRAFT',
              questionRowVersion: 1,
              versionRowVersion: 1
            })
          )
          const mappingDigest = await createAdminImportMappingDigest(
            sha256Port,
            mappings
          )
          for (const [index, item] of request.items.entries()) {
            const mapping = mappings[index]!
            await transaction.$executeRawUnsafe(
              `INSERT INTO "Question" (
                 "id", "createdByUserId", "createdByActorId",
                 "createdByRoleSnapshot", "createdByLabelSnapshot",
                 "createdAt", "updatedAt"
               ) VALUES ($1, $2, $2, 'ADMIN', 'ACTIVE_ADMIN', $3, $3)`,
              mapping.questionId,
              authority.actorId,
              operation.occurredAt
            )
            await createVersionContent(transaction, {
              actorId: authority.actorId,
              content: item.content,
              occurredAt: operation.occurredAt,
              questionId: mapping.questionId,
              tags: tagsByItem[index]!,
              versionId: mapping.questionVersionId
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
              targetId: mapping.questionId,
              targetType: 'QUESTION'
            })
          }
          await insertAudit(transaction, {
            actorId: authority.actorId,
            afterRowVersion: null,
            afterState: null,
            beforeRowVersion: null,
            beforeState: null,
            changedFields: ['IMPORT_ITEMS'],
            command: 'IMPORT_APPLY',
            environment: auditEnvironment,
            occurredAt: operation.occurredAt,
            operationId: operation.operationId,
            requestId: authority.requestId,
            targetId: operation.operationId,
            targetType: 'IMPORT_REQUEST',
            metadata: {
              kind: 'IMPORT_APPLY_V1',
              validationDigest: request.validationDigest,
              mappingDigest,
              itemCount: mappings.length
            }
          })
          const result = {
            response: {
              createdCount: mappings.length,
              items: mappings,
              occurredAt: toIso(operation.occurredAt)
            },
            mappingDigest
          }
          await insertStoredImportResult(transaction, {
            importId: request.importId,
            actorUserId: authority.actorId,
            requestDigest: request.validationDigest,
            ...result
          })
          await finishOperation(transaction, operation.operationId)
          callbackCompleted = true
          return result
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (error: unknown) {
      const authorityFailure = await classifyAuthorityFailure(
        client,
        'applyQuestionImport',
        authority,
        error
      )
      if (authorityFailure) throw authorityFailure
      const mapped = mapTransactionError('applyQuestionImport', error)
      if (isSerializationFailure(error)) {
        try {
          const visible = await loadExistingFingerprints(
            client,
            eligibleImportFingerprints(request.items)
          )
          if (visible.size > 0) {
            throw new AdminQuestionCommandRepositoryError({
              code: 'SERVICE_UNAVAILABLE',
              message: '동시 콘텐츠 중복으로 import를 확정하지 못했습니다.',
              disposition: 'DEFINITE_ROLLBACK',
              internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE',
              cause: error
            })
          }
        } catch (classificationError: unknown) {
          if (
            classificationError instanceof AdminQuestionCommandRepositoryError
          ) {
            throw classificationError
          }
          // Preserve the original definite rollback when the post-check fails.
        }
      }
      if (!callbackCompleted && mapped.disposition === 'COMMIT_UNKNOWN') {
        throw new AdminQuestionCommandRepositoryError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'import 적용 트랜잭션을 완료하지 못했습니다.',
          disposition: 'DEFINITE_ROLLBACK',
          cause: error
        })
      }
      throw mapped
    }
  },

  exportQuestions: async (authority, request) => {
    let referencedUsers: ExportReviewUserRow[]
    try {
      referencedUsers = await loadExportReferencedUsers(
        client,
        request.questionIds
      )
    } catch (error: unknown) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '내보내기 참조 권위를 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    const referencedUserIds = uniqueSorted([
      authority.actorId,
      ...referencedUsers.map((user) => user.userId)
    ])

    let captured:
      | {
          readonly auditContentDigest: string
          readonly occurredAt: Date
          readonly operationId: string
          readonly result: AdminQuestionExportRepositoryResult
        }
      | undefined
    let callbackCompleted = false
    try {
      return await client.$transaction(
        async (transaction) => {
          await transaction.$executeRawUnsafe('SET TRANSACTION READ WRITE')
          const begun = await beginOperation(transaction, {
            auditEnvironment,
            authority,
            command: 'EXPORT',
            referencedUserIds
          })
          const timestampRows = await transaction.$queryRawUnsafe<
            ExportTimestampRow[]
          >(`SELECT transaction_timestamp()::timestamptz(3) AS "exportedAt"`)
          const exportedAt = timestampRows[0]?.exportedAt
          if (
            timestampRows.length !== 1 ||
            !(exportedAt instanceof Date) ||
            !Number.isFinite(exportedAt.getTime())
          ) {
            throw repositoryInvariantFailure(
              'Export transaction timestamp is unavailable.'
            )
          }
          const snapshot = await buildBoundedExportSnapshot(
            transaction,
            request,
            exportedAt
          )
          const operation = await armOperation(transaction, begun, {
            questions: snapshot.questions.map((question) => ({
              id: question.id,
              rowVersion: question.rowVersion,
              state: question.lifecycleStatus
            })),
            versions: snapshot.versions.map((version) => ({
              id: version.id,
              rowVersion: version.rowVersion,
              state: version.status
            })),
            reports: [],
            tags: []
          })
          if (operation.occurredAt.getTime() !== exportedAt.getTime()) {
            throw repositoryInvariantFailure(
              'Export snapshot timestamp changed before arm.'
            )
          }
          let asserted: Awaited<
            ReturnType<typeof assertAdminQuestionExportDocumentForRequest>
          >
          try {
            asserted = await assertAdminQuestionExportDocumentForRequest(
              sha256Port,
              request,
              JSON.parse(snapshot.canonicalBody) as unknown,
              { canonicalResponseBody: snapshot.canonicalBody }
            )
          } catch (assertionError: unknown) {
            throw repositoryInvariantFailure(
              '내보내기 응답 무결성을 확인할 수 없습니다.',
              assertionError
            )
          }
          const auditEvidence: AdminQuestionExportAuditEvidence = {
            selectionDigest: asserted.selectionDigest,
            responseBodyDigest: asserted.responseBodyDigest,
            questionCount: asserted.questionCount,
            versionCount: asserted.versionCount
          }
          if (auditEvidence.versionCount !== snapshot.versions.length) {
            throw repositoryInvariantFailure(
              'Export version count does not match the manifest.'
            )
          }
          const auditContentDigest = await insertAudit(transaction, {
            actorId: authority.actorId,
            afterRowVersion: null,
            afterState: null,
            beforeRowVersion: null,
            beforeState: null,
            changedFields: ['EXPORT_SELECTION'],
            command: 'EXPORT',
            environment: auditEnvironment,
            occurredAt: operation.occurredAt,
            operationId: operation.operationId,
            requestId: authority.requestId,
            targetId: operation.operationId,
            targetType: 'EXPORT_REQUEST',
            metadata: { kind: 'EXPORT_V1', ...auditEvidence }
          })
          const result: AdminQuestionExportRepositoryResult = {
            document: asserted.document,
            canonicalBody: snapshot.canonicalBody,
            auditEvidence
          }
          captured = {
            auditContentDigest,
            occurredAt: operation.occurredAt,
            operationId: operation.operationId,
            result
          }
          await finishOperation(transaction, operation.operationId)
          callbackCompleted = true
          return result
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    } catch (error: unknown) {
      const authorityFailure = await classifyAuthorityFailure(
        client,
        'exportAdminQuestions',
        authority,
        error
      )
      if (authorityFailure) throw authorityFailure
      const mapped = mapTransactionError('exportAdminQuestions', error)
      if (!callbackCompleted && mapped.disposition === 'COMMIT_UNKNOWN') {
        throw new AdminQuestionCommandRepositoryError({
          code: 'SERVICE_UNAVAILABLE',
          message: '내보내기 트랜잭션을 완료하지 못했습니다.',
          disposition: 'DEFINITE_ROLLBACK',
          cause: error
        })
      }
      if (
        callbackCompleted &&
        mapped.disposition === 'COMMIT_UNKNOWN' &&
        captured
      ) {
        try {
          const reconciled = await reconcileCommittedExport(client, {
            actorId: authority.actorId,
            auditContentDigest: captured.auditContentDigest,
            auditEvidence: captured.result.auditEvidence,
            environment: auditEnvironment,
            occurredAt: captured.occurredAt,
            operationId: captured.operationId,
            requestId: authority.requestId
          })
          if (reconciled) return captured.result
        } catch {
          // A lookup failure cannot be treated as a successful export.
        }
      }
      throw mapped
    }
  },

  triageReport: async (authority, reportId, request) => {
    let target: ReportTargetRow | null
    try {
      target = await loadReportTarget(client, reportId)
    } catch (error: unknown) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '문제 신고 대상을 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    let callbackCompleted = false
    return executeTransaction(
      client,
      'triageAdminQuestionReport',
      authority,
      () =>
        client.$transaction(
          async (transaction) => {
            const begun = await beginOperation(transaction, {
              auditEnvironment,
              authority,
              command: 'REPORT_TRIAGE',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                target?.questionCreatedByUserId ?? null,
                target?.versionCreatedByUserId ?? null,
                target?.reporterUserId ?? null,
                target?.assigneeUserId ?? null
              ])
            })
            if (!target) {
              throw repositoryFailure(
                'RESOURCE_NOT_FOUND',
                '문제 신고를 찾을 수 없습니다.'
              )
            }
            if (target.rowVersion !== request.expectedRowVersion) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '다른 요청이 먼저 문제 신고를 변경했습니다.'
              )
            }
            const operation = await armOperation(transaction, begun, {
              questions: [
                {
                  id: target.questionId,
                  rowVersion: target.questionRowVersion,
                  state: target.questionLifecycleStatus
                }
              ],
              versions: [
                {
                  id: target.questionVersionId,
                  rowVersion: target.versionRowVersion,
                  state: target.versionStatus
                }
              ],
              reports: [
                {
                  id: target.id,
                  rowVersion: target.rowVersion,
                  state: target.status
                }
              ],
              tags: []
            })
            if (target.status !== 'OPEN') {
              throw repositoryFailure(
                'INVALID_STATE_TRANSITION',
                'OPEN 문제 신고만 triage할 수 있습니다.'
              )
            }
            await transaction.$executeRawUnsafe(
              `UPDATE "QuestionReport"
               SET "status" = 'TRIAGED', "assigneeUserId" = $2,
                   "assigneeActorId" = $2, "assigneeRole" = 'ADMIN',
                   "assigneeLabel" = 'ACTIVE_ADMIN',
                   "rowVersion" = $3, "updatedAt" = $4
               WHERE "id" = $1`,
              reportId,
              authority.actorId,
              target.rowVersion + 1,
              operation.occurredAt
            )
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: target.rowVersion + 1,
              afterState: 'TRIAGED',
              beforeRowVersion: target.rowVersion,
              beforeState: 'OPEN',
              changedFields: ['ASSIGNEE', 'REPORT_STATUS'],
              command: 'REPORT_TRIAGE',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: reportId,
              targetType: 'QUESTION_REPORT'
            })
            const result = await loadReportMutation(transaction, reportId)
            await finishOperation(transaction, operation.operationId)
            callbackCompleted = true
            return result
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        ),
      () => callbackCompleted
    )
  },

  resolveReport: async (authority, reportId, request) => {
    let target: ReportTargetRow | null
    let remediation: RemediationTargetRow | null = null
    try {
      target = await loadReportTarget(client, reportId)
      if (request.remediationVersionId) {
        remediation = await loadRemediationTarget(
          client,
          request.remediationVersionId
        )
      }
    } catch (error: unknown) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '문제 신고 해결 대상을 확인할 수 없습니다.',
        disposition: 'NO_TX',
        cause: error
      })
    }
    const outerRemediationIsTargetCandidate =
      target !== null &&
      remediation !== null &&
      remediation.questionId === target.questionId &&
      remediation.id !== target.questionVersionId
    let callbackCompleted = false
    return executeTransaction(
      client,
      'resolveAdminQuestionReport',
      authority,
      () =>
        client.$transaction(
          async (transaction) => {
            const begun = await beginOperation(transaction, {
              auditEnvironment,
              authority,
              command: 'REPORT_RESOLUTION',
              referencedUserIds: uniqueSorted([
                authority.actorId,
                target?.questionCreatedByUserId ?? null,
                target?.versionCreatedByUserId ?? null,
                target?.reporterUserId ?? null,
                target?.assigneeUserId ?? null,
                outerRemediationIsTargetCandidate
                  ? (remediation?.createdByUserId ?? null)
                  : null
              ])
            })
            target = await loadReportTarget(transaction, reportId)
            remediation = request.remediationVersionId
              ? await loadRemediationTarget(
                  transaction,
                  request.remediationVersionId
                )
              : null
            if (!target) {
              throw repositoryFailure(
                'RESOURCE_NOT_FOUND',
                '문제 신고를 찾을 수 없습니다.'
              )
            }
            if (target.rowVersion !== request.expectedRowVersion) {
              throw repositoryFailure(
                'VERSION_CONFLICT',
                '다른 요청이 먼저 문제 신고를 변경했습니다.'
              )
            }
            const remediationIsTargetCandidate =
              request.remediationVersionId !== undefined &&
              request.remediationVersionId !== null &&
              remediation !== null &&
              remediation.questionId === target.questionId &&
              remediation.id !== target.questionVersionId
            const versionTargets = [
              {
                id: target.questionVersionId,
                rowVersion: target.versionRowVersion,
                state: target.versionStatus
              },
              ...(remediationIsTargetCandidate && remediation
                ? [
                    {
                      id: remediation.id,
                      rowVersion: remediation.rowVersion,
                      state: remediation.status
                    }
                  ]
                : [])
            ]
            const operation = await armOperation(transaction, begun, {
              questions: [
                {
                  id: target.questionId,
                  rowVersion: target.questionRowVersion,
                  state: target.questionLifecycleStatus
                }
              ],
              versions: versionTargets,
              reports: [
                {
                  id: target.id,
                  rowVersion: target.rowVersion,
                  state: target.status
                }
              ],
              tags: []
            })
            if (target.status !== 'TRIAGED') {
              throw repositoryFailure(
                'INVALID_STATE_TRANSITION',
                'TRIAGED 문제 신고만 종결할 수 있습니다.'
              )
            }
            if (
              request.remediationVersionId !== undefined &&
              request.remediationVersionId !== null &&
              !remediationIsTargetCandidate
            ) {
              throw repositoryFailure(
                'RESOURCE_NOT_FOUND',
                '사용할 수 있는 조치 버전을 찾을 수 없습니다.'
              )
            }
            if (
              remediation &&
              (request.outcome !== 'RESOLVED' ||
                remediation.versionNumber <= target.versionNumber ||
                !(
                  remediation.status === 'PUBLISHED' ||
                  (remediation.status === 'RETIRED' &&
                    remediation.retirementKind === 'PUBLISHED_RETIREMENT' &&
                    remediation.publishedAt !== null)
                ))
            ) {
              throw repositoryFailure(
                'RESOURCE_NOT_FOUND',
                '사용할 수 있는 조치 버전을 찾을 수 없습니다.'
              )
            }
            const remediationVersionId = remediation?.id ?? null
            await transaction.$executeRawUnsafe(
              `UPDATE "QuestionReport"
               SET "status" = $2::"QuestionReportStatus",
                   "resolutionOutcome" = $3::"QuestionReportResolutionOutcome",
                   "resolutionReason" = $4, "remediationVersionId" = $5,
                   "resolvedAt" = $6, "rowVersion" = $7, "updatedAt" = $6
               WHERE "id" = $1`,
              reportId,
              request.outcome,
              request.outcome,
              request.reason,
              remediationVersionId,
              operation.occurredAt,
              target.rowVersion + 1
            )
            await insertAudit(transaction, {
              actorId: authority.actorId,
              afterRowVersion: target.rowVersion + 1,
              afterState: request.outcome,
              beforeRowVersion: target.rowVersion,
              beforeState: 'TRIAGED',
              changedFields: ['RESOLUTION', 'REPORT_STATUS'],
              command: 'REPORT_RESOLUTION',
              environment: auditEnvironment,
              occurredAt: operation.occurredAt,
              operationId: operation.operationId,
              requestId: authority.requestId,
              targetId: reportId,
              targetType: 'QUESTION_REPORT'
            })
            const result = await loadReportMutation(transaction, reportId)
            await finishOperation(transaction, operation.operationId)
            callbackCompleted = true
            return result
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        ),
      () => callbackCompleted
    )
  }
})
