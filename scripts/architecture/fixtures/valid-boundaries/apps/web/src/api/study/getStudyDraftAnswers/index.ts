import { safeGetWithMetadata } from '@api/http'
import { responseSchema } from '@api/study/getStudyDraftAnswers/schema'

export const getStudyDraftAnswers = safeGetWithMetadata(responseSchema)
