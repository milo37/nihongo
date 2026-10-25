import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
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

const withPhase7Fixture = (run) => {
  const root = fs.mkdtempSync(
    path.join(tmpdir(), 'nihongo-phase7-architecture-')
  )
  const repository = path.resolve(directory, '../..')
  try {
    for (const relative of [
      'apps/web/src',
      'packages/contracts/src',
      'packages/contracts/dist'
    ]) {
      fs.cpSync(path.join(repository, relative), path.join(root, relative), {
        recursive: true
      })
    }
    const sourceRoot = path.join(root, 'apps/web/src')
    const files = []
    const add = (
      name,
      source,
      schema = fs.readFileSync(
        path.join(sourceRoot, 'api/admin-question/listAdminQuestion/schema.ts'),
        'utf8'
      )
    ) => {
      const folder = path.join(sourceRoot, 'api/admin-question', name)
      fs.mkdirSync(folder, { recursive: true })
      fs.writeFileSync(path.join(folder, 'index.ts'), source)
      files.push(path.join(folder, 'index.ts'))
      if (schema !== null) {
        fs.writeFileSync(path.join(folder, 'schema.ts'), schema)
        files.push(path.join(folder, 'schema.ts'))
      }
    }
    const check = (contractDirectory = 'dist') => {
      const tsconfigPath = path.join(root, 'tsconfig.json')
      fs.writeFileSync(
        tsconfigPath,
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            baseUrl: root,
            types: [],
            skipLibCheck: true,
            paths: {
              '@/*': ['apps/web/src/*'],
              '@api/*': ['apps/web/src/api/*'],
              '@libs/*': ['apps/web/src/libs/*'],
              '@nihongo/contracts/*': [
                `packages/contracts/${contractDirectory}/*`
              ],
              zod: [path.join(repository, 'apps/web/node_modules/zod')],
              axios: [path.join(repository, 'apps/web/node_modules/axios')]
            }
          },
          files
        })
      )
      return checkArchitecture({
        rootDir: root,
        tsconfigPath,
        sourceRoot
      })
    }
    const actualHelper = 'apps/web/src/api/phase7/requestPhase7Operation.ts'
    assert.equal(
      fs.readFileSync(path.join(root, actualHelper), 'utf8'),
      fs.readFileSync(path.join(repository, actualHelper), 'utf8')
    )
    run({ root, sourceRoot, files, add, check })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const phase7Import =
  "import { requestPhase7Operation } from '@api/phase7/requestPhase7Operation'\n"
const phase7Input =
  "{ operation: 'listAdminQuestions', params: {}, query: {}, body: undefined }"
const phase7Return = `requestPhase7Operation(${phase7Input})`

describe('canonical Phase7 endpoint validation', () => {
  it('allows all six actual endpoints and checked returns with source/dist contract identities', () =>
    withPhase7Fixture(({ sourceRoot, files, add, check }) => {
      for (const name of [
        'listAdminQuestion',
        'getAdminQuestion',
        'previewQuestionVersion',
        'createAdminQuestion',
        'updateAdminQuestion',
        'deleteAdminQuestion'
      ]) {
        for (const leaf of ['index.ts', 'schema.ts'])
          files.push(path.join(sourceRoot, 'api/admin-question', name, leaf))
      }
      add(
        'getAwaitedPhase7',
        `${phase7Import}export const endpoint = async () => await ${phase7Return}`
      )
      add(
        'getConstPhase7',
        `${phase7Import}export const endpoint = async () => { const result = await ${phase7Return}; return result }`
      )
      assert.deepEqual(check('src'), [])
      assert.deepEqual(check('dist'), [])
    }))

  it('rejects forged helpers, aliases, wrong schemas, dynamic operations, unchecked returns and raw transports', () =>
    withPhase7Fixture(({ sourceRoot, add, check }) => {
      fs.writeFileSync(
        path.join(sourceRoot, 'api/phase7/fakeHelper.ts'),
        'export const requestPhase7Operation = async (_input: unknown) => ({})'
      )
      fs.writeFileSync(
        path.join(sourceRoot, 'api/phase7/facade.ts'),
        "export { requestPhase7Operation } from '@api/phase7/requestPhase7Operation'"
      )
      fs.writeFileSync(
        path.join(sourceRoot, 'api/phase7/fakeFacade.ts'),
        "export { requestPhase7Operation } from '@api/phase7/fakeHelper'"
      )
      const cases = new Map([
        [
          'getFakePhase7',
          `import { requestPhase7Operation } from '@api/phase7/fakeHelper'; export const endpoint = () => ${phase7Return}`
        ],
        [
          'getReexportedPhase7',
          `import { requestPhase7Operation } from '@api/phase7/facade'; export const endpoint = () => ${phase7Return}`
        ],
        [
          'getFakeReexportPhase7',
          `import { requestPhase7Operation } from '@api/phase7/fakeFacade'; export const endpoint = () => ${phase7Return}`
        ],
        [
          'getRenamedPhase7',
          `import { requestPhase7Operation as renamed } from '@api/phase7/requestPhase7Operation'; export const endpoint = () => renamed(${phase7Input})`
        ],
        [
          'getVariableAliasPhase7',
          `${phase7Import}const renamed = requestPhase7Operation; export const endpoint = () => renamed(${phase7Input})`
        ],
        [
          'getRawRenamedPhase7',
          `import { get as requestPhase7Operation } from '@api/http'; export const endpoint = () => ${phase7Return}`
        ],
        [
          'getLocalFakePhase7',
          `const requestPhase7Operation = async (_input: unknown) => ({}); export const endpoint = () => ${phase7Return}`
        ],
        [
          'getUnknownPhase7',
          `${phase7Import}export const endpoint = () => requestPhase7Operation({ operation: 'unknownOperation', params: {}, query: {}, body: undefined })`
        ],
        [
          'getDynamicPhase7',
          `${phase7Import}const operation = 'listAdminQuestions'; export const endpoint = () => requestPhase7Operation({ operation, params: {}, query: {}, body: undefined })`
        ],
        [
          'getSpreadPhase7',
          `${phase7Import}export const endpoint = () => requestPhase7Operation({ operation: 'listAdminQuestions', ...{}, params: {}, query: {}, body: undefined })`
        ],
        [
          'getDuplicatePhase7',
          `${phase7Import}export const endpoint = () => requestPhase7Operation({ operation: 'listAdminQuestions', operation: 'getAdminQuestion', params: {}, query: {}, body: undefined })`
        ],
        [
          'getComputedPhase7',
          `${phase7Import}export const endpoint = () => requestPhase7Operation({ ['operation']: 'listAdminQuestions', params: {}, query: {}, body: undefined })`
        ],
        [
          'getInputAliasPhase7',
          `${phase7Import}const input = ${phase7Input}; export const endpoint = () => requestPhase7Operation(input)`
        ],
        [
          'getIgnoredPhase7',
          `${phase7Import}export const endpoint = () => { void ${phase7Return}; return {} }`
        ],
        [
          'getUncheckedBranchPhase7',
          `${phase7Import}export const endpoint = (flag: boolean) => { if (flag) return {}; return ${phase7Return} }`
        ],
        [
          'getUncheckedExportPhase7',
          `${phase7Import}export const endpoint = () => ${phase7Return}; export const unchecked = () => ({})`
        ],
        [
          'getFetchAliasPhase7',
          `${phase7Import}const raw = fetch; export const endpoint = () => { void raw('/api'); return ${phase7Return} }`
        ],
        [
          'getWindowFetchPhase7',
          `${phase7Import}export const endpoint = () => { void window.fetch('/api'); return ${phase7Return} }`
        ],
        [
          'getHttpAliasPhase7',
          `${phase7Import}import { get } from '@api/http'; const raw = get; export const endpoint = () => { void raw('/api'); return ${phase7Return} }`
        ],
        [
          'getClientAliasPhase7',
          `${phase7Import}import { apiClient } from '@api/config'; const client = apiClient; export const endpoint = () => { void client.get('/api'); return ${phase7Return} }`
        ],
        [
          'getClientMethodPhase7',
          `${phase7Import}import { apiClient } from '@api/config'; const raw = apiClient.get; export const endpoint = () => { void raw('/api'); return ${phase7Return} }`
        ],
        [
          'getClientDestructurePhase7',
          `${phase7Import}import { apiClient } from '@api/config'; const { get: raw } = apiClient; export const endpoint = () => { void raw('/api'); return ${phase7Return} }`
        ],
        [
          'getAxiosPhase7',
          `${phase7Import}import axios from 'axios'; export const endpoint = () => { void axios.get('/api'); return ${phase7Return} }`
        ]
      ])
      for (const [name, source] of cases) add(name, source)
      add(
        'getMissingSchemaPhase7',
        `${phase7Import}export const endpoint = () => ${phase7Return}`,
        null
      )
      add(
        'getFakeSchemaPhase7',
        `${phase7Import}export const endpoint = () => ${phase7Return}`,
        "import { z } from 'zod'; export const fakeRequestSchema = z.object({}).strict(); export const fakeResponseSchema = z.object({}).strict()"
      )
      add(
        'getWrongRequestPhase7',
        `${phase7Import}export const endpoint = () => ${phase7Return}`,
        "export { getAdminQuestionParamsSchema as wrongRequestSchema, listAdminQuestionsResponseSchema as correctResponseSchema } from '@nihongo/contracts/admin/phase7'"
      )
      add(
        'getWrongResponsePhase7',
        `${phase7Import}export const endpoint = () => ${phase7Return}`,
        "export { listAdminQuestionsQuerySchema as correctRequestSchema, getAdminQuestionResponseSchema as wrongResponseSchema } from '@nihongo/contracts/admin/phase7'"
      )
      const diagnostics = check()
      for (const name of [
        ...cases.keys(),
        'getMissingSchemaPhase7',
        'getFakeSchemaPhase7',
        'getWrongRequestPhase7',
        'getWrongResponsePhase7'
      ]) {
        assert.deepEqual(
          diagnostics
            .filter(({ file }) => file.endsWith(`/${name}/index.ts`))
            .map(({ code }) => code),
          ['ARCH005'],
          name
        )
      }
      assert.equal(diagnostics.length, cases.size + 4)
    }))
})
