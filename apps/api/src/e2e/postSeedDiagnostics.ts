import { getApiIntegrationPathsByOwner } from './apiIntegrationManifest.js'

export type PostSeedOperation =
  | 'COUNT'
  | 'FILE'
  | 'CLEANUP'
  | 'PRISMA_DIFF_CAPTURE'
  | 'PRISMA_DIFF_REPRESENTATION'
type PostSeedState = 'BEGIN' | 'COMPLETE' | 'FAILED'
const errorCodes = [
  '23514',
  '42501',
  'ENOENT',
  'EACCES',
  'ECONNREFUSED'
] as const
type PostSeedErrorCode = (typeof errorCodes)[number] | 'UNKNOWN_REDACTED'

export interface PostSeedDiagnostic {
  readonly stage: `${PostSeedOperation}_${PostSeedState}`
  readonly file?: string
  readonly errorCode?: PostSeedErrorCode
  readonly failedTests?: readonly string[]
}

export const getPostSeedErrorCode = (error: unknown): PostSeedErrorCode => {
  if (error === null || typeof error !== 'object') return 'UNKNOWN_REDACTED'
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code')
  const code: unknown =
    descriptor && 'value' in descriptor ? descriptor.value : undefined
  return errorCodes.find((allowed) => allowed === code) ?? 'UNKNOWN_REDACTED'
}

/** Names of the failed tests of a FILE failure, never the failure text. */
export const getPostSeedFailedTests = (
  error: unknown
): readonly string[] | undefined => {
  if (error === null || typeof error !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(error, 'failedTests')
  const names: unknown =
    descriptor && 'value' in descriptor ? descriptor.value : undefined
  if (
    !Array.isArray(names) ||
    names.length === 0 ||
    !names.every((name) => typeof name === 'string')
  )
    return undefined
  return names.slice(0, 20).map((name: string) => name.slice(0, 300))
}

export const runPostSeedDiagnostic = async <T>(
  operation: PostSeedOperation,
  command: () => Promise<T>,
  report: (diagnostic: PostSeedDiagnostic) => void,
  file?: string
): Promise<T> => {
  const approvedFile =
    operation === 'FILE' &&
    file !== undefined &&
    getApiIntegrationPathsByOwner('db').some((path) => path === file)
      ? file
      : undefined
  const emit = (state: PostSeedState, error?: unknown): void => {
    const failedTests =
      state === 'FAILED' && approvedFile !== undefined
        ? getPostSeedFailedTests(error)
        : undefined
    report({
      stage: `${operation}_${state}`,
      ...(approvedFile === undefined ? {} : { file: approvedFile }),
      ...(state === 'FAILED' ? { errorCode: getPostSeedErrorCode(error) } : {}),
      ...(failedTests === undefined ? {} : { failedTests })
    })
  }
  emit('BEGIN')
  try {
    const result = await command()
    emit('COMPLETE')
    return result
  } catch (error: unknown) {
    emit('FAILED', error)
    throw error
  }
}
