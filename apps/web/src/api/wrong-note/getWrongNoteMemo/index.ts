import { safeGet } from '@api/http'
import { parseApiResponse } from '@api/config'
import {
  createGetWrongNoteMemoResponseSchema,
  getWrongNoteMemoRequestParamsSchema,
  getWrongNoteMemoRequestQuerySchema,
  getWrongNoteMemoResultSchema
} from '@api/wrong-note/getWrongNoteMemo/schema'

const requestWrongNoteMemo = safeGet(getWrongNoteMemoResultSchema)

export const getWrongNoteMemo = async (questionId: string) => {
  const params = getWrongNoteMemoRequestParamsSchema.parse({ questionId })
  const query = getWrongNoteMemoRequestQuerySchema.parse({})
  const memo = await requestWrongNoteMemo(
    `/v1/wrong-notes/${params.questionId}/memo`,
    query
  )
  parseApiResponse(
    createGetWrongNoteMemoResponseSchema(params.questionId),
    memo
  )
  return memo
}
