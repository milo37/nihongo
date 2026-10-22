import { safeGetWithMetadata } from '@api/http'
import {
  listResumableStudySessionsRequestSchema,
  listResumableStudySessionsTransportResponseSchema
} from '@api/study/listResumableStudySessions/schema'
import type {
  ListResumableStudySessionsRequest,
  ListResumableStudySessionsTransportResponse
} from '@api/study/listResumableStudySessions/schema'

const requestResumableSessions = safeGetWithMetadata(
  listResumableStudySessionsTransportResponseSchema
)

export const listResumableStudySessions = (
  input: ListResumableStudySessionsRequest
): Promise<ListResumableStudySessionsTransportResponse> =>
  requestResumableSessions(
    '/v1/study-sessions',
    listResumableStudySessionsRequestSchema.parse(input),
    { headers: { 'X-Nihongo-Practice-Contract': '2' } }
  )
