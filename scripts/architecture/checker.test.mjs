import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkArchitecture } from './checker.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))

const checkFixture = (name) => {
  const rootDir = path.join(directory, 'fixtures', name)
  return checkArchitecture({
    rootDir,
    tsconfigPath: path.join(rootDir, 'apps/web/tsconfig.json'),
    sourceRoot: path.join(rootDir, 'apps/web/src')
  })
}

describe('architecture checker', () => {
  it('allows type-only API imports and supported Query/Mock boundaries', () => {
    assert.deepEqual(checkFixture('valid-boundaries'), [])
  })

  it('reports forbidden runtime boundaries with source locations', () => {
    const diagnostics = checkFixture('invalid-boundaries')
    const codes = new Set(diagnostics.map(({ code }) => code))

    assert.deepEqual([...codes].sort(), [
      'ARCH001',
      'ARCH002',
      'ARCH003',
      'ARCH004',
      'ARCH005'
    ])
    const countByCode = diagnostics.reduce((counts, diagnostic) => {
      counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1)
      return counts
    }, new Map())

    assert.ok((countByCode.get('ARCH002') ?? 0) >= 4)
    assert.ok((countByCode.get('ARCH003') ?? 0) >= 3)
    assert.ok((countByCode.get('ARCH005') ?? 0) >= 8)

    const codesFor = (suffix) =>
      diagnostics
        .filter(({ file }) => file.endsWith(suffix))
        .map(({ code }) => code)

    assert.deepEqual(codesFor('/getUnchecked/index.ts'), ['ARCH005'])
    assert.deepEqual(codesFor('/getNamespaceBroken/index.ts'), ['ARCH005'])
    assert.deepEqual(codesFor('/getWindowFetch/index.ts'), ['ARCH005'])
    assert.deepEqual(codesFor('/getFakeSchema/index.ts'), ['ARCH005'])
    assert.deepEqual(codesFor('/getIgnoredValidation/index.ts'), ['ARCH005'])
    assert.deepEqual(codesFor('/getFetchAlias/index.ts'), ['ARCH005'])
    assert.deepEqual(codesFor('/getRawAlias/index.ts'), ['ARCH005'])
    assert.deepEqual(codesFor('/getClientAlias/index.ts'), ['ARCH005'])
    assert.deepEqual(codesFor('/getClientMethodAlias/index.ts'), ['ARCH005'])
    assert.deepEqual(codesFor('/getClientMethodDestructure/index.ts'), [
      'ARCH005'
    ])
    assert.deepEqual(codesFor('/WindowFetchPage.tsx'), ['ARCH002'])
    assert.deepEqual(codesFor('/GlobalFetchPage.tsx'), ['ARCH002'])
    assert.deepEqual(codesFor('/IndirectPage.tsx'), ['ARCH002', 'ARCH003'])
    assert.deepEqual(codesFor('/DynamicImportPage.tsx'), ['ARCH002'])
    assert.deepEqual(codesFor('/NamespaceIndirectPage.tsx'), [
      'ARCH002',
      'ARCH003'
    ])
    assert.deepEqual(codesFor('/DestructuredFetchPage.tsx'), ['ARCH002'])
    assert.deepEqual(codesFor('/QueryClientIndirectPage.tsx'), ['ARCH003'])
    assert.deepEqual(codesFor('/DynamicIndirectPage.tsx'), [
      'ARCH002',
      'ARCH003'
    ])

    for (const diagnostic of diagnostics) {
      assert.match(diagnostic.file, /^apps\/web\/src\//)
      assert.ok(diagnostic.line > 0)
      assert.ok(diagnostic.column > 0)
    }
  })

  it('reports a runtime cycle once while ignoring type-only cycles', () => {
    const diagnostics = checkFixture('invalid-runtime-cycle')
    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0]?.code, 'ARCH006')
    assert.match(diagnostics[0]?.message ?? '', /cycle\/a\.ts/)
    assert.match(diagnostics[0]?.message ?? '', /cycle\/b\.ts/)
  })
})
