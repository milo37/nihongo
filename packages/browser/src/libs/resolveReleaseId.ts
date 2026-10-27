export const LOCAL_RELEASE_ID = '0000000000000000000000000000000000000000'

const releaseIdPattern = /^[0-9a-f]{40}$/u

export const resolveReleaseId = (
  configuredId: string | undefined,
  options: { requireDeployable?: boolean } = {}
): string => {
  if (configuredId === undefined || configuredId.length === 0) {
    if (options.requireDeployable) {
      throw new Error('VITE_RELEASE_ID is required for a release build.')
    }
    return LOCAL_RELEASE_ID
  }

  if (!releaseIdPattern.test(configuredId)) {
    throw new Error('VITE_RELEASE_ID must be a lowercase 40-character Git SHA.')
  }

  if (options.requireDeployable && configuredId === LOCAL_RELEASE_ID) {
    throw new Error(
      'The local release sentinel cannot identify a release build.'
    )
  }

  return configuredId
}
