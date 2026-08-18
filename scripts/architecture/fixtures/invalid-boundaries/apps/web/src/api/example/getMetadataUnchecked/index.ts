import { safeGetWithMetadata } from '@api/http'
import { responseSchema } from '@api/example/getMetadataUnchecked/schema'

export const getMetadataUnchecked = safeGetWithMetadata(responseSchema)
