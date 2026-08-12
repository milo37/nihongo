import { apiClient } from '@api/config'
import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getPropertyBroken/schema'

const unusedValidatedRequest = safeGet(responseSchema)
void unusedValidatedRequest
export const getPropertyBroken = async () => apiClient.get()
