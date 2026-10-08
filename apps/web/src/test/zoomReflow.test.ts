import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import sourceCss from '@/styles.css?raw'

const css = postcss.parse(sourceCss)

describe('browser zoom reflow CSS contract', () => {
  it.each([160, 195, 320, 390])(
    'does not impose a document minimum wider than the %ipx CSS viewport',
    (viewport) => {
      for (const selector of ['html', 'body']) {
        let minimum = 0
        css.walkRules(selector, (rule) => {
          // Exclude modal or motion selectors; only the normal document root.
          rule.walkDecls('min-width', (declaration) => {
            minimum = Math.max(minimum, Number.parseFloat(declaration.value))
          })
        })
        expect(minimum).toBeLessThanOrEqual(viewport)
      }
    }
  )
  it('does not hide document overflow to disguise inaccessible content', () => {
    for (const selector of ['html', 'body', '#root']) {
      css.walkRules(selector, (rule) => {
        rule.walkDecls(/^(overflow|overflow-x)$/, (declaration) => {
          expect(['hidden', 'clip']).not.toContain(declaration.value)
        })
      })
    }
  })
  it('keeps zoom-specific layout changes below the ordinary 320px mobile baseline', () => {
    const zoomRules = css.nodes.filter(
      (node) =>
        node.type === 'atrule' &&
        node.name === 'media' &&
        node.params === '(max-width: 319px)'
    )
    expect(zoomRules.length).toBeGreaterThan(0)
    const narrowColumns = new Map<string, string>()
    const narrowSelectors = new Set<string>()
    for (const scope of zoomRules) {
      if (scope.type !== 'atrule')
        throw new Error('Expected narrow media scope')
      scope.walkDecls(/^(font-size|overflow|overflow-x)$/, () => {
        throw new Error('Zoom reflow must not shrink text or hide overflow')
      })
      scope.walkRules((rule) => {
        narrowSelectors.add(rule.selector)
        rule.walkDecls('grid-template-columns', (declaration) => {
          narrowColumns.set(
            rule.selector,
            declaration.value.replace(/\s/gu, '')
          )
        })
      })
    }
    expect(narrowColumns.get('.learning-note fieldset .grid-cols-5')).toBe(
      'repeat(2,minmax(2.75rem,1fr))'
    )
    expect(narrowColumns.get('.learning-note > .grid')).toBe('minmax(0,1fr)')
    expect(narrowSelectors.has('.ui-dialog')).toBe(true)
    expect(narrowColumns.get('.a2-subjects')).toBe('minmax(0,1fr)')
    expect(narrowColumns.get('.a2-levels')).toBe('repeat(2,minmax(0,1fr))')
  })
})

// The archived public hero and the current learning-note home have different
// wrappers. Both must receive the fix without a document-wide clipping rule.
it.each(['committed-hero', 'learning-note'])(
  'D16-01/03: reflows intrinsic home content and level targets (%s)',
  (home) => {
    const fixture = document.createElement('main')
    fixture.innerHTML = `<section class="${home}"><div class="grid"><div data-hero>JLPT VOCABULARY</div><div><fieldset><div class="grid grid-cols-5"><button>N1</button></div></fieldset></div></div></section>`
    const hero = fixture.querySelector('[data-hero]')
    const levels = fixture.querySelector('.grid-cols-5')
    const declarations = (element: Element | null, property: string) => {
      const values: string[] = []
      css.walkRules((rule) => {
        if (
          rule.selector.startsWith(
            'main > section:has(fieldset .grid-cols-5)'
          ) &&
          element?.matches(rule.selector)
        ) {
          rule.walkDecls(property, (declaration) => {
            values.push(declaration.value)
          })
        }
      })
      return values
    }
    expect(declarations(hero, 'min-inline-size')).toContain('0')
    expect(
      declarations(fixture.querySelector('section'), 'overflow-wrap')
    ).toContain('anywhere')
    expect(declarations(levels, 'grid-template-columns')).toContain(
      'repeat(auto-fit, minmax(2.75rem, 1fr))'
    )
    // At root font 16px, two targets and their 8px gap fit the 96px inner
    // quick-start width reported for a 160px zoom viewport.
    expect(2 * 2.75 * 16 + 8).toBeLessThanOrEqual(96)
  }
)

it('D16-02: reserves independent title width and scroll access to dialog actions', () => {
  const value = (selector: string, property: string) => {
    const values: string[] = []
    css.walkRules(selector, (rule) => {
      rule.walkDecls(property, (declaration) => {
        values.push(declaration.value)
      })
    })
    return values
  }
  expect(value('.ui-dialog', 'overflow-y')).toContain('auto')
  expect(value('.ui-dialog-layout', 'max-height')).toContain('none')
  expect(value('.ui-dialog-header', 'grid-template-columns')).toContain(
    'minmax(0, 1fr)'
  )
  expect(value('.ui-dialog-header > button', 'grid-row')).toContain('1')
  expect(value('.ui-dialog-header > div', 'grid-row')).toContain('2')
  expect(value('.ui-dialog-footer :is(button, a)', 'white-space')).toContain(
    'normal'
  )
})
