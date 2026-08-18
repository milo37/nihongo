export const safeGet =
  <T>(schema: T) =>
  async (): Promise<T> =>
    schema

export const safeGetWithMetadata = safeGet
export const safePostWithMetadata = safeGet
export const safePutWithMetadata = safeGet
