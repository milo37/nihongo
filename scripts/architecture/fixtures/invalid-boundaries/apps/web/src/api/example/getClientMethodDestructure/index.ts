import { apiClient } from '@api/config'
import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getClientMethodDestructure/schema'

const request = safeGet(responseSchema)
const { get: rawGet } = apiClient

export const getClientMethodDestructure = async () => {
  void rawGet()
  return request()
}
