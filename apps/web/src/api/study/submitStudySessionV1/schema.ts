import { submitStudySessionResponseSchema as canonicalSubmitStudySessionResponseSchema } from '@nihongo/contracts/study/submit-study-session'
import type { SubmitStudySessionResponse } from '@nihongo/contracts/study/submit-study-session'

export const submitStudySessionV1ResponseSchema =
  canonicalSubmitStudySessionResponseSchema

export type SubmitStudySessionV1Response = SubmitStudySessionResponse
