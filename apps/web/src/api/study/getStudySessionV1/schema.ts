import {
  getStudySessionParamsSchema as canonicalGetStudySessionParamsSchema,
  getStudySessionResponseSchema as canonicalGetStudySessionResponseSchema
} from '@nihongo/contracts/study/get-study-session'
import type {
  GetStudySessionParams,
  GetStudySessionResponse
} from '@nihongo/contracts/study/get-study-session'

export const getStudySessionV1RequestSchema =
  canonicalGetStudySessionParamsSchema
export const getStudySessionV1ResponseSchema =
  canonicalGetStudySessionResponseSchema

export type GetStudySessionV1Request = GetStudySessionParams
export type GetStudySessionV1Response = GetStudySessionResponse
