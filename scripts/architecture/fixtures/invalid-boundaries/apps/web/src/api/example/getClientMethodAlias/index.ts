import { apiClient } from '@api/config'
import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getClientMethodAlias/schema'

const request = safeGet(responseSchema)
const rawGet = apiClient.get

export const getClientMethodAlias = async () => {
  void rawGet()
  return request()
}
