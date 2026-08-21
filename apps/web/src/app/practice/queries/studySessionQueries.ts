import { mutationOptions, queryOptions } from '@tanstack/react-query'
import type { CreateStudySessionV2Request } from '@api/study/createStudySessionV2/schema'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudySessionV2 } from '@api/study/getStudySessionV2'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { clearSubmissionAttempt } from '@app/practice/submissionAttemptStorage'
import { createObjectAuthBoundActionFence } from '@libs/authTransitionFence'
import { isNotFoundApiError } from '@util/apiError'

const createSessionActionFence =
  createObjectAuthBoundActionFence<CreateStudySessionV2Request>()

export const assertCurrentCreateStudySessionAction = (
  input: CreateStudySessionV2Request
): void => createSessionActionFence.assertCurrent(input)

const createSession = async (input: CreateStudySessionV2Request) => {
  return toCanonicalStudySessionView((await createStudySessionV2(input)).data)
}

const getSession = async (sessionId: string) => {
  try {
    const session = toCanonicalStudySessionView(
      (await getStudySessionV2(sessionId)).data
    )
    if (session.session.status !== 'IN_PROGRESS') {
      clearSubmissionAttempt(sessionId)
    }
    return session
  } catch (error: unknown) {
    if (isNotFoundApiError(error)) {
      clearSubmissionAttempt(sessionId)
    }
    throw error
  }
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
      onMutate: (input: CreateStudySessionV2Request) =>
        createSessionActionFence.capture(input),
      mutationFn: async (input: CreateStudySessionV2Request) => {
        assertCurrentCreateStudySessionAction(input)
        const session = await createSession(input)
        assertCurrentCreateStudySessionAction(input)
        return session
      },
      onSuccess: (_data, input: CreateStudySessionV2Request) =>
        assertCurrentCreateStudySessionAction(input)
    })
} as const
