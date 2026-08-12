import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getStoredResult/schema'

const request = safeGet(responseSchema)

export const getStoredResult = async () => {
  const result = await request()
  return result
}
