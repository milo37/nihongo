import { readdir, readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { validateDesignTokenContract } from './phase9-design-token-contract.mjs'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceRoot = resolve(webRoot, 'src')
const stylesPath = resolve(sourceRoot, 'styles.css')
const tailwindPath = resolve(webRoot, 'tailwind.config.ts')

const requiredCssTokens = [
  'color-canvas',
  'color-ink',
  'color-muted',
  'color-subtle',
  'color-link',
  'color-inverse',
  'color-brand',
  'color-brand-strong',
  'color-brand-active',
  'color-brand-soft',
  'color-surface',
  'color-surface-raised',
  'color-surface-muted',
  'color-surface-sunken',
  'color-line',
  'color-line-strong',
  'color-line-interactive',
  'color-line-invalid',
  'color-success',
  'color-success-strong',
  'color-success-soft',
  'color-success-line',
  'color-warning',
  'color-warning-strong',
  'color-warning-soft',
  'color-warning-line',
  'color-danger',
  'color-danger-strong',
  'color-danger-soft',
  'color-danger-line',
  'color-info',
  'color-info-strong',
  'color-info-soft',
  'color-info-line',
  'color-overlay',
  'color-on-accent',
  'focus-color',
  'focus-width',
  'focus-offset',
  'focus-inset-offset',
  'font-sans',
  'font-ja',
  'font-mono',
  'text-display-size',
  'text-title-size',
  'text-body-size',
  'text-label-size',
  'text-caption-size',
  'space-page-gutter',
  'space-section',
  'content-max-width',
  'reading-max-width',
  'border-width-default',
  'border-width-strong',
  'border-width-selected',
  'radius-control',
  'radius-card',
  'radius-panel',
  'radius-pill',
  'shadow-control',
  'shadow-card',
  'shadow-elevated',
  'z-base',
  'z-dropdown',
  'z-header',
  'z-overlay',
  'z-dialog',
  'z-toast',
  'z-skip-link'
]

const requiredTailwindAliases = [
  'canvas',
  'ink',
  'muted',
  'subtle',
  'link',
  'inverse',
  'brand',
  'brand-strong',
  'brand-active',
  'brand-soft',
  'surface',
  'surface-raised',
  'surface-muted',
  'surface-sunken',
  'line',
  'line-strong',
  'line-interactive',
  'line-invalid',
  'success',
  'success-strong',
  'success-soft',
  'success-line',
  'warning',
  'warning-strong',
  'warning-soft',
  'warning-line',
  'danger',
  'danger-strong',
  'danger-soft',
  'danger-line',
  'info',
  'info-strong',
  'info-soft',
  'info-line',
  'on-accent',
  'ja',
  'mono',
  'display',
  'title',
  'body',
  'label',
  'caption',
  'page-gutter',
  'section',
  'content',
  'reading',
  'strong',
  'selected',
  'focus',
  'focus-inset',
  'base',
  'dropdown',
  'header',
  'overlay',
  'dialog',
  'toast',
  'skip-link'
]

const requiredScreens = ['phone', 'tablet', 'desktop', 'wide']
const rawPalettePattern =
  /(?:slate|emerald|red|green|amber|blue)-(?:50|100|200|300|400|500|600|700|800|900|950)/gu

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const escapePattern = (value) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const hasConfigKey = (source, key) =>
  new RegExp(`(?:^|\\s)['"]?${escapePattern(key)}['"]?\\s*:`, 'mu').test(source)

const listProductionTypeScript = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) return listProductionTypeScript(path)
      if (!['.ts', '.tsx'].includes(extname(entry.name))) return []
      if (entry.name.includes('.test.') || entry.name.includes('.stories.')) {
        return []
      }
      return [path]
    })
  )
  return nested.flat()
}

const readSources = async (paths) =>
  Promise.all(
    paths.map(async (path) => ({ path, source: await readFile(path, 'utf8') }))
  )

const countMatches = (sources, pattern) =>
  sources.reduce(
    (count, { source }) => count + [...source.matchAll(pattern)].length,
    0
  )

const styles = await readFile(stylesPath, 'utf8')
const tailwind = await readFile(tailwindPath, 'utf8')

validateDesignTokenContract(styles, tailwind)

for (const token of requiredCssTokens) {
  assert(styles.includes(`--${token}:`), `Missing CSS token --${token}`)
}
for (const alias of requiredTailwindAliases) {
  assert(hasConfigKey(tailwind, alias), `Missing Tailwind alias ${alias}`)
}
for (const screen of requiredScreens) {
  assert(hasConfigKey(tailwind, screen), `Missing Tailwind screen ${screen}`)
}

const commonPaths = await listProductionTypeScript(
  resolve(sourceRoot, 'common/components')
)
const appPaths = await listProductionTypeScript(resolve(sourceRoot, 'app'))
const commonSources = await readSources(commonPaths)
const appSources = await readSources(appPaths)
const consumerPaths = [
  resolve(sourceRoot, 'app/layout.tsx'),
  resolve(sourceRoot, 'app/admin-question/page.tsx'),
  resolve(sourceRoot, 'app/dashboard/components/DashboardInsightsSection.tsx')
]
const consumerSources = await readSources(consumerPaths)

const requiredRoleConsumers = {
  'Badge.tsx': [
    'border-line-interactive',
    'border-success-line',
    'border-warning-line',
    'border-danger-line',
    'border-info-line'
  ],
  'Toast.tsx': [
    'border-success-line',
    'border-warning-line',
    'border-danger-line',
    'border-info-line'
  ],
  'Input.tsx': ['border-line-invalid'],
  'Textarea.tsx': ['border-line-invalid'],
  'Select.tsx': ['border-line-invalid'],
  'RadioGroup.tsx': ['border-line-invalid'],
  'Checkbox.tsx': ['border-line-invalid'],
  'Button.tsx': ['active:bg-brand-active']
}

for (const [fileName, classNames] of Object.entries(requiredRoleConsumers)) {
  const source = commonSources.find(({ path }) =>
    path.endsWith(`/${fileName}`)
  )?.source
  assert(source, `Missing primitive consumer ${fileName}`)
  for (const className of classNames) {
    assert(
      source.includes(className),
      `${fileName} must consume semantic role ${className}`
    )
  }
}

const commonRawPaletteCount = countMatches(commonSources, rawPalettePattern)
const consumerRawPaletteCount = countMatches(consumerSources, rawPalettePattern)
const overallRawPaletteCount = countMatches(
  [...appSources, ...commonSources],
  rawPalettePattern
)

assert(
  commonRawPaletteCount === 0,
  `Shared primitive raw palette target is 0, received ${commonRawPaletteCount}`
)
assert(
  consumerRawPaletteCount === 0,
  `Slice 1 consumer raw palette target is 0, received ${consumerRawPaletteCount}`
)
assert(
  overallRawPaletteCount < 411,
  `Overall raw palette count must be below baseline 411, received ${overallRawPaletteCount}`
)

const allSources = [...appSources, ...commonSources]
const tabsExportCount = countMatches(allSources, /export const Tabs\b/gu)
const tableExportCount = countMatches(allSources, /export const Table\b/gu)
const tabsImportCount = countMatches(
  appSources,
  /from ['"]@common\/components\/Tabs['"]/gu
)
const tableImportCount = countMatches(
  appSources,
  /from ['"]@common\/components\/Table['"]/gu
)

assert(
  tabsExportCount === 1,
  `Expected 1 shared Tabs export, got ${tabsExportCount}`
)
assert(
  tableExportCount === 1,
  `Expected 1 shared Table export, got ${tableExportCount}`
)
assert(tabsImportCount >= 1, 'Tabs needs at least one application consumer')
assert(tableImportCount >= 1, 'Table needs at least one application consumer')

stdout.write(
  `${JSON.stringify({
    commonRawPaletteCount,
    consumerRawPaletteCount,
    overallRawPaletteCount,
    tableExportCount,
    tableImportCount,
    tabsExportCount,
    tabsImportCount
  })}\n`
)
