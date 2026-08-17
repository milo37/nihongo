import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { createStudySession } from '@api/study/createStudySession'
import type { CreateStudySessionRequest } from '@api/study/createStudySession/schema'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { getStudySession } from '@api/study/getStudySession'
import { getStudySessionV1 } from '@api/study/getStudySessionV1'
import {
  toCanonicalStudySessionView,
  toLegacyStudySessionView
} from '@app/practice/adapters/studySessionView'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { clearSubmissionAttempt } from '@app/practice/submissionAttemptStorage'
import { isMockApiMode } from '@libs/apiMode'
import { createObjectAuthBoundActionFence } from '@libs/authTransitionFence'
import { isNotFoundApiError } from '@util/apiError'

const createSessionActionFence =
  createObjectAuthBoundActionFence<CreateStudySessionRequest>()

export const assertCurrentCreateStudySessionAction = (
  input: CreateStudySessionRequest
): void => createSessionActionFence.assertCurrent(input)

const createSession = async (input: CreateStudySessionRequest) => {
  if (isMockApiMode) {
    return toLegacyStudySessionView(await createStudySession(input))
  }

  if (input.mode !== 'RANDOM' || input.questionIds !== undefined) {
    throw new Error('실제 API 모드에서는 RANDOM 신규 학습만 지원합니다.')
  }

  return toCanonicalStudySessionView(
    await createStudySessionV1({
      level: input.level,
      subject: input.subject,
      mode: input.mode,
      count: input.count,
      ...(input.questionIds ? { explicitQuestionIds: input.questionIds } : {})
    })
  )
}

const getSession = async (sessionId: string) => {
  let session
  try {
    session = isMockApiMode
      ? toLegacyStudySessionView(await getStudySession(sessionId))
      : toCanonicalStudySessionView(await getStudySessionV1(sessionId))
  } catch (error: unknown) {
    if (isNotFoundApiError(error)) {
      clearSubmissionAttempt(sessionId)
    }
    throw error
  }

  if (session.session.status !== 'IN_PROGRESS') {
    clearSubmissionAttempt(sessionId)
  }

  return session
}

export const studySessionQueries = {
  session: (sessionId: string) =>
    queryOptions({
      queryKey: serverStateQueryKeys.study.session(sessionId),
      queryFn: () => getSession(sessionId),
      enabled: sessionId.length > 0,
      staleTime: Number.POSITIVE_INFINITY
    })
} as const

export const studySessionMutations = {
  createSession: () =>
    mutationOptions({
      mutationKey: [
        ...serverStateQueryKeys.study.all(),
        'create-session'
      ] as const,
      networkMode: 'always',
      onMutate: (input: CreateStudySessionRequest) =>
        createSessionActionFence.capture(input),
      mutationFn: async (input: CreateStudySessionRequest) => {
        assertCurrentCreateStudySessionAction(input)
        const session = await createSession(input)
        assertCurrentCreateStudySessionAction(input)
        return session
      },
      onSuccess: (_data, input: CreateStudySessionRequest) =>
        assertCurrentCreateStudySessionAction(input)
    })
} as const
