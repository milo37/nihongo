const escapePattern = (value) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

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
  'text-display-line-height',
  'text-title-size',
  'text-title-line-height',
  'text-body-size',
  'text-body-line-height',
  'text-label-size',
  'text-label-line-height',
  'text-caption-size',
  'text-caption-line-height',
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

const directMappings = {
  colors: {
    canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
    ink: 'rgb(var(--color-ink) / <alpha-value>)',
    muted: 'rgb(var(--color-muted) / <alpha-value>)',
    subtle: 'rgb(var(--color-subtle) / <alpha-value>)',
    link: 'rgb(var(--color-link) / <alpha-value>)',
    inverse: 'rgb(var(--color-inverse) / <alpha-value>)',
    brand: 'rgb(var(--color-brand) / <alpha-value>)',
    'brand-strong': 'rgb(var(--color-brand-strong) / <alpha-value>)',
    'brand-active': 'rgb(var(--color-brand-active) / <alpha-value>)',
    'brand-soft': 'rgb(var(--color-brand-soft) / <alpha-value>)',
    surface: 'rgb(var(--color-surface) / <alpha-value>)',
    'surface-raised': 'rgb(var(--color-surface-raised) / <alpha-value>)',
    'surface-muted': 'rgb(var(--color-surface-muted) / <alpha-value>)',
    'surface-sunken': 'rgb(var(--color-surface-sunken) / <alpha-value>)',
    line: 'rgb(var(--color-line) / <alpha-value>)',
    'line-strong': 'rgb(var(--color-line-strong) / <alpha-value>)',
    'line-interactive': 'rgb(var(--color-line-interactive) / <alpha-value>)',
    'line-invalid': 'rgb(var(--color-line-invalid) / <alpha-value>)',
    success: 'rgb(var(--color-success) / <alpha-value>)',
    'success-strong': 'rgb(var(--color-success-strong) / <alpha-value>)',
    'success-soft': 'rgb(var(--color-success-soft) / <alpha-value>)',
    'success-line': 'rgb(var(--color-success-line) / <alpha-value>)',
    warning: 'rgb(var(--color-warning) / <alpha-value>)',
    'warning-strong': 'rgb(var(--color-warning-strong) / <alpha-value>)',
    'warning-soft': 'rgb(var(--color-warning-soft) / <alpha-value>)',
    'warning-line': 'rgb(var(--color-warning-line) / <alpha-value>)',
    danger: 'rgb(var(--color-danger) / <alpha-value>)',
    'danger-strong': 'rgb(var(--color-danger-strong) / <alpha-value>)',
    'danger-soft': 'rgb(var(--color-danger-soft) / <alpha-value>)',
    'danger-line': 'rgb(var(--color-danger-line) / <alpha-value>)',
    info: 'rgb(var(--color-info) / <alpha-value>)',
    'info-strong': 'rgb(var(--color-info-strong) / <alpha-value>)',
    'info-soft': 'rgb(var(--color-info-soft) / <alpha-value>)',
    'info-line': 'rgb(var(--color-info-line) / <alpha-value>)',
    overlay: 'rgb(var(--color-overlay) / <alpha-value>)',
    focus: 'rgb(var(--focus-color) / <alpha-value>)',
    'on-accent': 'rgb(var(--color-on-accent) / <alpha-value>)'
  },
  boxShadow: {
    control: 'var(--shadow-control)',
    soft: 'var(--shadow-card)',
    elevated: 'var(--shadow-elevated)'
  },
  borderRadius: {
    control: 'var(--radius-control)',
    card: 'var(--radius-card)',
    panel: 'var(--radius-panel)',
    pill: 'var(--radius-pill)'
  },
  spacing: {
    'page-gutter': 'var(--space-page-gutter)',
    section: 'var(--space-section)'
  },
  screens: {
    phone: '390px',
    tablet: '768px',
    desktop: '1024px',
    wide: '1280px'
  },
  maxWidth: {
    content: 'var(--content-max-width)',
    reading: 'var(--reading-max-width)'
  },
  borderWidth: {
    DEFAULT: 'var(--border-width-default)',
    strong: 'var(--border-width-strong)',
    selected: 'var(--border-width-selected)'
  },
  outlineWidth: {
    focus: 'var(--focus-width)'
  },
  outlineOffset: {
    focus: 'var(--focus-offset)',
    'focus-inset': 'var(--focus-inset-offset)'
  },
  zIndex: {
    base: 'var(--z-base)',
    dropdown: 'var(--z-dropdown)',
    header: 'var(--z-header)',
    overlay: 'var(--z-overlay)',
    dialog: 'var(--z-dialog)',
    toast: 'var(--z-toast)',
    'skip-link': 'var(--z-skip-link)'
  }
}

const fontFamilyMappings = {
  sans: '--font-sans',
  ja: '--font-ja',
  mono: '--font-mono'
}

const fontSizeMappings = {
  display: ['--text-display-size', '--text-display-line-height'],
  title: ['--text-title-size', '--text-title-line-height'],
  body: ['--text-body-size', '--text-body-line-height'],
  label: ['--text-label-size', '--text-label-line-height'],
  caption: ['--text-caption-size', '--text-caption-line-height']
}

const getObjectSection = (source, sectionName) => {
  const marker = new RegExp(`\\b${escapePattern(sectionName)}\\s*:\\s*\\{`, 'u')
  const match = marker.exec(source)
  assert(match?.index !== undefined, `Missing Tailwind section ${sectionName}`)
  const start = source.indexOf('{', match.index)
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(start + 1, index)
  }
  throw new Error(`Unclosed Tailwind section ${sectionName}`)
}

const hasDirectMapping = (section, key, value) =>
  new RegExp(
    `(?:^|\\s)['"]?${escapePattern(key)}['"]?\\s*:\\s*['"]${escapePattern(value)}['"]`,
    'mu'
  ).test(section)

export const validateDesignTokenContract = (styles, tailwind) => {
  for (const token of requiredCssTokens) {
    assert(styles.includes(`--${token}:`), `Missing CSS token --${token}`)
  }

  for (const [sectionName, mappings] of Object.entries(directMappings)) {
    const section = getObjectSection(tailwind, sectionName)
    for (const [key, value] of Object.entries(mappings)) {
      assert(
        hasDirectMapping(section, key, value),
        `Missing exact ${sectionName}.${key} mapping to ${value}`
      )
    }
  }

  const fontFamily = getObjectSection(tailwind, 'fontFamily')
  for (const [key, token] of Object.entries(fontFamilyMappings)) {
    const pattern = new RegExp(
      `(?:^|\\s)['"]?${escapePattern(key)}['"]?\\s*:\\s*\\[\\s*['"]var\\(${escapePattern(token)}\\)['"]\\s*\\]`,
      'mu'
    )
    assert(pattern.test(fontFamily), `Missing exact fontFamily.${key} mapping`)
  }

  const fontSize = getObjectSection(tailwind, 'fontSize')
  for (const [key, [sizeToken, lineHeightToken]] of Object.entries(
    fontSizeMappings
  )) {
    const pattern = new RegExp(
      `(?:^|\\s)['"]?${escapePattern(key)}['"]?\\s*:\\s*\\[\\s*['"]var\\(${escapePattern(sizeToken)}\\)['"]\\s*,\\s*\\{\\s*lineHeight\\s*:\\s*['"]var\\(${escapePattern(lineHeightToken)}\\)['"]\\s*\\}\\s*\\]`,
      'mu'
    )
    assert(pattern.test(fontSize), `Missing exact fontSize.${key} mapping`)
  }
}
