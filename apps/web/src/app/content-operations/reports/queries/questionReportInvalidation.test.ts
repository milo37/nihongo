import { QueryClient } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
  adminAuditLogKeys,
  adminQuestionKeys,
  adminQuestionReportKeys,
  adminQuestionVersionKeys
} from '@app/admin-question/queries/phase7AdminQueries'
import { invalidateCreatedQuestionReportCaches } from '@app/content-operations/reports/queries/questionReportInvalidation'
import { serverStateQueryKeys } from '@libs/serverStateQueryKeys'

describe('created question report cache settlement', () => {
  it('refreshes matching lists and unique targets while retaining audit, unrelated details and learner history', async () => {
    const queryClient = new QueryClient()
    const fixtures: readonly {
      readonly key: QueryKey
      readonly invalidated: boolean
    }[] = [
      {
        key: [...adminQuestionKeys.allLists(), { page: 1 }],
        invalidated: true
      },
      {
        key: [...adminQuestionKeys.allLists(), { page: 2 }],
        invalidated: true
      },
      { key: adminQuestionKeys.detail('question-1'), invalidated: true },
      { key: adminQuestionKeys.detail('question-2'), invalidated: true },
      { key: adminQuestionKeys.detail('question-3'), invalidated: false },
      {
        key: [...adminQuestionReportKeys.allLists(), { status: 'OPEN' }],
        invalidated: true
      },
      {
        key: adminQuestionReportKeys.detail('report-unrelated'),
        invalidated: false
      },
      { key: adminAuditLogKeys.allLists(), invalidated: false },
      {
        key: adminQuestionVersionKeys.historyFamily('question-1'),
        invalidated: false
      },
      {
        key: serverStateQueryKeys.study.result('session-1'),
        invalidated: false
      },
      {
        key: serverStateQueryKeys.wrongNote.detail('question-1'),
        invalidated: false
      }
    ]
    fixtures.forEach(({ key }) => queryClient.setQueryData(key, 'cached'))
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries')

    await invalidateCreatedQuestionReportCaches(queryClient, {
      questionIds: ['question-1', 'question-1', 'question-2']
    })

    expect(invalidation).toHaveBeenCalledTimes(4)
    fixtures.forEach(({ key, invalidated }) => {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(invalidated)
      expect(queryClient.getQueryData(key)).toBe('cached')
    })
    queryClient.clear()
  })
})
