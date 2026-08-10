import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { createStudySession } from '@api/study/createStudySession'
import { getStudyResult } from '@api/study/getStudyResult'
import { getStudySession } from '@api/study/getStudySession'
import { submitStudySession } from '@api/study/submitStudySession'
import type { SubmitStudySessionRequest } from '@api/study/submitStudySession/schema'

export const studyQueries = {
  allKey: () => ['study'] as const,
  session: (sessionId: string) =>
    queryOptions({
      queryKey: [...studyQueries.allKey(), 'get-session', sessionId] as const,
      queryFn: () => getStudySession(sessionId),
      enabled: sessionId.length > 0,
      staleTime: Number.POSITIVE_INFINITY
    }),
  result: (sessionId: string) =>
    queryOptions({
      queryKey: [...studyQueries.allKey(), 'get-result', sessionId] as const,
      queryFn: () => getStudyResult(sessionId),
      enabled: sessionId.length > 0,
      staleTime: Number.POSITIVE_INFINITY,
      retry: false
    })
} as const

export const studyMutations = {
  createSession: () =>
    mutationOptions({
      mutationKey: [...studyQueries.allKey(), 'create-session'] as const,
      mutationFn: createStudySession
    }),
  submitSession: (sessionId: string) =>
    mutationOptions({
      mutationKey: [
        ...studyQueries.allKey(),
        'submit-session',
        sessionId
      ] as const,
      mutationFn: (input: SubmitStudySessionRequest) =>
        submitStudySession(sessionId, input)
    })
} as const
