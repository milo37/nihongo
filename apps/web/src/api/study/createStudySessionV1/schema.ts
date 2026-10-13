import {
  createStudySessionBodySchema as canonicalCreateStudySessionBodySchema,
  createStudySessionResponseSchema as canonicalCreateStudySessionResponseSchema
} from '@nihongo/contracts/study/create-study-session'
import type {
  CreateStudySessionBody,
  CreateStudySessionResponse
} from '@nihongo/contracts/study/create-study-session'

export const createStudySessionV1RequestSchema =
  canonicalCreateStudySessionBodySchema
export const createStudySessionV1ResponseSchema =
  canonicalCreateStudySessionResponseSchema

export type CreateStudySessionV1Request = CreateStudySessionBody
export type CreateStudySessionV1Response = CreateStudySessionResponse
