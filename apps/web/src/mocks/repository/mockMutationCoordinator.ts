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

interface MirrorStorage {
  getItem: (key: string) => string | null
  getLatestItem?: (key: string) => string | null
  setItem: (key: string, value: string) => boolean | void
  removeItem: (key: string) => boolean | void
  removeItemForRecovery?: (key: string) => boolean | void
}

export class MockStorageRecoveryError extends Error {
  constructor(
    readonly authorityRecoveryFailed: boolean,
    readonly mirrorRecoveryFailed: boolean,
    cause: unknown
  ) {
    super('Mock storage recovery could not be confirmed.', { cause })
    this.name = 'MockStorageRecoveryError'
  }
}

export const writeMockStorageWithMirror = (
  storage: MirrorStorage,
  authorityKey: string,
  mirrorKey: string,
  serialized: string
): void => {
  const read = (key: string): string | null =>
    storage.getLatestItem ? storage.getLatestItem(key) : storage.getItem(key)
  const previousAuthority = read(authorityKey)
  const previousMirror = read(mirrorKey)
  let attemptedAuthority = false
  const restore = (key: string, value: string | null): boolean => {
    try {
      const result =
        value === null
          ? (storage.removeItemForRecovery ?? storage.removeItem)(key)
          : storage.setItem(key, value)
      return result !== false && read(key) === value
    } catch {
      return false
    }
  }

  try {
    if (storage.setItem(mirrorKey, serialized) === false) {
      throw new Error('Mock storage rejected the mirror write.')
    }
    attemptedAuthority = true
    if (storage.setItem(authorityKey, serialized) === false) {
      throw new Error('Mock storage rejected the authority write.')
    }
  } catch (error: unknown) {
    let authorityRecoveryFailed = false
    if (attemptedAuthority) {
      try {
        if (read(authorityKey) !== previousAuthority) {
          authorityRecoveryFailed = !restore(authorityKey, previousAuthority)
        }
      } catch {
        authorityRecoveryFailed = !restore(authorityKey, previousAuthority)
      }
    }
    const mirrorRecoveryFailed = !restore(mirrorKey, previousMirror)
    if (authorityRecoveryFailed || mirrorRecoveryFailed) {
      throw new MockStorageRecoveryError(
        authorityRecoveryFailed,
        mirrorRecoveryFailed,
        error
      )
    }
    throw error
  }
}
