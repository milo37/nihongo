import { get, safeGet } from '@api/http'
import { responseSchema } from '@api/example/getRawAlias/schema'

const request = safeGet(responseSchema)
const rawRequest = get

export const getRawAlias = async () => {
  void rawRequest()
  return request()
}
