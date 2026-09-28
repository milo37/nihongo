import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, URL } from 'node:url'
import { validateDesignTokenContract } from './phase9-design-token-contract.mjs'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const styles = await readFile(resolve(webRoot, 'src/styles.css'), 'utf8')
const tailwind = await readFile(resolve(webRoot, 'tailwind.config.ts'), 'utf8')

test('accepts the exact CSS-token and Tailwind-section mappings', () => {
  assert.doesNotThrow(() => validateDesignTokenContract(styles, tailwind))
})

test('rejects a color alias moved to the wrong section', () => {
  const wrongSection = tailwind
    .replace(
      "overlay: 'rgb(var(--color-overlay) / <alpha-value>)'",
      "overlay: 'rgb(var(--color-canvas) / <alpha-value>)'"
    )
    .replace(
      "overlay: 'var(--z-overlay)'",
      "overlay: 'rgb(var(--color-overlay) / <alpha-value>)'"
    )

  assert.throws(
    () => validateDesignTokenContract(styles, wrongSection),
    /Missing exact colors\.overlay mapping/u
  )
})

test('rejects a missing typography line-height token', () => {
  const missingLineHeight = styles.replace(
    '--text-display-line-height:',
    '--removed-display-line-height:'
  )

  assert.throws(
    () => validateDesignTokenContract(missingLineHeight, tailwind),
    /Missing CSS token --text-display-line-height/u
  )
})
