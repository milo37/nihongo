import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getWindowFetch/schema'

const unusedValidatedRequest = safeGet(responseSchema)
void unusedValidatedRequest

export const getWindowFetch = async () => window.fetch('/api/raw')
