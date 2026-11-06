import { type QuestionReportMutationResult } from '@nihongo/contracts/admin/content-operations'

import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { toIso } from './adminRepositoryCommon.js'

import {
  type ReportTargetRow,
  type RemediationTargetRow,
  type ReportMutationRow
} from './adminQuestionWorkflowModel.js'
import { repositoryInvariantFailure } from './adminQuestionWorkflowTransactions.js'

export const loadReportTarget = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  reportId: string
): Promise<ReportTargetRow | null> => {
  const rows = await client.$queryRawUnsafe<ReportTargetRow[]>(
    `SELECT report."id", report."questionId", report."questionVersionId",
       report."status", report."rowVersion", report."reporterUserId",
       report."assigneeUserId",
       question."lifecycleStatus" AS "questionLifecycleStatus",
       question."rowVersion" AS "questionRowVersion",
       question."createdByUserId" AS "questionCreatedByUserId",
       version."status" AS "versionStatus",
       version."rowVersion" AS "versionRowVersion",
       version."versionNumber", version."createdByUserId"
         AS "versionCreatedByUserId"
     FROM "QuestionReport" AS report
     JOIN "Question" AS question ON question."id" = report."questionId"
     JOIN "QuestionVersion" AS version
       ON version."id" = report."questionVersionId"
      AND version."questionId" = report."questionId"
     WHERE report."id" = $1`,
    reportId
  )
  return rows[0] ?? null
}

export const loadRemediationTarget = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  versionId: string
): Promise<RemediationTargetRow | null> => {
  const rows = await client.$queryRawUnsafe<RemediationTargetRow[]>(
    `SELECT "id", "questionId", "status", "rowVersion", "versionNumber",
       "retirementKind", "publishedAt", "createdByUserId"
     FROM "QuestionVersion" WHERE "id" = $1`,
    versionId
  )
  return rows[0] ?? null
}

export const loadReportMutation = async (
  transaction: Prisma.TransactionClient,
  reportId: string
): Promise<QuestionReportMutationResult> => {
  const rows = await transaction.$queryRawUnsafe<ReportMutationRow[]>(
    `SELECT "id", "questionId", "questionVersionId", "status", "rowVersion",
       "assigneeActorId", "assigneeRole", "assigneeLabel",
       "resolutionOutcome", "resolutionReason", "remediationVersionId",
       "resolvedAt", "createdAt", "updatedAt"
     FROM "QuestionReport" WHERE "id" = $1`,
    reportId
  )
  const row = rows[0]
  if (!row) {
    throw repositoryInvariantFailure(
      'QuestionReport mutation result is unavailable.'
    )
  }
  const assignee =
    row.assigneeActorId && row.assigneeRole && row.assigneeLabel
      ? {
          kind: 'ACCOUNT' as const,
          actorId: row.assigneeActorId,
          role: row.assigneeRole,
          label: row.assigneeLabel
        }
      : null
  const resolution =
    row.resolutionOutcome && row.resolutionReason && row.resolvedAt
      ? {
          outcome: row.resolutionOutcome,
          reason: row.resolutionReason,
          remediationVersionId: row.remediationVersionId,
          resolvedAt: toIso(row.resolvedAt)
        }
      : null
  return {
    id: row.id,
    questionId: row.questionId,
    questionVersionId: row.questionVersionId,
    status: row.status,
    rowVersion: row.rowVersion,
    assignee,
    resolution,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  }
}
