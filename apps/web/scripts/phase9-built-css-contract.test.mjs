import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateBuiltCssContract } from './phase9-built-css-contract.mjs'

test('accepts a selected-tab rule among forced-colors sibling rules', () => {
  const css = [
    '.ui-tab{border-block-end:4px solid transparent}',
    '@media (forced-colors: active){',
    '.before{color:CanvasText}',
    '.ui-tab[aria-selected="true"]{forced-color-adjust:auto;border-block-end-color:Highlight}',
    '.ui-question-jump[data-answered="true"]{border-style:double;forced-color-adjust:auto}',
    '.after{outline:1px solid ButtonText}',
    '}'
  ].join('')

  assert.doesNotThrow(() => validateBuiltCssContract(css))
})

test('rejects a forced-colors selected-tab rule without the system indicator', () => {
  const css =
    '.ui-tab{border-block-end:4px solid transparent}@media (forced-colors:active){.ui-tab[aria-selected=true]{forced-color-adjust:auto}}'

  assert.throws(
    () => validateBuiltCssContract(css),
    /missing the forced-colors selected-tab rule/u
  )
})

test('rejects a forced-colors contract without an answered-question indicator', () => {
  const css =
    '.ui-tab{border-block-end:4px solid transparent}@media (forced-colors:active){.ui-tab[aria-selected=true]{forced-color-adjust:auto;border-block-end-color:Highlight}}'

  assert.throws(
    () => validateBuiltCssContract(css),
    /missing the forced-colors answered-question indicator/u
  )
})
