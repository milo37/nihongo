import { safePostWithMetadata } from '@api/http'
import { responseSchema } from '@api/study/saveStudyDraftAnswers/schema'

export const saveStudyDraftAnswers = safePostWithMetadata(responseSchema)
