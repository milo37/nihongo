import { useCallback, useMemo, useEffect, useRef, useState } from 'react'
import { useBlocker, useSearchParams } from 'react-router'
import {
  getAdminQuestionParamsSchema,
  type PreviewQuestionVersionResponse,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/content-operations'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import { assertCurrentAuthActorTransitionFence } from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useQuestionWorkflow } from '@app/admin-question/hooks/useQuestionWorkflow'
import { useQuestionCommands } from '@app/admin-question/hooks/useQuestionCommands'
import {
  allowedCommands,
  editableVersion,
  questionErrorCode,
  questionFieldErrors,
  hasPublicationHistory,
  type QuestionCommand
} from '@app/admin-question/detail/questionWorkflow'
import {
  discardQuestionFreshContext,
  readQuestionFreshContext,
  saveQuestionFreshContext,
  safeQuestionReturn
} from '@app/admin-question/navigation/questionWorkflowContext'

/** Question detail state: selected version, workflow commands, fresh-assurance recovery and unsaved-change guard. */
export const useQuestionDetail = ({
  questionId,
  actorId,
  epoch
}: {
  questionId: string
  actorId: string
  epoch: number
}) => {
  const { t, presentError } = useAdminPresentation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [freshRecovery, setFreshRecovery] = useState<
    'pending' | 'ready' | 'stale'
  >('pending')
  const [freshContext] = useState(() =>
    readQuestionFreshContext(actorId, questionId)
  )
  const rawVersions = searchParams.getAll('version')
  const malformedVersion =
    rawVersions.length > 1 ||
    (rawVersions.length === 1 &&
      !getAdminQuestionParamsSchema.safeParse({ questionId: rawVersions[0] })
        .success)
  const requested = malformedVersion
    ? null
    : searchParams.getAll('version').length === 1
      ? searchParams.get('version')
      : (freshContext?.versionId ?? null)
  const workflow = useQuestionWorkflow(questionId, requested)
  const { detail, history, selected, preview, versions } = workflow
  const draftOnly = !hasPublicationHistory(
    detail.data?.question.currentPublishedVersionId ?? null,
    versions
  )
  const commandLabel = (command: QuestionCommand): string =>
    command === 'ARCHIVE'
      ? t(draftOnly ? 'questionList.draftDelete' : 'questionList.archive')
      : t(`enums.commands.${command}`)
  const returnTo = safeQuestionReturn(
    searchParams.get('returnTo') ?? freshContext?.returnTo
  )
  const heading = useRef<HTMLHeadingElement>(null)
  const historyList = useRef<HTMLUListElement>(null)
  const noteInput = useRef<HTMLTextAreaElement>(null)
  const allowNavigation = useRef(false)
  const recoveryConsumed = useRef(false)
  const [dirty, setDirty] = useState(false)
  const onDirty = useCallback((value: boolean) => setDirty(value), [])
  const [editing, setEditing] = useState(false)
  const [editorSnapshot, setEditorSnapshot] = useState<{
    preview: PreviewQuestionVersionResponse
    rowVersion: number
  } | null>(null)
  const [pending, setPending] = useState<QuestionCommand | null>(null)
  const [commandSnapshot, setCommandSnapshot] = useState<{
    questionRowVersion: number
    versionRowVersion: number
    versionId: string
    openCandidateVersionId: string | null
    openCandidateRowVersion: number | null
  } | null>(null)
  const [note, setNote] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const [conflictRevision, setConflictRevision] = useState(0)
  const mutation = useQuestionCommands(
    (result, request) => {
      setDirty(false)
      setNote('')
      setPending(null)
      discardQuestionFreshContext(actorId, questionId)
      setAnnouncement(
        request.operation === 'updateQuestionVersion'
          ? t('questionDetail.saveComplete')
          : t('questionDetail.commandComplete', {
              command: pending ? commandLabel(pending) : t('common.details')
            })
      )
      if (
        request.operation === 'createAdminQuestionVersion' &&
        result.questionVersionId
      ) {
        const next = new URLSearchParams(searchParams)
        next.set('version', result.questionVersionId)
        allowNavigation.current = true
        setSearchParams(next)
        allowNavigation.current = false
      }
      heading.current?.focus()
    },
    (error) => {
      if (
        questionFieldErrors(error).reason ||
        questionFieldErrors(error).comment
      )
        noteInput.current?.focus()
    }
  )
  const code = questionErrorCode(mutation.error)
  const conflict = [
    'VERSION_CONFLICT',
    'INVALID_STATE_TRANSITION',
    'QUESTION_VERSION_IMMUTABLE',
    'FORBIDDEN',
    'SEPARATION_OF_DUTIES_VIOLATION'
  ].includes(code ?? '')
  const candidate = versions.find(
    (version) =>
      version.questionVersionId === detail.data?.question.openCandidateVersionId
  )
  const commandStale = Boolean(
    pending &&
      commandSnapshot &&
      (detail.data?.question.rowVersion !==
        commandSnapshot.questionRowVersion ||
        selected?.questionVersionId !== commandSnapshot.versionId ||
        selected?.rowVersion !== commandSnapshot.versionRowVersion ||
        (pending === 'ARCHIVE' &&
          (detail.data?.question.openCandidateVersionId !==
            commandSnapshot.openCandidateVersionId ||
            (candidate?.rowVersion ?? null) !==
              commandSnapshot.openCandidateRowVersion)))
  )
  const locked =
    workflow.locked ||
    refreshing ||
    mutation.isPending ||
    conflict ||
    commandStale
  const commands = useMemo(
    () =>
      detail.data && selected
        ? allowedCommands(detail.data, selected, actorId, candidate)
        : [],
    [detail.data, selected, actorId, candidate]
  )
  const canEdit = Boolean(
    detail.data && selected && editableVersion(detail.data, selected, actorId)
  )
  const unsaved = dirty || note.length > 0 || mutation.isPending
  const blocker = useBlocker(() => !allowNavigation.current && unsaved)
  useEffect(() => {
    if (!unsaved) return
    const stop = (event: BeforeUnloadEvent): void => {
      if (!allowNavigation.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', stop)
    return () => window.removeEventListener('beforeunload', stop)
  }, [unsaved])
  useEffect(() => {
    if (
      malformedVersion ||
      (requested &&
        !workflow.unresolved &&
        !versions.some((version) => version.questionVersionId === requested) &&
        history.isSuccess &&
        !history.hasNextPage)
    ) {
      const next = new URLSearchParams(searchParams)
      next.delete('version')
      setSearchParams(next, { replace: true })
    }
  }, [
    malformedVersion,
    history.hasNextPage,
    history.isSuccess,
    requested,
    searchParams,
    setSearchParams,
    versions,
    workflow.unresolved
  ])
  if (
    freshContext &&
    freshRecovery === 'pending' &&
    detail.data &&
    selected &&
    history.isSuccess &&
    !workflow.unresolved
  ) {
    if (
      freshContext.versionId !== selected.questionVersionId ||
      freshContext.questionRowVersion !== detail.data.question.rowVersion ||
      freshContext.versionRowVersion !== selected.rowVersion ||
      (freshContext.command === 'ARCHIVE' &&
        (freshContext.openCandidateVersionId !==
          detail.data.question.openCandidateVersionId ||
          freshContext.openCandidateRowVersion !==
            (candidate?.rowVersion ?? null))) ||
      !commands.includes(freshContext.command)
    ) {
      setFreshRecovery('stale')
      setAnnouncement(t('questionDetail.versionConflictDescription'))
    } else {
      setFreshRecovery('ready')
      setCommandSnapshot({
        questionRowVersion: freshContext.questionRowVersion,
        versionRowVersion: freshContext.versionRowVersion,
        versionId: freshContext.versionId,
        openCandidateVersionId: freshContext.openCandidateVersionId,
        openCandidateRowVersion: freshContext.openCandidateRowVersion
      })
      setPending(freshContext.command)
      setNote(freshContext.note)
      setAnnouncement(t('freshAssurance.complete'))
    }
  }
  useEffect(() => {
    if (
      !freshContext ||
      freshRecovery === 'pending' ||
      recoveryConsumed.current
    )
      return
    recoveryConsumed.current = true
    discardQuestionFreshContext(actorId, questionId)
    if (freshRecovery === 'ready') {
      const next = new URLSearchParams(searchParams)
      next.set('version', freshContext.versionId)
      next.set('returnTo', returnTo)
      allowNavigation.current = true
      setSearchParams(next, { replace: true })
      allowNavigation.current = false
    }
  }, [
    actorId,
    freshContext,
    freshRecovery,
    questionId,
    returnTo,
    searchParams,
    setSearchParams
  ])
  const refreshSnapshot = async (): Promise<void> => {
    if (workflow.isOffline || mutation.isPending) return
    setRefreshing(true)
    setRefreshError(false)
    try {
      const [latestDetail, latestHistory, latestPreview] = await Promise.all([
        detail.refetch(),
        history.refetch(),
        selected ? preview.refetch() : Promise.resolve(null)
      ])
      if (
        [
          latestDetail,
          latestHistory,
          ...(latestPreview ? [latestPreview] : [])
        ].some((result) => !result.isSuccess || result.fetchStatus !== 'idle')
      )
        throw new Error('Snapshot unavailable')
      const latestVersions =
        latestHistory.data?.pages.flatMap((page) => page.items) ?? []
      const detailVersions = latestDetail.data?.versions.items ?? []
      if (
        latestVersions.some((version) => {
          const detailVersion = detailVersions.find(
            (item) => item.questionVersionId === version.questionVersionId
          )
          return (
            detailVersion && detailVersion.rowVersion !== version.rowVersion
          )
        })
      )
        throw new Error('Snapshot versions disagree')
      const latestCandidate = latestVersions.find(
        (version) =>
          version.questionVersionId ===
          latestDetail.data?.question.openCandidateVersionId
      )
      const latestSelected = latestVersions.find(
        (version) => version.questionVersionId === selected?.questionVersionId
      )
      if (pending && latestDetail.data && latestSelected)
        setCommandSnapshot({
          questionRowVersion: latestDetail.data.question.rowVersion,
          versionRowVersion: latestSelected.rowVersion,
          versionId: latestSelected.questionVersionId,
          openCandidateVersionId:
            pending === 'ARCHIVE'
              ? latestDetail.data.question.openCandidateVersionId
              : null,
          openCandidateRowVersion:
            pending === 'ARCHIVE' ? (latestCandidate?.rowVersion ?? null) : null
        })
      setConflictRevision((value) => value + 1)
      mutation.reset()
      setAnnouncement(t('questionDetail.conflictLoaded'))
      heading.current?.focus()
    } catch {
      setRefreshError(true)
      setAnnouncement(t('questionDetail.conflictLoadFailed'))
    } finally {
      setRefreshing(false)
    }
  }
  const save = async (
    input: UpdateQuestionVersionRequest
  ): Promise<boolean> => {
    if (locked || !canEdit || !selected) return false
    try {
      await mutation.mutateAsync({
        operation: 'updateQuestionVersion',
        params: { versionId: selected.questionVersionId },
        query: {},
        body: input
      })
      return true
    } catch {
      return false
    }
  }
  const fresh = (): void => {
    if (
      !selected ||
      !detail.data ||
      !pending ||
      commandStale ||
      dirty ||
      mutation.isPending
    )
      return
    try {
      assertCurrentAuthActorTransitionFence(
        { actorId, epoch, role: 'ADMIN' },
        useAppStore.getState().currentUser
      )
    } catch {
      return
    }
    if (
      !saveQuestionFreshContext({
        actorId,
        questionId,
        versionId: selected.questionVersionId,
        questionRowVersion: detail.data.question.rowVersion,
        versionRowVersion: selected.rowVersion,
        openCandidateVersionId:
          pending === 'ARCHIVE'
            ? (commandSnapshot?.openCandidateVersionId ?? null)
            : null,
        openCandidateRowVersion:
          pending === 'ARCHIVE'
            ? (commandSnapshot?.openCandidateRowVersion ?? null)
            : null,
        returnTo,
        command: pending,
        note
      })
    ) {
      setAnnouncement(t('errors.generic'))
      return
    }
    allowNavigation.current = true
    appDocumentNavigation.assign(
      '/login?redirect=' + encodeURIComponent('/admin/questions/' + questionId)
    )
  }
  const reasonRequired = pending === 'CHANGE_REQUEST' || pending === 'WITHDRAW'
  const noteLimit = reasonRequired ? 100 : 1000
  const noteError =
    questionFieldErrors(mutation.error).reason ||
    questionFieldErrors(mutation.error).comment
      ? t('errors.validation')
      : [...note].length > noteLimit
        ? t('questionDetail.noteLimit', { formattedCount: String(noteLimit) })
        : undefined
  const showNote =
    pending &&
    ['REQUEST_REVIEW', 'CHANGE_REQUEST', 'APPROVE', 'WITHDRAW'].includes(
      pending
    )
  return {
    t,
    presentError,
    commandLabel,
    draftOnly,
    searchParams,
    setSearchParams,
    workflow,
    detail,
    history,
    selected,
    preview,
    versions,
    returnTo,
    heading,
    historyList,
    noteInput,
    dirty,
    onDirty,
    editing,
    setEditing,
    editorSnapshot,
    setEditorSnapshot,
    pending,
    setPending,
    setCommandSnapshot,
    note,
    setNote,
    announcement,
    setAnnouncement,
    refreshing,
    refreshError,
    conflictRevision,
    mutation,
    code,
    conflict,
    candidate,
    commandStale,
    locked,
    commands,
    canEdit,
    blocker,
    refreshSnapshot,
    save,
    fresh,
    reasonRequired,
    noteError,
    showNote,
    questionId
  }
}

export type QuestionDetailState = ReturnType<typeof useQuestionDetail>
