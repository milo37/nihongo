import { submitStudySessionBodySchema } from '@nihongo/contracts/study/submit-study-session'
import { getStudyResultResponseSchema } from '@nihongo/contracts/study/get-study-result'

export const parseSubmission = (body: unknown, result: unknown) => ({
  body: submitStudySessionBodySchema.parse(body),
  result: getStudyResultResponseSchema.parse(result)
})
