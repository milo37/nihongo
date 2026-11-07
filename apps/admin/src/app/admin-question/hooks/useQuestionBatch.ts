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

export type BatchAction = 'approve' | 'publish'

type FailedResult =
  | Exclude<
      ContentOperationResult<'publishQuestionVersionBatch'>['items'][number]['result'],
      'PUBLISHED'
    >
  | Exclude<
      ContentOperationResult<'approveQuestionVersionBatch'>['items'][number]['result'],
      'APPROVED'
    >

export type BatchActionResult = {
  readonly action: BatchAction
  readonly succeeded: number
  readonly failed: ReadonlyArray<{
    readonly questionId: string
    readonly result: FailedResult
  }>
}

const isActive = (question: AdminQuestionSummary): boolean =>
  question.lifecycleStatus === 'ACTIVE'

/** Rows each batch action can take: approve from review, publish when approved. */
export const batchTargets: Record<
  BatchAction,
  (question: AdminQuestionSummary) => boolean
> = {
  approve: (question) =>
    isActive(question) && question.versionStatus === 'IN_REVIEW',
  publish: (question) =>
    isActive(question) && question.versionStatus === 'APPROVED'
}

export const isBatchSelectable = (question: AdminQuestionSummary): boolean =>
  batchTargets.approve(question) || batchTargets.publish(question)

const assertAdmin = (fence: AuthActorTransitionFence | undefined): void => {
  if (!fence || fence.role !== 'ADMIN')
    throw new AuthTransitionSupersededError()
  assertCurrentAuthActorTransitionFence(
    fence,
    useAppStore.getState().currentUser
  )
}

/**
 * Current-page selection, confirmation and per-item result of batch approve
 * and batch publish. One selection serves both actions.
 */
export const useQuestionBatch = (items: readonly AdminQuestionSummary[]) => {
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
    readonly result: BatchActionResult
  } | null>(null)
  // The action stays after closing so the dialog keeps its copy while it hides.
  const [dialog, setDialog] = useState<{
    readonly action: BatchAction
    readonly open: boolean
  }>({ action: 'publish', open: false })
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

  const selectable = items.filter(isBatchSelectable)
  const selected = selectable.filter(({ questionId }) =>
    selectedIds.has(questionId)
  )
  const targets = {
    approve: selected.filter(batchTargets.approve),
    publish: selected.filter(batchTargets.publish)
  }
  const pageState =
    selectable.length === 0
      ? 'empty'
      : selected.length === 0
        ? 'none'
        : selected.length === selectable.length
          ? 'all'
          : 'some'

  const mutation = useMutation({
    ...questionWorkflowMutations.batch(),
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
    onSuccess: async (response, { action }, fence) => {
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
          action,
          succeeded: response.succeeded,
          failed: response.items.flatMap(({ questionVersionId, failure }) =>
            failure === null
              ? []
              : [
                  {
                    questionId:
                      questionByVersion.get(questionVersionId) ??
                      questionVersionId,
                    result: failure
                  }
                ]
          )
        }
      })
      setDialog((current) => ({ ...current, open: false }))
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
        : new Set(selectable.map(({ questionId }) => questionId))
    )
  const dialogTargets = targets[dialog.action]

  return {
    selected,
    targets,
    isSelected: (questionId: string) => selectedIds.has(questionId),
    pageState,
    toggle,
    togglePage,
    clear: () => setSelectedIds(() => new Set()),
    dialogOpen: dialog.open,
    dialogAction: dialog.action,
    dialogTargets,
    open: (action: BatchAction) => {
      mutation.reset()
      setFreshConfirmed(false)
      setDialog({ action, open: true })
    },
    close: () => {
      if (!mutation.isPending)
        setDialog((current) => ({ ...current, open: false }))
    },
    freshConfirmed,
    confirmFresh: () => {
      mutation.reset()
      setFreshConfirmed(true)
    },
    confirm: () => {
      setFreshConfirmed(false)
      mutation.mutate({
        action: dialog.action,
        body: {
          items: dialogTargets.map((question) => ({
            questionVersionId: question.selectedVersionId,
            expectedRowVersion: question.versionRowVersion
          }))
        }
      })
    },
    mutation,
    result,
    closeResult: () => setOutcome(null)
  }
}

export type QuestionBatch = ReturnType<typeof useQuestionBatch>
