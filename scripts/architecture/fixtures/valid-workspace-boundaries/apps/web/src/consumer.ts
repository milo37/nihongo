import { getQuestionResponseSchema } from '@nihongo/contracts/question/get-question'

export const parseQuestion = (value: unknown) =>
  getQuestionResponseSchema.parse(value)
