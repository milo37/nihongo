import type { MockMutationLease } from '@mocks/repository/mockContentState'

const MOCK_MUTATION_LOCK_NAME = 'nihongo:mock-database:phase7-admin-cms:v1'

export class MockMutationCoordinatorUnavailableError extends Error {
  constructor() {
    super('Origin-wide mock mutation locking is unavailable.')
    this.name = 'MockMutationCoordinatorUnavailableError'
  }
}

export const createInMemoryMockMutationLease = (): MockMutationLease => {
  let tail: Promise<void> = Promise.resolve()
  return async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = tail.then(operation, operation)
    tail = result.then(
      () => undefined,
      () => undefined
    )
    return await result
  }
}

const testFallbackLease = createInMemoryMockMutationLease()

export const runWithMockBrowserMutationLease: MockMutationLease = async <
  Result
>(
  operation: () => Promise<Result>
): Promise<Result> => {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return await navigator.locks.request(
      MOCK_MUTATION_LOCK_NAME,
      { mode: 'exclusive' },
      operation
    )
  }
  if (import.meta.env.MODE === 'test') {
    return await testFallbackLease(operation)
  }
  throw new MockMutationCoordinatorUnavailableError()
}
