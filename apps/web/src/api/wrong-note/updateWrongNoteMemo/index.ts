import { safePut } from '@api/http'
import {
  updateWrongNoteMemoParamsSchema,
  updateWrongNoteMemoRequestSchema,
  updateWrongNoteMemoResponseSchema
} from '@api/wrong-note/updateWrongNoteMemo/schema'
import type {
  UpdateWrongNoteMemoRequest,
  UpdateWrongNoteMemoResponse
} from '@api/wrong-note/updateWrongNoteMemo/schema'

const requestMemoUpdate = safePut(updateWrongNoteMemoResponseSchema)

export const updateWrongNoteMemo = (
  questionId: string,
  input: UpdateWrongNoteMemoRequest
): Promise<UpdateWrongNoteMemoResponse> => {
  const params = updateWrongNoteMemoParamsSchema.parse({ questionId })
  const request = updateWrongNoteMemoRequestSchema.parse(input)

  return requestMemoUpdate(`/wrong-note/${params.questionId}/memo`, request)
}
