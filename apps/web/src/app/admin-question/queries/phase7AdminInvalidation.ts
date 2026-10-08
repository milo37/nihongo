import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import {
  adminAuditLogKeys,
  adminQuestionKeys,
  adminQuestionReportKeys,
  adminQuestionVersionKeys
} from '@app/admin-question/queries/phase7AdminQueries'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import { authQueries } from '@app/login/queries/authQueries'
import { serverStateQueryKeys } from '@libs/serverStateQueryKeys'
import { uniqueKeys } from '@app/content-operations/queries/uniqueInvalidationKeys'
import { invalidateCreatedQuestionReportCaches } from '@app/content-operations/reports/queries/questionReportInvalidation'

export type Phase7AdminMutationKind =
  | 'CONTENT_EDIT'
  | 'REVIEW'
  | 'PUBLICATION'
  | 'BATCH_REVIEW'
  | 'IMPORT_APPLY'
  | 'EXPORT'
  | 'REPORT_CREATE'
  | 'REPORT_TRIAGE'
  | 'REPORT_RESOLVE'
  | 'REAUTHENTICATION'

export interface Phase7InvalidationTarget {
  readonly kind: Phase7AdminMutationKind
  readonly questionIds?: readonly string[]
  readonly reportId?: string
  readonly versionIds?: readonly string[]
}

export const invalidatePhase7AdminMutation = async (
  queryClient: QueryClient,
  target: Phase7InvalidationTarget
): Promise<void> => {
  if (target.kind === 'REPORT_CREATE') {
    return invalidateCreatedQuestionReportCaches(queryClient, target)
  }

  const questionIds = target.questionIds ?? []
  const versionIds = target.versionIds ?? []
  const keys: QueryKey[] = []

  keys.push(adminAuditLogKeys.allLists())

  if (
    target.kind === 'CONTENT_EDIT' ||
    target.kind === 'REVIEW' ||
    target.kind === 'PUBLICATION' ||
    target.kind === 'BATCH_REVIEW' ||
    target.kind === 'IMPORT_APPLY' ||
    target.kind === 'REPORT_RESOLVE'
  ) {
    keys.push(adminQuestionKeys.allLists())
    questionIds.forEach((questionId) => {
      keys.push(adminQuestionKeys.detail(questionId))
    })
  }

  if (
    target.kind === 'CONTENT_EDIT' ||
    target.kind === 'REVIEW' ||
    target.kind === 'PUBLICATION' ||
    target.kind === 'BATCH_REVIEW'
  ) {
    questionIds.forEach((questionId) => {
      keys.push(adminQuestionVersionKeys.historyFamily(questionId))
    })
  }

  if (target.kind === 'CONTENT_EDIT' || target.kind === 'PUBLICATION') {
    versionIds.forEach((versionId) => {
      keys.push(
        adminQuestionVersionKeys.preview(versionId),
        adminQuestionVersionKeys.diffFamily(versionId)
      )
    })
  }

  if (
    target.kind === 'REVIEW' ||
    target.kind === 'PUBLICATION' ||
    target.kind === 'BATCH_REVIEW'
  ) {
    versionIds.forEach((versionId) => {
      keys.push(adminQuestionVersionKeys.reviewFamily(versionId))
    })
  }

  if (target.kind === 'REPORT_TRIAGE' || target.kind === 'REPORT_RESOLVE') {
    keys.push(adminQuestionReportKeys.allLists())
    if (target.reportId) {
      keys.push(adminQuestionReportKeys.detail(target.reportId))
    }
  }

  if (target.kind === 'PUBLICATION') {
    keys.push(
      ['question'],
      ['study', 'candidates'],
      bookmarkQueries.listsKey(),
      serverStateQueryKeys.wrongNote.historicalLists(),
      serverStateQueryKeys.wrongNote.details(),
      serverStateQueryKeys.wrongNote.reviewQueues(),
      dashboardQueries.allKey()
    )
  }

  if (target.kind === 'REAUTHENTICATION') {
    keys.push(
      authQueries.currentUser().queryKey,
      ...questionIds.map((questionId) => adminQuestionKeys.detail(questionId))
    )
    if (target.reportId) {
      keys.push(adminQuestionReportKeys.detail(target.reportId))
    }
  }

  await Promise.all(
    uniqueKeys(keys).map((queryKey) =>
      queryClient.invalidateQueries({ queryKey })
    )
  )
}
