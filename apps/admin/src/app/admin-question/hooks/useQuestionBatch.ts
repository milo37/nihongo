import { useEffect, useState } from 'react'
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
import { REAUTH_RETURN_PARAM } from '@nihongo/browser/app/reauth/hooks/useStartReauth'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
import { useAppStore } from '@nihongo/browser/store/index'
import { adminAuditQueries } from '@app/admin-audit/queries/adminAuditQueries'
import type { AdminQuestionSummary } from '@app/admin-question/components/QuestionListTable'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
import {
  clearReauthKeep,
  readReauthKeep,
  saveReauthKeep
} from '@app/admin/reauth/reauthKeep'
import {
  questionWorkflowMutations,
  questionWorkflowQueries,
  type BatchFailure
} from '@app/admin-question/queries/questionWorkflowQueries'

export type BatchAction = 'request' | 'approve' | 'publish'

export type BatchActionResult = {
  readonly action: BatchAction
  readonly succeeded: number
  readonly failed: ReadonlyArray<{
    readonly questionId: string
    readonly result: BatchFailure
  }>
}

const isActive = (question: AdminQuestionSummary): boolean =>
  question.lifecycleStatus === 'ACTIVE'

/**
 * Rows each batch action can take: request review of the actor's own drafts,
 * approve from review, publish when approved.
 */
export const batchTargets: Record<
  BatchAction,
  (question: AdminQuestionSummary, actorId: string | undefined) => boolean
> = {
  request: (question, actorId) =>
    isActive(question) &&
    Boolean(actorId) &&
    question.author?.actorId === actorId &&
    ['DRAFT', 'CHANGES_REQUESTED'].includes(question.versionStatus),
  approve: (question) =>
    isActive(question) && question.versionStatus === 'IN_REVIEW',
  publish: (question) =>
    isActive(question) && question.versionStatus === 'APPROVED'
}

export const isBatchSelectable = (
  question: AdminQuestionSummary,
  actorId: string | undefined
): boolean =>
  batchTargets.request(question, actorId) ||
  batchTargets.approve(question, actorId) ||
  batchTargets.publish(question, actorId)

/** The list's query string without the re-verification result. */
const listSearchOf = (search: string): string => {
  const params = new URLSearchParams(search)
  params.delete(REAUTH_RETURN_PARAM)
  return params.toString()
}

/** Selection kept before re-verification, if it was made on this list. */
const restoredSelection = (
  actorId: string | undefined,
  search: string
): ReadonlySet<string> => {
  if (!actorId) return new Set()
  const kept = readReauthKeep(actorId, 'question-list')
  return typeof kept === 'object' &&
    kept !== null &&
    'search' in kept &&
    kept.search === search &&
    'ids' in kept &&
    Array.isArray(kept.ids) &&
    kept.ids.every((id) => typeof id === 'string')
    ? new Set<string>(kept.ids)
    : new Set()
}

const assertAdmin = (fence: AuthActorTransitionFence | undefined): void => {
  if (!fence || fence.role !== 'ADMIN')
    throw new AuthTransitionSupersededError()
  assertCurrentAuthActorTransitionFence(
    fence,
    useAppStore.getState().currentUser
  )
}

/**
 * Current-page selection, confirmation and per-item result of batch review
 * request, approve and publish. One selection serves every action.
 */
export const useQuestionBatch = (items: readonly AdminQuestionSummary[]) => {
  const search = listSearchOf(useLocation().search)
  const client = useQueryClient()
  const actorId = useAppStore((state) => state.currentUser?.id)
  // Page, filter, sort and search live in the query string, so selection and
  // result belong to the query string they were made under.
  const [selection, setSelection] = useState<{
    readonly search: string
    readonly ids: ReadonlySet<string>
  }>(() => ({ search, ids: restoredSelection(actorId, search) }))
  useEffect(() => {
    if (actorId) clearReauthKeep(actorId, 'question-list')
  }, [actorId])
  const [outcome, setOutcome] = useState<{
    readonly search: string
    readonly result: BatchActionResult
  } | null>(null)
  // The action stays after closing so the dialog keeps its copy while it hides.
  const [dialog, setDialog] = useState<{
    readonly action: BatchAction
    readonly open: boolean
  }>({ action: 'publish', open: false })
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

  const selectable = items.filter((question) =>
    isBatchSelectable(question, actorId)
  )
  const selected = selectable.filter(({ questionId }) =>
    selectedIds.has(questionId)
  )
  const targets = {
    request: selected.filter((question) =>
      batchTargets.request(question, actorId)
    ),
    approve: selected.filter((question) =>
      batchTargets.approve(question, actorId)
    ),
    publish: selected.filter((question) =>
      batchTargets.publish(question, actorId)
    )
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
      setDialog({ action, open: true })
    },
    close: () => {
      if (!mutation.isPending)
        setDialog((current) => ({ ...current, open: false }))
    },
    /** Keeps the selection for the return from re-verification. */
    keepSelection: (): boolean =>
      Boolean(actorId) &&
      saveReauthKeep(actorId as string, 'question-list', {
        search,
        ids: [...selectedIds]
      }),
    confirm: () => {
      mutation.mutate({
        action: dialog.action,
        items: dialogTargets.map((question) => ({
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

export type QuestionBatch = ReturnType<typeof useQuestionBatch>
