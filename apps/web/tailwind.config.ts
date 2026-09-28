import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
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
        'line-interactive':
          'rgb(var(--color-line-interactive) / <alpha-value>)',
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
      fontFamily: {
        sans: ['var(--font-sans)'],
        ja: ['var(--font-ja)'],
        mono: ['var(--font-mono)']
      },
      fontSize: {
        display: [
          'var(--text-display-size)',
          { lineHeight: 'var(--text-display-line-height)' }
        ],
        title: [
          'var(--text-title-size)',
          { lineHeight: 'var(--text-title-line-height)' }
        ],
        body: [
          'var(--text-body-size)',
          { lineHeight: 'var(--text-body-line-height)' }
        ],
        label: [
          'var(--text-label-size)',
          { lineHeight: 'var(--text-label-line-height)' }
        ],
        caption: [
          'var(--text-caption-size)',
          { lineHeight: 'var(--text-caption-line-height)' }
        ]
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
  },
  plugins: []
}

export default config
