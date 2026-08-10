import { safePost } from '@api/http'
import {
  createStudySessionRequestSchema,
  createStudySessionResponseSchema
} from '@api/study/createStudySession/schema'
import type {
  CreateStudySessionRequest,
  CreateStudySessionResponse
} from '@api/study/createStudySession/schema'

const requestSessionCreation = safePost(createStudySessionResponseSchema)

export const createStudySession = (
  input: CreateStudySessionRequest
): Promise<CreateStudySessionResponse> =>
  requestSessionCreation(
    '/study/session',
    createStudySessionRequestSchema.parse(input)
  )
