import { getPhase10ApiIntegrationPathsByOwner } from './phase10ApiIntegrationManifest.js'

export type PostSeedOperation = 'COUNT' | 'FILE' | 'CLEANUP'
export type PostSeedState = 'BEGIN' | 'COMPLETE' | 'FAILED'
const errorCodes = [
  '23514',
  '42501',
  'ENOENT',
  'EACCES',
  'ECONNREFUSED'
] as const
export type PostSeedErrorCode = (typeof errorCodes)[number] | 'UNKNOWN_REDACTED'

export interface PostSeedDiagnostic {
  readonly stage: `${PostSeedOperation}_${PostSeedState}`
  readonly file?: string
  readonly errorCode?: PostSeedErrorCode
}

export const getPostSeedErrorCode = (error: unknown): PostSeedErrorCode => {
  if (error === null || typeof error !== 'object') return 'UNKNOWN_REDACTED'
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code')
  const code: unknown =
    descriptor && 'value' in descriptor ? descriptor.value : undefined
  return errorCodes.find((allowed) => allowed === code) ?? 'UNKNOWN_REDACTED'
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
    getPhase10ApiIntegrationPathsByOwner('phase7-db').some(
      (path) => path === file
    )
      ? file
      : undefined
  const emit = (state: PostSeedState, error?: unknown): void => {
    report({
      stage: `${operation}_${state}`,
      ...(approvedFile === undefined ? {} : { file: approvedFile }),
      ...(state === 'FAILED' ? { errorCode: getPostSeedErrorCode(error) } : {})
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
