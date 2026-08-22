import { safePut } from '@api/http'
import { parseApiResponse } from '@api/config'
import {
  createUpdateWrongNoteMemoResponseSchema,
  updateWrongNoteMemoRequestBodySchema,
  updateWrongNoteMemoRequestParamsSchema,
  updateWrongNoteMemoResultSchema
} from '@api/wrong-note/updateWrongNoteMemoV1/schema'
import type { ParsedUpdateWrongNoteMemoBody } from '@api/wrong-note/updateWrongNoteMemoV1/schema'

const requestMemoUpdate = safePut(updateWrongNoteMemoResultSchema)

export const updateWrongNoteMemoV1 = async (
  questionId: string,
  input: ParsedUpdateWrongNoteMemoBody
) => {
  const params = updateWrongNoteMemoRequestParamsSchema.parse({ questionId })
  const body = updateWrongNoteMemoRequestBodySchema.parse(input)
  const memo = await requestMemoUpdate(
    `/v1/wrong-notes/${params.questionId}/memo`,
    body
  )
  parseApiResponse(
    createUpdateWrongNoteMemoResponseSchema(params.questionId),
    memo
  )
  return memo
}
