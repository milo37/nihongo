import { useState } from 'react'
import { useLocation } from 'react-router'
import {
  onlineManager,
  useMutation,
  useQueryClient
} from '@tanstack/react-query'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence,
  type AuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
import { useAppStore } from '@nihongo/browser/store/index'
import type { ContentOperationResult } from '@nihongo/browser/api/content-operations/requestContentOperation'
import { adminAuditQueries } from '@app/admin-audit/queries/adminAuditQueries'
import type { AdminQuestionSummary } from '@app/admin-question/components/QuestionListTable'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
import {
  questionWorkflowMutations,
  questionWorkflowQueries
} from '@app/admin-question/queries/questionWorkflowQueries'

type FailedResult = Exclude<
  ContentOperationResult<'publishQuestionVersionBatch'>['items'][number]['result'],
  'PUBLISHED'
>

export type BatchPublishResult = {
  readonly published: number
  readonly failed: ReadonlyArray<{
    readonly questionId: string
    readonly result: FailedResult
  }>
}

export const isBatchPublishable = (question: AdminQuestionSummary): boolean =>
  question.lifecycleStatus === 'ACTIVE' && question.versionStatus === 'APPROVED'

const assertAdmin = (fence: AuthActorTransitionFence | undefined): void => {
  if (!fence || fence.role !== 'ADMIN')
    throw new AuthTransitionSupersededError()
  assertCurrentAuthActorTransitionFence(
    fence,
    useAppStore.getState().currentUser
  )
}

/** Current-page selection, confirmation and per-item result of batch publish. */
export const useQuestionBatchPublish = (
  items: readonly AdminQuestionSummary[]
) => {
  const { search } = useLocation()
  const client = useQueryClient()
  // Page, filter, sort and search live in the query string, so selection and
  // result belong to the query string they were made under.
  const [selection, setSelection] = useState<{
    readonly search: string
    readonly ids: ReadonlySet<string>
  }>({ search, ids: new Set() })
  const [outcome, setOutcome] = useState<{
    readonly search: string
    readonly result: BatchPublishResult
  } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [freshConfirmed, setFreshConfirmed] = useState(false)
  // Leaving a query string drops its selection and result, so coming back
  // (for example after resetting a filter) starts empty.
  const [shownSearch, setShownSearch] = useState(search)
  if (shownSearch !== search) {
    setShownSearch(search)
    setSelection({ search, ids: new Set() })
    setOutcome(null)
  }
  const selectedIds =
    selection.search === search ? selection.ids : new Set<string>()
  const result = outcome?.search === search ? outcome.result : null
  const setSelectedIds = (
    next: (current: ReadonlySet<string>) => ReadonlySet<string>
  ): void =>
    setSelection((current) => ({
      search,
      ids: next(current.search === search ? current.ids : new Set())
    }))

  const publishable = items.filter(isBatchPublishable)
  const selected = publishable.filter(({ questionId }) =>
    selectedIds.has(questionId)
  )
  const pageState =
    publishable.length === 0
      ? 'empty'
      : selected.length === 0
        ? 'none'
        : selected.length === publishable.length
          ? 'all'
          : 'some'

  const options = questionWorkflowMutations.publishBatch()
  const mutation = useMutation({
    ...options,
    retry: false,
    networkMode: 'always',
    onMutate: () => {
      if (!onlineManager.isOnline())
        throw Object.assign(new Error('Offline command refused'), {
          isOffline: true
        })
      const actor = useAppStore.getState().currentUser
      if (actor?.role !== 'ADMIN') throw new AuthTransitionSupersededError()
      return captureAuthActorTransitionFence(actor)
    },
    onSuccess: async (response, _input, fence) => {
      assertAdmin(fence)
      const questionByVersion = new Map(
        selected.map((question) => [
          question.selectedVersionId,
          question.questionId
        ])
      )
      setOutcome({
        search,
        result: {
          published: response.publishedCount,
          failed: response.items.flatMap(({ questionVersionId, result }) =>
            result === 'PUBLISHED'
              ? []
              : [
                  {
                    questionId:
                      questionByVersion.get(questionVersionId) ??
                      questionVersionId,
                    result
                  }
                ]
          )
        }
      })
      setDialogOpen(false)
      setSelectedIds(() => new Set())
      await Promise.all(
        [
          adminQuestionQueries.allKey(),
          questionWorkflowQueries.allKey(),
          adminAuditQueries.allKey(),
          serverStateQueryKeys.bookmark.all(),
          serverStateQueryKeys.wrongNote.all(),
          serverStateQueryKeys.dashboard.all()
        ].map((queryKey) => client.invalidateQueries({ queryKey }))
      )
    }
  })

  const toggle = (questionId: string): void =>
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(questionId)) next.delete(questionId)
      else next.add(questionId)
      return next
    })
  const togglePage = (): void =>
    setSelectedIds(() =>
      pageState === 'all'
        ? new Set()
        : new Set(publishable.map(({ questionId }) => questionId))
    )

  return {
    selected,
    isSelected: (questionId: string) => selectedIds.has(questionId),
    pageState,
    toggle,
    togglePage,
    clear: () => setSelectedIds(() => new Set()),
    dialogOpen,
    open: () => {
      mutation.reset()
      setFreshConfirmed(false)
      setDialogOpen(true)
    },
    close: () => {
      if (!mutation.isPending) setDialogOpen(false)
    },
    freshConfirmed,
    confirmFresh: () => {
      mutation.reset()
      setFreshConfirmed(true)
    },
    publish: () => {
      setFreshConfirmed(false)
      mutation.mutate({
        items: selected.map((question) => ({
          questionVersionId: question.selectedVersionId,
          expectedRowVersion: question.versionRowVersion
        }))
      })
    },
    mutation,
    result,
    closeResult: () => setOutcome(null)
  }
}

export type QuestionBatchPublish = ReturnType<typeof useQuestionBatchPublish>
