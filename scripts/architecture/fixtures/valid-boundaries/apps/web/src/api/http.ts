export const safeGet =
  <T>(schema: T) =>
  async (): Promise<T> =>
    schema
