import {
  getStudyResultParamsSchema as canonicalGetStudyResultParamsSchema,
  getStudyResultResponseSchema as canonicalGetStudyResultResponseSchema
} from '@nihongo/contracts/study/get-study-result'
import type {
  GetStudyResultParams,
  GetStudyResultResponse
} from '@nihongo/contracts/study/get-study-result'

export const getStudyResultV1RequestSchema = canonicalGetStudyResultParamsSchema
export const getStudyResultV1ResponseSchema =
  canonicalGetStudyResultResponseSchema

export type GetStudyResultV1Request = GetStudyResultParams
export type GetStudyResultV1Response = GetStudyResultResponse
