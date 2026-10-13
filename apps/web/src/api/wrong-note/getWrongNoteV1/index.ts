import { safeGet } from '@api/http'
import {
  getWrongNoteV1RequestSchema,
  getWrongNoteV1ResponseSchema
} from '@api/wrong-note/getWrongNoteV1/schema'
import type { GetWrongNoteV1Response } from '@api/wrong-note/getWrongNoteV1/schema'

const requestWrongNote = safeGet(getWrongNoteV1ResponseSchema)

export const getWrongNoteV1 = (
  questionId: string
): Promise<GetWrongNoteV1Response> => {
  const request = getWrongNoteV1RequestSchema.parse({ questionId })

  return requestWrongNote(`/v1/wrong-notes/${request.questionId}`)
}
