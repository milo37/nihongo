import type { MockPhase7MutationLease } from '@mocks/repository/phase7AdminCmsState'

const PHASE7_MUTATION_LOCK_NAME = 'nihongo:mock-database:phase7-admin-cms:v1'

export class Phase7MutationCoordinatorUnavailableError extends Error {
  constructor() {
    super('Origin-wide Phase 7 mutation locking is unavailable.')
    this.name = 'Phase7MutationCoordinatorUnavailableError'
  }
}

export const createInMemoryPhase7MutationLease =
  (): MockPhase7MutationLease => {
    let tail: Promise<void> = Promise.resolve()
    return async <Result>(
      operation: () => Promise<Result>
    ): Promise<Result> => {
      const result = tail.then(operation, operation)
      tail = result.then(
        () => undefined,
        () => undefined
      )
      return await result
    }
  }

const testFallbackLease = createInMemoryPhase7MutationLease()

export const runWithPhase7BrowserMutationLease: MockPhase7MutationLease =
  async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(
        PHASE7_MUTATION_LOCK_NAME,
        { mode: 'exclusive' },
        operation
      )
    }
    if (import.meta.env.MODE === 'test') {
      return await testFallbackLease(operation)
    }
    throw new Phase7MutationCoordinatorUnavailableError()
  }
