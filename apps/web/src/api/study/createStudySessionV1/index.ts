import { safePost } from '@api/http'
import {
  createStudySessionV1RequestSchema,
  createStudySessionV1ResponseSchema
} from '@api/study/createStudySessionV1/schema'
import type {
  CreateStudySessionV1Request,
  CreateStudySessionV1Response
} from '@api/study/createStudySessionV1/schema'

const requestSessionCreation = safePost(createStudySessionV1ResponseSchema)

export const createStudySessionV1 = (
  input: CreateStudySessionV1Request
): Promise<CreateStudySessionV1Response> =>
  requestSessionCreation(
    '/v1/study-sessions',
    createStudySessionV1RequestSchema.parse(input)
  )
