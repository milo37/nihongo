export type FoundationStage =
  | 'ADMIN_CONNECT'
  | 'LEGACY_CONNECT'
  | 'ENDPOINT_QUERY'
  | 'REGISTER_ROLE'
  | 'CAPABILITY_REGISTER'
  | 'RESET_ROLE'
export interface FoundationDiagnostic {
  readonly event: 'phase7.foundation.initialization'
  readonly stage: FoundationStage
  readonly state: 'BEGIN' | 'COMPLETE' | 'FAILED'
  readonly code?:
    | '28P01'
    | '42501'
    | '23514'
    | '3D000'
    | 'ECONNREFUSED'
    | 'UNKNOWN_REDACTED'
}

const safeCode = (
  error: unknown
): NonNullable<FoundationDiagnostic['code']> => {
  if (error && typeof error === 'object') {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code')
    const value: unknown =
      descriptor && 'value' in descriptor ? descriptor.value : undefined
    for (const code of [
      '28P01',
      '42501',
      '23514',
      '3D000',
      'ECONNREFUSED'
    ] as const) {
      if (value === code) return code
    }
  }
  return 'UNKNOWN_REDACTED'
}

export const runFoundationStage = async <Result>(
  stage: FoundationStage,
  action: () => Promise<Result>,
  report: (diagnostic: FoundationDiagnostic) => void
): Promise<Result> => {
  const emit = (
    state: FoundationDiagnostic['state'],
    code?: FoundationDiagnostic['code']
  ) => {
    try {
      report({
        event: 'phase7.foundation.initialization',
        stage,
        state,
        ...(code ? { code } : {})
      })
    } catch {
      /* Keep diagnostics independent of the operation result. */
    }
  }
  emit('BEGIN')
  try {
    const result = await action()
    emit('COMPLETE')
    return result
  } catch (error: unknown) {
    emit('FAILED', safeCode(error))
    throw error
  }
}
