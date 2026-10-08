import { safePostWithMetadata } from '@api/http'
import { responseSchema } from '@api/study/cancelStudySession/schema'

export const cancelStudySession = safePostWithMetadata(responseSchema)
