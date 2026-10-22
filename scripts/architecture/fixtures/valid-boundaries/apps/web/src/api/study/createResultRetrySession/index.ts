import { safePostWithMetadata } from '@api/http'
import { responseSchema } from '@api/study/createResultRetrySession/schema'

export const createResultRetrySession = safePostWithMetadata(responseSchema)
