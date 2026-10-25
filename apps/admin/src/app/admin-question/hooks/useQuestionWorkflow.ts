import { useSyncExternalStore } from 'react'
import {
  onlineManager,
  useQuery,
  useInfiniteQuery
} from '@tanstack/react-query'
import { getAdminQuestionParamsSchema } from '@nihongo/contracts/admin/phase7'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { captureAuthTransitionEpoch } from '@nihongo/browser/libs/authTransitionFence'
import { questionWorkflowQueries } from '@app/admin-question/queries/questionWorkflowQueries'
export const useQuestionWorkflow = (
  questionId: string,
  requestedVersion: string | null
) => {
  const { user, role, isReady } = useAuth()
  const actor = user?.id ?? null
  const epoch = captureAuthTransitionEpoch()
  const online = useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline()
  )
  const enabled =
    isReady &&
    role === 'ADMIN' &&
    Boolean(actor) &&
    getAdminQuestionParamsSchema.safeParse({ questionId }).success
  const detail = useQuery({
    ...questionWorkflowQueries.detail(actor, epoch, questionId),
    enabled
  })
  const history = useInfiniteQuery({
    ...questionWorkflowQueries.versions(
      actor,
      epoch,
      questionId,
      detail.data?.question.rowVersion ?? 0
    ),
    enabled: enabled && Boolean(detail.data)
  })
  const versions =
    history.data?.pages.flatMap((page) => page.items) ??
    detail.data?.versions.items ??
    []
  const preferred =
    detail.data?.question.openCandidateVersionId ??
    detail.data?.question.currentPublishedVersionId ??
    versions[0]?.questionVersionId
  const requested = versions.find(
    (v) => v.questionVersionId === requestedVersion
  )
  const unresolved = Boolean(
    requestedVersion &&
      !requested &&
      (history.isPending || history.isError || history.hasNextPage)
  )
  const selected = requestedVersion
    ? (requested ??
      (unresolved
        ? undefined
        : versions.find((v) => v.questionVersionId === preferred)))
    : versions.find((v) => v.questionVersionId === preferred)
  const previous = selected
    ? versions[versions.indexOf(selected) + 1]
    : undefined
  const preview = useQuery({
    ...questionWorkflowQueries.preview(
      actor,
      epoch,
      questionId,
      selected?.questionVersionId ?? '',
      selected?.rowVersion ?? 0
    ),
    enabled: enabled && Boolean(selected)
  })
  const reviews = useInfiniteQuery({
    ...questionWorkflowQueries.reviews(
      actor,
      epoch,
      selected?.questionVersionId ?? '',
      selected?.rowVersion ?? 0
    ),
    enabled: enabled && Boolean(selected)
  })
  const diff = useQuery({
    ...questionWorkflowQueries.diff(
      actor,
      epoch,
      selected?.questionVersionId ?? '',
      selected?.rowVersion ?? 0,
      previous?.questionVersionId ?? ''
    ),
    enabled: enabled && Boolean(selected && previous)
  })
  const locked =
    !online ||
    [detail, history, preview].some(
      (query) =>
        query.isError ||
        query.isPending ||
        query.isFetching ||
        query.fetchStatus === 'paused'
    ) ||
    unresolved
  return {
    detail,
    history,
    versions,
    selected,
    previous,
    preview,
    reviews,
    diff,
    locked,
    isOffline: !online,
    unresolved,
    actor,
    epoch
  }
}
