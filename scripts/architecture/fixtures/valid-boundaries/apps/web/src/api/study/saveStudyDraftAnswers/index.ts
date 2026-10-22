import { safePutWithMetadata } from '@api/http'
import { responseSchema } from '@api/study/saveStudyDraftAnswers/schema'

export const saveStudyDraftAnswers = safePutWithMetadata(responseSchema)
