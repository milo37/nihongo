export const forbiddenProductionRuntimeMarkers = [
  '@axe-core/playwright',
  'axe-core',
  'AxeBuilder',
  'axe.run(',
  'axe.source',
  'axe.version',
  'Deque Systems',
  '@playwright/test',
  'playwright-core'
]

export const validateProductionBundleRuntime = (assets) => {
  if (assets.length === 0) {
    throw new Error('Production bundle scan received no assets')
  }

  for (const asset of assets) {
    for (const marker of forbiddenProductionRuntimeMarkers) {
      if (asset.path.includes(marker) || asset.source.includes(marker)) {
        throw new Error(
          `Production bundle asset ${asset.path} contains forbidden accessibility dev-tool marker ${marker}`
        )
      }
    }
  }
}
