import { safePut } from '@nihongo/browser/api/http'
import { parseApiResponse } from '@nihongo/browser/api/config'
import {
  createUpdateWrongNoteMemoResponseSchema,
  updateWrongNoteMemoRequestBodySchema,
  updateWrongNoteMemoRequestParamsSchema,
  updateWrongNoteMemoResultSchema
} from '@api/wrong-note/updateWrongNoteMemo/schema'
import type { ParsedUpdateWrongNoteMemoBody } from '@api/wrong-note/updateWrongNoteMemo/schema'

const requestMemoUpdate = safePut(updateWrongNoteMemoResultSchema)

export const updateWrongNoteMemo = async (
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
