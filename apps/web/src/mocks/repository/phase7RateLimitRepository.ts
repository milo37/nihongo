import { opaqueIdSchema } from '@nihongo/contracts/common/id'
import {
  cachedStorage,
  PHASE7_RATE_LIMIT_STORAGE_KEY,
  readFreshLocalStorageItem
} from '@libs/storage'
import {
  Phase7MutationCoordinatorUnavailableError,
  runWithPhase7BrowserMutationLease
} from '@mocks/repository/phase7MutationCoordinator'
import type { MockPhase7MutationLease } from '@mocks/repository/phase7AdminCmsState'

export type Phase7RateLimitGroup =
  | 'ADMIN_EDIT'
  | 'ADMIN_READ'
  | 'ADMIN_SENSITIVE'
  | 'IMPORT_VALIDATION'
  | 'REAUTHENTICATION'
  | 'REPORT_ACTOR'
  | 'REPORT_VERSION'

type ActorRateLimitGroup = Exclude<Phase7RateLimitGroup, 'REPORT_VERSION'>

export type Phase7RateLimitInput =
  | { readonly actorId: string; readonly group: ActorRateLimitGroup }
  | { readonly group: 'REPORT_VERSION'; readonly versionId: string }

export interface Phase7RateLimitResult {
  readonly retryAfterSeconds: number | null
}

interface RateWindow {
  readonly count: number
  readonly windowStartedAt: number
}

interface PersistedRateLimitState {
  readonly schemaVersion: 1
  readonly windows: readonly (readonly [string, RateWindow])[]
}

export interface Phase7RateLimitStorage {
  readonly getLatestItem?: (key: string) => string | null
  readonly getItem: (key: string) => string | null
  readonly removeItem: (key: string) => void
  readonly setItem: (key: string, value: string) => boolean | void
}

export interface Phase7RateLimitRepositoryOptions {
  readonly lease?: MockPhase7MutationLease
  readonly now?: () => number
  readonly storage?: Phase7RateLimitStorage
}

const policyByGroup: Readonly<
  Record<
    Phase7RateLimitGroup,
    { readonly limit: number; readonly windowMs: number }
  >
> = {
  ADMIN_EDIT: { limit: 30, windowMs: 10 * 60 * 1000 },
  ADMIN_READ: { limit: 120, windowMs: 60 * 1000 },
  ADMIN_SENSITIVE: { limit: 10, windowMs: 15 * 60 * 1000 },
  IMPORT_VALIDATION: { limit: 20, windowMs: 15 * 60 * 1000 },
  REAUTHENTICATION: { limit: 5, windowMs: 15 * 60 * 1000 },
  REPORT_ACTOR: { limit: 5, windowMs: 10 * 60 * 1000 },
  REPORT_VERSION: { limit: 20, windowMs: 60 * 60 * 1000 }
}

const rateGroups = new Set<Phase7RateLimitGroup>(
  Object.keys(policyByGroup) as Phase7RateLimitGroup[]
)

const defaultStorage: Phase7RateLimitStorage = {
  getItem: (key) => cachedStorage.getItem(key),
  getLatestItem: (key) => readFreshLocalStorageItem(key),
  removeItem: (key) => cachedStorage.removeItem(key),
  setItem: (key, value) => cachedStorage.setItem(key, value)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRateWindow = (value: unknown): value is RateWindow =>
  isRecord(value) &&
  Number.isSafeInteger(value.count) &&
  Number(value.count) >= 1 &&
  Number.isSafeInteger(value.windowStartedAt) &&
  Number(value.windowStartedAt) >= 0

const isCanonicalBucketKey = (key: string): boolean => {
  const [group, keyKind, keyValue, trailing] = key.split(':')
  if (
    trailing !== undefined ||
    !rateGroups.has(group as Phase7RateLimitGroup)
  ) {
    return false
  }
  if (keyKind === 'ip') {
    return keyValue === 'mock-client' && group !== 'REPORT_VERSION'
  }
  if (keyKind === 'actor') {
    return (
      group !== 'REPORT_VERSION' && opaqueIdSchema.safeParse(keyValue).success
    )
  }
  return (
    group === 'REPORT_VERSION' &&
    keyKind === 'version' &&
    opaqueIdSchema.safeParse(keyValue).success
  )
}

const parseState = (serialized: string | null): Map<string, RateWindow> => {
  if (serialized === null) return new Map()
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Phase7RateLimitRepositoryUnavailableError()
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.windows) ||
    value.windows.some(
      (entry) =>
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== 'string' ||
        !isCanonicalBucketKey(entry[0]) ||
        !isRateWindow(entry[1])
    )
  ) {
    throw new Phase7RateLimitRepositoryUnavailableError()
  }
  const windows = new Map<string, RateWindow>(
    value.windows as Array<[string, RateWindow]>
  )
  if (windows.size !== value.windows.length) {
    throw new Phase7RateLimitRepositoryUnavailableError()
  }
  return windows
}

const serializeState = (windows: ReadonlyMap<string, RateWindow>): string =>
  JSON.stringify({
    schemaVersion: 1,
    windows: [...windows].toSorted(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    )
  } satisfies PersistedRateLimitState)

export class Phase7RateLimitRepositoryUnavailableError extends Error {
  readonly retryAfterSeconds = 5

  constructor() {
    super('Phase 7 rate-limit authority is unavailable.')
    this.name = 'Phase7RateLimitRepositoryUnavailableError'
  }
}

export class Phase7RateLimitRepository {
  private readonly lease: MockPhase7MutationLease
  private readonly now: () => number
  private readonly storage: Phase7RateLimitStorage

  constructor(options: Phase7RateLimitRepositoryOptions = {}) {
    this.lease = options.lease ?? runWithPhase7BrowserMutationLease
    this.now = options.now ?? Date.now
    this.storage = options.storage ?? defaultStorage
  }

  async consume(input: Phase7RateLimitInput): Promise<Phase7RateLimitResult> {
    try {
      return await this.lease(async () => {
        const serialized = this.storage.getLatestItem
          ? this.storage.getLatestItem(PHASE7_RATE_LIMIT_STORAGE_KEY)
          : this.storage.getItem(PHASE7_RATE_LIMIT_STORAGE_KEY)
        const windows = parseState(serialized)
        const now = this.now()
        if (!Number.isSafeInteger(now) || now < 0) {
          throw new Phase7RateLimitRepositoryUnavailableError()
        }
        const keys = this.keysFor(input)
        const policy = policyByGroup[input.group]
        let retryAfterSeconds = 0
        for (const key of keys) {
          const previous = windows.get(key)
          const current =
            previous === undefined ||
            now >= previous.windowStartedAt + policy.windowMs
              ? { count: 1, windowStartedAt: now }
              : {
                  count: previous.count + 1,
                  windowStartedAt: previous.windowStartedAt
                }
          windows.set(key, current)
          if (current.count > policy.limit) {
            retryAfterSeconds = Math.max(
              retryAfterSeconds,
              Math.max(
                1,
                Math.ceil(
                  (current.windowStartedAt + policy.windowMs - now) / 1000
                )
              )
            )
          }
        }
        if (
          this.storage.setItem(
            PHASE7_RATE_LIMIT_STORAGE_KEY,
            serializeState(windows)
          ) === false
        ) {
          throw new Phase7RateLimitRepositoryUnavailableError()
        }
        return {
          retryAfterSeconds: retryAfterSeconds === 0 ? null : retryAfterSeconds
        }
      })
    } catch (error: unknown) {
      if (error instanceof Phase7RateLimitRepositoryUnavailableError) {
        throw error
      }
      if (error instanceof Phase7MutationCoordinatorUnavailableError) {
        throw new Phase7RateLimitRepositoryUnavailableError()
      }
      throw new Phase7RateLimitRepositoryUnavailableError()
    }
  }

  async primeForTesting(
    input: Phase7RateLimitInput,
    count: number
  ): Promise<void> {
    await this.lease(async () => {
      const serialized = this.storage.getLatestItem
        ? this.storage.getLatestItem(PHASE7_RATE_LIMIT_STORAGE_KEY)
        : this.storage.getItem(PHASE7_RATE_LIMIT_STORAGE_KEY)
      const windows = parseState(serialized)
      const windowStartedAt = this.now()
      for (const key of this.keysFor(input)) {
        windows.set(key, { count, windowStartedAt })
      }
      if (
        this.storage.setItem(
          PHASE7_RATE_LIMIT_STORAGE_KEY,
          serializeState(windows)
        ) === false
      ) {
        throw new Phase7RateLimitRepositoryUnavailableError()
      }
    })
  }

  resetForTesting(): void {
    this.storage.removeItem(PHASE7_RATE_LIMIT_STORAGE_KEY)
  }

  private keysFor(input: Phase7RateLimitInput): readonly string[] {
    if (input.group === 'REPORT_VERSION') {
      if (!opaqueIdSchema.safeParse(input.versionId).success) {
        throw new Phase7RateLimitRepositoryUnavailableError()
      }
      return [`REPORT_VERSION:version:${input.versionId}`]
    }
    if (!opaqueIdSchema.safeParse(input.actorId).success) {
      throw new Phase7RateLimitRepositoryUnavailableError()
    }
    return [
      `${input.group}:actor:${input.actorId}`,
      `${input.group}:ip:mock-client`
    ]
  }
}

export const phase7RateLimitRepository = new Phase7RateLimitRepository()
