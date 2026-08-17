export type ApiMode = 'mock' | 'real'

interface ResolveApiModeOptions {
  configuredMode?: string
  isProduction: boolean
}

export const resolveApiMode = ({
  configuredMode,
  isProduction
}: ResolveApiModeOptions): ApiMode => {
  if (configuredMode === undefined || configuredMode === '') {
    return isProduction ? 'real' : 'mock'
  }

  if (configuredMode !== 'mock' && configuredMode !== 'real') {
    throw new Error(
      `VITE_API_MODE must be exactly "mock" or "real"; received "${configuredMode}".`
    )
  }

  if (isProduction && configuredMode === 'mock') {
    throw new Error('VITE_API_MODE=mock is forbidden in production.')
  }

  return configuredMode
}
