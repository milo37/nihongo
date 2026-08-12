import { apiClient } from '@api/config'
import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getClientAlias/schema'

const request = safeGet(responseSchema)
const client = apiClient

export const getClientAlias = async () => {
  void client.get()
  return request()
}
