export interface CollectionDiagnostic {
  readonly stage: 'loader' | 'import' | 'setup' | 'unknown'
  readonly name: 'EnvironmentValidationError' | 'Error' | 'UNKNOWN_REDACTED'
  readonly code:
    | 'ERR_MODULE_NOT_FOUND'
    | 'ENVIRONMENT_INVALID'
    | 'EXPORT_MISMATCH'
    | 'WRAPPER_MISSING'
    | 'SCHEMA_MISMATCH'
    | 'UNKNOWN_REDACTED'
}

export const classifyCollectionDiagnostic = (
  value: unknown
): CollectionDiagnostic => {
  const ownText = (key: string): string => {
    if (!value || typeof value !== 'object') return ''
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor &&
      'value' in descriptor &&
      typeof descriptor.value === 'string'
      ? descriptor.value.slice(0, 8192)
      : ''
  }
  const text =
    typeof value === 'string' ? value.slice(0, 8192) : ownText('message')
  const name = ownText('name')
  const code = ownText('code')
  if (
    name === 'EnvironmentValidationError' ||
    /EnvironmentValidationError|API environment validation failed:|ZodError|Invalid environment/u.test(
      text
    )
  ) {
    return {
      stage: 'setup',
      name: 'EnvironmentValidationError',
      code: 'ENVIRONMENT_INVALID'
    }
  }
  if (
    code === 'ERR_MODULE_NOT_FOUND' ||
    /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND/u.test(text)
  ) {
    return { stage: 'loader', name: 'Error', code: 'ERR_MODULE_NOT_FOUND' }
  }
  if (/does not provide an export|No matching export/u.test(text)) {
    return { stage: 'import', name: 'Error', code: 'EXPORT_MISMATCH' }
  }
  if (
    /Phase 7 (?:admin integration|legacy compatibility|development app wrapper) database URL is required/u.test(
      text
    )
  ) {
    return { stage: 'setup', name: 'Error', code: 'WRAPPER_MISSING' }
  }
  if (/schemas must match exactly/u.test(text)) {
    return { stage: 'setup', name: 'Error', code: 'SCHEMA_MISMATCH' }
  }
  return {
    stage: 'unknown',
    name: 'UNKNOWN_REDACTED',
    code: 'UNKNOWN_REDACTED'
  }
}

export const classifyCollectionReport = (
  report: unknown
): readonly CollectionDiagnostic[] => {
  if (!report || typeof report !== 'object') return []
  const descriptor = Object.getOwnPropertyDescriptor(report, 'testResults')
  if (
    !descriptor ||
    !('value' in descriptor) ||
    !Array.isArray(descriptor.value)
  )
    return []
  return descriptor.value
    .slice(0, 3)
    .flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return []
      return ['failureMessage', 'message'].flatMap((key) => {
        const field = Object.getOwnPropertyDescriptor(entry, key)
        return field &&
          'value' in field &&
          typeof field.value === 'string' &&
          field.value.length > 0
          ? [classifyCollectionDiagnostic(field.value)]
          : []
      })
    })
    .slice(0, 3)
}
