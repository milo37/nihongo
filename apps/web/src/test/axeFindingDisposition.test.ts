import { describe, expect, it } from 'vitest'
import {
  axeFindingDispositionSelectors,
  createAxeFindingDispositionKey
} from '@/test/axeFindingDisposition'

describe('createAxeFindingDispositionKey', () => {
  it('keeps dispositions scoped to both the rule and DOM target', () => {
    const target = ['main', ['.card', '.label']] as const

    expect(createAxeFindingDispositionKey('color-contrast', target)).not.toBe(
      createAxeFindingDispositionKey('aria-valid-attr-value', target)
    )
    expect(createAxeFindingDispositionKey('color-contrast', target)).toBe(
      createAxeFindingDispositionKey('color-contrast', [
        'main',
        ['.card', '.label']
      ])
    )
  })

  it('scopes the table-sort disposition to the decorative indicator', () => {
    const header = document.createElement('th')
    header.setAttribute('aria-sort', 'ascending')
    header.innerHTML =
      '<button><span class="column-title">분류</span><span class="ui-table-sort-indicator">↑</span></button>'
    const title = header.querySelector('.column-title')
    const indicator = header.querySelector('.ui-table-sort-indicator')

    expect(title).not.toBeNull()
    expect(indicator).not.toBeNull()
    expect(
      title?.matches(axeFindingDispositionSelectors.tableSortIndicator)
    ).toBe(false)
    expect(
      indicator?.matches(axeFindingDispositionSelectors.tableSortIndicator)
    ).toBe(true)
  })
})
