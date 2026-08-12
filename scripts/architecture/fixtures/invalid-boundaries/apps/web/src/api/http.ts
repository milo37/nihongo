export const get = async () => ({ value: 'raw' })
export const safeGet =
  <T>(schema: T) =>
  async (): Promise<T> =>
    schema
