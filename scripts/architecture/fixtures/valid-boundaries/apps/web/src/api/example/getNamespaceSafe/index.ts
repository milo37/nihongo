import * as http from '@api/http'
import { responseSchema } from '@api/example/getNamespaceSafe/schema'

export const getNamespaceSafe = http.safeGet(responseSchema)
