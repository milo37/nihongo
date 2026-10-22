import { safePostWithMetadata } from '@api/http'
import {
  createStudySessionV2RequestSchema,
  createStudySessionV2TransportResponseSchema
} from '@api/study/createStudySessionV2/schema'
import type {
  CreateStudySessionV2Request,
  CreateStudySessionV2TransportResponse
} from '@api/study/createStudySessionV2/schema'

const requestStudySessionCreation = safePostWithMetadata(
  createStudySessionV2TransportResponseSchema
)

export const createStudySessionV2 = (
  input: CreateStudySessionV2Request
): Promise<CreateStudySessionV2TransportResponse> =>
  requestStudySessionCreation(
    '/v1/study-sessions',
    createStudySessionV2RequestSchema.parse(input),
    { headers: { 'X-Nihongo-Practice-Contract': '2' } }
  )
