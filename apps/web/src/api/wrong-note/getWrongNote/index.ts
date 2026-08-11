import { safeGet } from '@api/http'
import {
  getWrongNoteRequestSchema,
  getWrongNoteResponseSchema
} from '@api/wrong-note/getWrongNote/schema'
import type { GetWrongNoteResponse } from '@api/wrong-note/getWrongNote/schema'

const requestWrongNote = safeGet(getWrongNoteResponseSchema)

export const getWrongNote = (
  questionId: string
): Promise<GetWrongNoteResponse> => {
  const request = getWrongNoteRequestSchema.parse({ questionId })

  return requestWrongNote(`/wrong-note/${request.questionId}`)
}
