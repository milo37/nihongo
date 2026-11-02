import { opaqueIdSchema } from '@nihongo/contracts/common/id'
import {
  cachedStorage,
  QUESTION_REPORT_RATE_LIMIT_STORAGE_KEY,
  QUESTION_REPORT_RATE_LIMIT_MIRROR_STORAGE_KEY,
  readFreshLocalStorageItemOrThrow,
  removeFreshLocalStorageItemOrThrow
} from '@nihongo/browser/libs/storage'
import {
  MockMutationCoordinatorUnavailableError,
  runWithMockBrowserMutationLease,
  writeMockStorageWithMirror
} from '@mocks/repository/mockMutationCoordinator'
import type { MockMutationLease } from '@mocks/repository/mockContentState'

export type QuestionReportRateLimitGroup = 'REPORT_ACTOR' | 'REPORT_VERSION'

type ActorRateLimitGroup = Exclude<
  QuestionReportRateLimitGroup,
  'REPORT_VERSION'
>

export type QuestionReportRateLimitInput =
  | { readonly actorId: string; readonly group: ActorRateLimitGroup }
  | { readonly group: 'REPORT_VERSION'; readonly versionId: string }

export interface QuestionReportRateLimitResult {
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

export interface QuestionReportRateLimitStorage {
  readonly getLatestItem?: (key: string) => string | null
  readonly removeItemForRecovery?: (key: string) => boolean | void
  readonly getItem: (key: string) => string | null
  readonly removeItem: (key: string) => void
  readonly setItem: (key: string, value: string) => boolean | void
}

export interface QuestionReportRateLimitRepositoryOptions {
  readonly lease?: MockMutationLease
  readonly now?: () => number
  readonly storage?: QuestionReportRateLimitStorage
}

const policyByGroup: Readonly<
  Record<
    QuestionReportRateLimitGroup,
    { readonly limit: number; readonly windowMs: number }
  >
> = {
  REPORT_ACTOR: { limit: 5, windowMs: 10 * 60 * 1000 },
  REPORT_VERSION: { limit: 20, windowMs: 60 * 60 * 1000 }
}

// Old browser storage may still contain buckets from removed admin handlers.
const rateGroups = new Set<string>([
  ...Object.keys(policyByGroup),
  'ADMIN_EDIT',
  'ADMIN_READ',
  'ADMIN_SENSITIVE',
  'IMPORT_VALIDATION',
  'REAUTHENTICATION'
])

const defaultStorage: QuestionReportRateLimitStorage = {
  getItem: (key) => cachedStorage.getItem(key),
  getLatestItem: (key) => readFreshLocalStorageItemOrThrow(key),
  removeItemForRecovery: (key) => removeFreshLocalStorageItemOrThrow(key),
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
  if (trailing !== undefined || !rateGroups.has(group ?? '')) {
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
    throw new QuestionReportRateLimitRepositoryUnavailableError()
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
    throw new QuestionReportRateLimitRepositoryUnavailableError()
  }
  const windows = new Map<string, RateWindow>(
    value.windows as Array<[string, RateWindow]>
  )
  if (windows.size !== value.windows.length) {
    throw new QuestionReportRateLimitRepositoryUnavailableError()
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

export class QuestionReportRateLimitRepositoryUnavailableError extends Error {
  readonly retryAfterSeconds = 5

  constructor() {
    super('Mock question report rate-limit authority is unavailable.')
    this.name = 'QuestionReportRateLimitRepositoryUnavailableError'
  }
}

export class QuestionReportRateLimitRepository {
  private readonly lease: MockMutationLease
  private readonly now: () => number
  private readonly storage: QuestionReportRateLimitStorage

  constructor(options: QuestionReportRateLimitRepositoryOptions = {}) {
    this.lease = options.lease ?? runWithMockBrowserMutationLease
    this.now = options.now ?? Date.now
    this.storage = options.storage ?? defaultStorage
  }

  async consume(
    input: QuestionReportRateLimitInput
  ): Promise<QuestionReportRateLimitResult> {
    try {
      return await this.lease(async () => {
        const serialized = this.storage.getLatestItem
          ? this.storage.getLatestItem(QUESTION_REPORT_RATE_LIMIT_STORAGE_KEY)
          : this.storage.getItem(QUESTION_REPORT_RATE_LIMIT_STORAGE_KEY)
        const windows = parseState(serialized)
        const now = this.now()
        if (!Number.isSafeInteger(now) || now < 0) {
          throw new QuestionReportRateLimitRepositoryUnavailableError()
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
        writeMockStorageWithMirror(
          this.storage,
          QUESTION_REPORT_RATE_LIMIT_STORAGE_KEY,
          QUESTION_REPORT_RATE_LIMIT_MIRROR_STORAGE_KEY,
          serializeState(windows)
        )
        return {
          retryAfterSeconds: retryAfterSeconds === 0 ? null : retryAfterSeconds
        }
      })
    } catch (error: unknown) {
      if (error instanceof QuestionReportRateLimitRepositoryUnavailableError) {
        throw error
      }
      if (error instanceof MockMutationCoordinatorUnavailableError) {
        throw new QuestionReportRateLimitRepositoryUnavailableError()
      }
      throw new QuestionReportRateLimitRepositoryUnavailableError()
    }
  }

  resetForTesting(): void {
    this.storage.removeItem(QUESTION_REPORT_RATE_LIMIT_STORAGE_KEY)
    this.storage.removeItem(QUESTION_REPORT_RATE_LIMIT_MIRROR_STORAGE_KEY)
  }

  private keysFor(input: QuestionReportRateLimitInput): readonly string[] {
    if (input.group === 'REPORT_VERSION') {
      if (!opaqueIdSchema.safeParse(input.versionId).success) {
        throw new QuestionReportRateLimitRepositoryUnavailableError()
      }
      return [`REPORT_VERSION:version:${input.versionId}`]
    }
    if (!opaqueIdSchema.safeParse(input.actorId).success) {
      throw new QuestionReportRateLimitRepositoryUnavailableError()
    }
    return [
      `${input.group}:actor:${input.actorId}`,
      `${input.group}:ip:mock-client`
    ]
  }
}

export const questionReportRateLimitRepository =
  new QuestionReportRateLimitRepository()
