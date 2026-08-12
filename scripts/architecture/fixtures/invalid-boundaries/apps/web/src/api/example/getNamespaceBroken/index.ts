import * as config from '@api/config'
import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getNamespaceBroken/schema'

const unusedValidatedRequest = safeGet(responseSchema)
void unusedValidatedRequest

export const getNamespaceBroken = async () => config.apiClient.get()
