import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getFetchAlias/schema'

const requestValidated = safeGet(responseSchema)
const rawFetch = window.fetch

export const getFetchAlias = async () => {
  void requestValidated()
  return rawFetch('/api/raw')
}
