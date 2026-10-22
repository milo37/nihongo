import type { Server } from 'node:http'

interface StartApiListenerOptions {
  checkReadiness: () => Promise<void>
  createListener: () => Server
  disconnectDatabase: () => Promise<void>
}

export const startApiListener = async ({
  checkReadiness,
  createListener,
  disconnectDatabase
}: StartApiListenerOptions): Promise<Server> => {
  try {
    await checkReadiness()
    return createListener()
  } catch (error: unknown) {
    await disconnectDatabase()
    throw error
  }
}
