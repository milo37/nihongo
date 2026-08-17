import {
  submitStudySessionBodySchema as canonicalSubmitStudySessionBodySchema,
  submitStudySessionHeadersSchema as canonicalSubmitStudySessionHeadersSchema,
  submitStudySessionParamsSchema as canonicalSubmitStudySessionParamsSchema
} from '@nihongo/contracts/study/submit-study-session'
import type {
  ParsedSubmitStudySessionBody,
  SubmitStudySessionBody,
  SubmitStudySessionHeaders
} from '@nihongo/contracts/study/submit-study-session'

export const submitStudySessionV1ParamsSchema =
  canonicalSubmitStudySessionParamsSchema
export const submitStudySessionV1HeadersSchema =
  canonicalSubmitStudySessionHeadersSchema
export const submitStudySessionV1RequestSchema =
  canonicalSubmitStudySessionBodySchema

export type SubmitStudySessionV1Headers = SubmitStudySessionHeaders
export type SubmitStudySessionV1Request = SubmitStudySessionBody
export type ParsedSubmitStudySessionV1Request = ParsedSubmitStudySessionBody
