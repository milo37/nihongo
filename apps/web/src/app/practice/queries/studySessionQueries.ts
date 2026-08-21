import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { isApiError } from '@api/config'
import type { CreateStudySessionRequest } from '@api/study/createStudySession/schema'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudySession } from '@api/study/getStudySession'
import { getStudySessionV2 } from '@api/study/getStudySessionV2'
import {
  toLegacyStudySessionView,
  toCanonicalStudySessionView
} from '@app/practice/adapters/studySessionView'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { clearSubmissionAttempt } from '@app/practice/submissionAttemptStorage'
import { createObjectAuthBoundActionFence } from '@libs/authTransitionFence'
import { isMockApiMode } from '@libs/apiMode'
import { isNotFoundApiError } from '@util/apiError'

const createSessionActionFence =
  createObjectAuthBoundActionFence<CreateStudySessionRequest>()

export const assertCurrentCreateStudySessionAction = (
  input: CreateStudySessionRequest
): void => createSessionActionFence.assertCurrent(input)

const createSession = async (input: CreateStudySessionRequest) => {
  if (input.questionIds !== undefined) {
    throw new Error('문항 ID 직접 선택은 Slice 5 전까지 지원하지 않습니다.')
  }
  return toCanonicalStudySessionView(
    (
      await createStudySessionV2({
        level: input.level,
        subject: input.subject,
        mode: input.mode,
        count: input.count
      })
    ).data
  )
}

const getSession = async (sessionId: string) => {
  let session
  try {
    session = toCanonicalStudySessionView(
      (await getStudySessionV2(sessionId)).data
    )
  } catch (error: unknown) {
    if (
      isMockApiMode &&
      (isNotFoundApiError(error) ||
        (isApiError(error) && error.code === 'AUTHENTICATION_REQUIRED'))
    ) {
      try {
        session = toLegacyStudySessionView(await getStudySession(sessionId))
      } catch (legacyError: unknown) {
        if (isNotFoundApiError(legacyError)) {
          clearSubmissionAttempt(sessionId)
        }
        throw legacyError
      }
    } else {
      if (isNotFoundApiError(error)) {
        clearSubmissionAttempt(sessionId)
      }
      throw error
    }
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
