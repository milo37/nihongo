import { useEffect, useState } from 'react'
import {
  onlineManager,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'
import {
  LEVELS,
  SUBJECTS,
  type JlptLevel,
  type QuestionSubject
} from '@nihongo/browser/common/types/domain'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
import { useAppStore } from '@nihongo/browser/store/index'
import { listAdminQuestion } from '@api/admin-question/listAdminQuestion/index'
import { adminAuditQueries } from '@app/admin-audit/queries/adminAuditQueries'
import { questionErrorCode } from '@app/admin-question/detail/questionWorkflow'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
import { questionWorkflowQueries } from '@app/admin-question/queries/questionWorkflowQueries'
import {
  clearReauthKeep,
  readReauthKeep,
  saveReauthKeep
} from '@app/admin/reauth/reauthKeep'

/** Server limit for one retirement-batch request and one list page. */
export const RETIRE_CHUNK = 100

type RetireTarget = {
  readonly questionVersionId: string
  readonly expectedRowVersion: number
}

export type RetireGroup = {
  readonly level: JlptLevel
  readonly subject: QuestionSubject
}

export type RetireResult = RetireGroup & {
  readonly retired: number
  /** Not retired because a later request was refused; 0 when all went. */
  readonly notDone: number
  readonly stopCode: string | null
}

/**
 * Every ACTIVE question of the group whose selected version is the published
 * one. A question with an open draft over its published version is left out:
 * the list only carries the draft's row version.
 */
const listRetireTargets = async ({
  level,
  subject
}: RetireGroup): Promise<RetireTarget[]> => {
  const targets: RetireTarget[] = []
  for (let page = 1; ; page += 1) {
    const response = await listAdminQuestion({
      level,
      subject,
      lifecycleStatus: 'ACTIVE',
      versionStatus: 'PUBLISHED',
      page,
      pageSize: RETIRE_CHUNK
    })
    targets.push(
      ...response.items
        .filter(
          (question) =>
            question.currentPublishedVersionId === question.selectedVersionId
        )
        .map((question) => ({
          questionVersionId: question.selectedVersionId,
          expectedRowVersion: question.versionRowVersion
        }))
    )
    if (
      response.items.length < RETIRE_CHUNK ||
      page * RETIRE_CHUNK >= response.total
    )
      return targets
  }
}

/**
 * Sends 100 at a time, in order. Each request is all or nothing. A refusal
 * before anything was retired is thrown for the dialog (sign-in, fresh
 * assurance); a later one stops and is reported with what was done.
 */
const retireInChunks = async (
  targets: readonly RetireTarget[]
): Promise<{ retired: number; stopCode: string | null }> => {
  let retired = 0
  for (let start = 0; start < targets.length; start += RETIRE_CHUNK) {
    try {
      const response = await requestContentOperation({
        operation: 'retireQuestionVersionBatch',
        params: {},
        query: {},
        body: { items: targets.slice(start, start + RETIRE_CHUNK) }
      })
      retired += response.retiredCount
    } catch (error) {
      if (retired === 0) throw error
      return { retired, stopCode: questionErrorCode(error) ?? 'FAILED' }
    }
  }
  return { retired, stopCode: null }
}

const readKept = (actorId: string | undefined): RetireGroup | null => {
  if (!actorId) return null
  const kept = readReauthKeep(actorId, 'question-retire')
  return typeof kept === 'object' &&
    kept !== null &&
    'level' in kept &&
    'subject' in kept &&
    LEVELS.some((value) => value === kept.level) &&
    SUBJECTS.some((value) => value === kept.subject)
    ? (kept as RetireGroup)
    : null
}

/**
 * '급수·과목별 한꺼번에 비공개' (JLP-817): pick a level and subject, see how many
 * published questions it covers, confirm, then see what was retired.
 */
export const useQuestionRetire = () => {
  const client = useQueryClient()
  const actorId = useAppStore((state) => state.currentUser?.id)
  // Back from re-verification: reopen with the same group.
  const [kept] = useState(() => readKept(actorId))
  const [open, setOpen] = useState(kept !== null)
  const [level, setLevel] = useState<JlptLevel | ''>(kept?.level ?? '')
  const [subject, setSubject] = useState<QuestionSubject | ''>(
    kept?.subject ?? ''
  )
  const [result, setResult] = useState<RetireResult | null>(null)
  useEffect(() => {
    if (actorId) clearReauthKeep(actorId, 'question-retire')
  }, [actorId])

  const group = level && subject ? { level, subject } : null
  const targets = useQuery({
    queryKey: [
      ...adminQuestionQueries.allKey(),
      'retire-targets',
      level,
      subject
    ] as const,
    queryFn: () => listRetireTargets({ level, subject } as RetireGroup),
    enabled: open && group !== null,
    staleTime: 0,
    retry: false
  })

  const mutation = useMutation({
    mutationKey: [...adminQuestionQueries.allKey(), 'retire-batch'],
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
    mutationFn: ({ items }: RetireGroup & { items: readonly RetireTarget[] }) =>
      retireInChunks(items),
    onSuccess: async (response, { items, ...done }, fence) => {
      if (!fence || fence.role !== 'ADMIN')
        throw new AuthTransitionSupersededError()
      assertCurrentAuthActorTransitionFence(
        fence,
        useAppStore.getState().currentUser
      )
      setResult({
        ...done,
        retired: response.retired,
        notDone: items.length - response.retired,
        stopCode: response.stopCode
      })
      setOpen(false)
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

  return {
    open,
    level,
    subject,
    group,
    targets,
    mutation,
    result,
    /** Starts from the list's level and subject filters when they are set. */
    show: (from: { level?: JlptLevel; subject?: QuestionSubject }) => {
      mutation.reset()
      setLevel(from.level ?? '')
      setSubject(from.subject ?? '')
      setOpen(true)
    },
    close: () => {
      if (!mutation.isPending) setOpen(false)
    },
    setLevel: (next: JlptLevel | '') => {
      mutation.reset()
      setLevel(next)
    },
    setSubject: (next: QuestionSubject | '') => {
      mutation.reset()
      setSubject(next)
    },
    confirm: () => {
      if (group && targets.data && targets.data.length > 0)
        mutation.mutate({ ...group, items: targets.data })
    },
    /** Keeps the group for the return from re-verification. */
    keep: (): boolean =>
      Boolean(actorId && group) &&
      saveReauthKeep(actorId as string, 'question-retire', group),
    closeResult: () => setResult(null)
  }
}

export type QuestionRetire = ReturnType<typeof useQuestionRetire>
