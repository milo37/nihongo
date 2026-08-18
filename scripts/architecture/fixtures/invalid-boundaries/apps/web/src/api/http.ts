export const get = async () => ({ value: 'raw' })
export const safeGet =
  <T>(schema: T) =>
  async (): Promise<T> =>
    schema

export const getWithMetadata = async () => ({ value: 'raw metadata' })
export const safeGetWithMetadata = safeGet
export const safePostWithMetadata = safeGet
export const safePutWithMetadata = safeGet
