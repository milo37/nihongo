import { getWithMetadata, safeGetWithMetadata } from '@api/http'

export const directMetadata = async () => {
  const validated = safeGetWithMetadata('schema')
  await getWithMetadata()
  return validated()
}
