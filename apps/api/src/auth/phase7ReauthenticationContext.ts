import { AsyncLocalStorage } from 'node:async_hooks'

interface Phase7ReauthenticationInvocation {
  readonly intentId: string
}

export interface Phase7ReauthenticationContext {
  readonly getIntentId: () => string
  readonly run: <Result>(
    intentId: string,
    task: () => Promise<Result>
  ) => Promise<Result>
}

export const createPhase7ReauthenticationContext =
  (): Phase7ReauthenticationContext => {
    const storage = new AsyncLocalStorage<Phase7ReauthenticationInvocation>()

    return {
      getIntentId: () => {
        const invocation = storage.getStore()
        if (!invocation) {
          throw new Error('Reauthentication adapter context is unavailable.')
        }
        return invocation.intentId
      },
      run: async (intentId, task) => {
        if (storage.getStore()) {
          throw new Error('Nested reauthentication adapter context is denied.')
        }
        return await storage.run({ intentId }, task)
      }
    }
  }
