import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getIgnoredValidation/schema'

const requestValidated = safeGet(responseSchema)

export const getIgnoredValidation = async () => {
  void requestValidated()
  return { value: 'unchecked' }
}
