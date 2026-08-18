import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { cancelStudySession } from '@api/study/cancelStudySession'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { listResumableStudySessions } from '@api/study/listResumableStudySessions'
import {
  listResumableStudySessionsRequestSchema,
  type ListResumableStudySessionsRequest
} from '@api/study/listResumableStudySessions/schema'
import { saveStudyDraftAnswers } from '@api/study/saveStudyDraftAnswers'
import type { ParsedSaveStudyDraftAnswersRequest } from '@api/study/saveStudyDraftAnswers/schema'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { createObjectAuthBoundActionFence } from '@libs/authTransitionFence'

export interface SaveStudyDraftMutationInput {
  body: ParsedSaveStudyDraftAnswersRequest
  idempotencyKey: string
}

export interface CancelStudySessionMutationInput {
  sessionId: string
}

const saveDraftActionFence =
  createObjectAuthBoundActionFence<SaveStudyDraftMutationInput>()
const cancelSessionActionFence =
  createObjectAuthBoundActionFence<CancelStudySessionMutationInput>()

export const fetchStudyDraftSnapshot = async (sessionId: string) =>
  (await getStudyDraftAnswers(sessionId)).data

export const assertCurrentSaveStudyDraftAction = (
  input: SaveStudyDraftMutationInput
): void => saveDraftActionFence.assertCurrent(input)

export const assertCurrentCancelStudySessionAction = (
  input: CancelStudySessionMutationInput
): void => cancelSessionActionFence.assertCurrent(input)

export const studyDraftQueries = {
  draft: (sessionId: string, enabled = true) =>
    queryOptions({
      queryKey: serverStateQueryKeys.study.draft(sessionId),
      queryFn: () => fetchStudyDraftSnapshot(sessionId),
      enabled: enabled && sessionId.length > 0,
      staleTime: 0,
      retry: false
    }),
  resumable: (input: ListResumableStudySessionsRequest, enabled = true) => {
    const normalized = listResumableStudySessionsRequestSchema.parse(input)

    return queryOptions({
      queryKey: serverStateQueryKeys.study.resumable(normalized),
      queryFn: async () => (await listResumableStudySessions(normalized)).data,
      enabled,
      staleTime: 15_000
    })
  }
} as const

export const studyDraftMutations = {
  save: (sessionId: string) =>
    mutationOptions({
      mutationKey: [
        ...serverStateQueryKeys.study.draft(sessionId),
        'save'
      ] as const,
      networkMode: 'always',
      onMutate: (input: SaveStudyDraftMutationInput) =>
        saveDraftActionFence.capture(input),
      mutationFn: async (input: SaveStudyDraftMutationInput) => {
        assertCurrentSaveStudyDraftAction(input)
        const response = await saveStudyDraftAnswers(
          sessionId,
          input.body,
          input.idempotencyKey
        )
        assertCurrentSaveStudyDraftAction(input)
        return response
      }
    }),
  cancel: () =>
    mutationOptions({
      mutationKey: [
        ...serverStateQueryKeys.study.sessions(),
        'cancel'
      ] as const,
      networkMode: 'always',
      onMutate: (input: CancelStudySessionMutationInput) =>
        cancelSessionActionFence.capture(input),
      mutationFn: async (input: CancelStudySessionMutationInput) => {
        assertCurrentCancelStudySessionAction(input)
        const response = await cancelStudySession(input.sessionId)
        assertCurrentCancelStudySessionAction(input)
        return response
      }
    })
} as const
