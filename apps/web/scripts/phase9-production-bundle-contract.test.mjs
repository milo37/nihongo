import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  forbiddenProductionRuntimeMarkers,
  validateProductionBundleRuntime
} from './phase9-production-bundle-contract.mjs'

const expectedMarkers = [
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

test('keeps the exact production development-tool marker inventory', () => {
  assert.deepEqual(forbiddenProductionRuntimeMarkers, expectedMarkers)
})

test('accepts production assets without accessibility development tooling', () => {
  assert.doesNotThrow(() =>
    validateProductionBundleRuntime([
      { path: 'index.html', source: '<main>JLPT Drill Note</main>' },
      { path: 'assets/index.js', source: 'const application=true;' },
      { path: 'assets/index.css', source: '.ui-tab{display:block}' }
    ])
  )
})

for (const marker of expectedMarkers) {
  test(`rejects the production marker ${marker}`, () => {
    assert.throws(
      () =>
        validateProductionBundleRuntime([
          { path: 'assets/index.js', source: `before ${marker} after` }
        ]),
      new RegExp(`forbidden accessibility dev-tool marker`, 'u')
    )
  })
}

test('rejects a development-tool marker in an emitted asset path', () => {
  assert.throws(
    () =>
      validateProductionBundleRuntime([
        { path: 'assets/playwright-core.js', source: 'const safe=true;' }
      ]),
    /forbidden accessibility dev-tool marker playwright-core/u
  )
})
