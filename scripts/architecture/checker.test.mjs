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

const withContentOperationFixture = (run) => {
  const root = fs.mkdtempSync(
    path.join(tmpdir(), 'nihongo-phase7-architecture-')
  )
  const repository = path.resolve(directory, '../..')
  try {
    for (const relative of [
      'packages/browser/src',
      'packages/contracts/src',
      'packages/contracts/dist'
    ]) {
      fs.cpSync(path.join(repository, relative), path.join(root, relative), {
        recursive: true
      })
    }
    const sourceRoot = path.join(root, 'packages/browser/src')
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
              '@nihongo/browser/*': ['packages/browser/src/*'],
              '@nihongo/contracts/admin/phase7': [
                `packages/contracts/${contractDirectory}/admin/content-operations`
              ],
              '@nihongo/contracts/admin/content-operations': [
                `packages/contracts/${contractDirectory}/admin/content-operations`
              ],
              '@nihongo/contracts/*': [
                `packages/contracts/${contractDirectory}/*`
              ],
              zod: [path.join(repository, 'packages/browser/node_modules/zod')],
              axios: [
                path.join(repository, 'packages/browser/node_modules/axios')
              ]
            }
          },
          files
        })
      )
      return checkArchitecture({
        rootDir: root,
        tsconfigPath,
        sourceRoot,
        allowRelativeImports: true
      })
    }
    const actualHelper =
      'packages/browser/src/api/content-operations/requestContentOperation.ts'
    assert.equal(
      fs.readFileSync(path.join(root, actualHelper), 'utf8'),
      fs.readFileSync(path.join(repository, actualHelper), 'utf8')
    )
    run({ root, sourceRoot, files, add, check })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const contentOperationImport =
  "import { requestContentOperation } from '../../content-operations/requestContentOperation'\n"
const contentOperationInput =
  "{ operation: 'listAdminQuestions', params: {}, query: {}, body: undefined }"
const contentOperationReturn = `requestContentOperation(${contentOperationInput})`

describe('canonical Phase7 endpoint validation', () => {
  it('allows all six actual endpoints and checked returns with source/dist contract identities', () =>
    withContentOperationFixture(({ sourceRoot, files, add, check }) => {
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
        `${contentOperationImport}export const endpoint = async () => await ${contentOperationReturn}`
      )
      add(
        'getConstPhase7',
        `${contentOperationImport}export const endpoint = async () => { const result = await ${contentOperationReturn}; return result }`
      )
      assert.deepEqual(check('src'), [])
      assert.deepEqual(check('dist'), [])
    }))

  it('accepts the legacy import and rejects forged manifest or schema aliases', () =>
    withContentOperationFixture(({ root, add, check }) => {
      const helperPath = path.join(
        root,
        'packages/browser/src/api/content-operations/requestContentOperation.ts'
      )
      const helper = fs.readFileSync(helperPath, 'utf8')
      const endpoint = 'getAliasIdentityPhase7'
      add(
        endpoint,
        `${contentOperationImport}export const endpoint = () => ${contentOperationReturn}`
      )
      const legacy = helper
        .replaceAll('contentOperationManifest', 'phase7OperationManifest')
        .replaceAll('contentOperationSchemas', 'phase7OperationSchemas')
        .replace(
          '@nihongo/contracts/admin/content-operations',
          '@nihongo/contracts/admin/phase7'
        )
      fs.writeFileSync(helperPath, legacy)
      assert.deepEqual(check('src'), [])
      assert.deepEqual(check('dist'), [])

      for (const [name, replacement] of [
        [
          'contentOperationManifest,',
          'phase7Slice2ReadOperationManifest as contentOperationManifest,'
        ],
        [
          'contentOperationSchemas,',
          'createAdminQuestionRequestSchema as contentOperationSchemas,'
        ]
      ]) {
        assert.ok(helper.includes(name))
        fs.writeFileSync(helperPath, helper.replace(name, replacement))
        for (const directory of ['src', 'dist']) {
          assert.deepEqual(
            check(directory)
              .filter(({ file }) => file.endsWith(`/${endpoint}/index.ts`))
              .map(({ code }) => code),
            ['ARCH005'],
            `${name} (${directory})`
          )
        }
      }
    }))

  it('rejects forged helpers, aliases, wrong schemas, dynamic operations, unchecked returns and raw transports', () =>
    withContentOperationFixture(({ sourceRoot, add, check }) => {
      fs.writeFileSync(
        path.join(sourceRoot, 'api/content-operations/fakeHelper.ts'),
        'export const requestContentOperation = async (_input: unknown) => ({})'
      )
      fs.writeFileSync(
        path.join(sourceRoot, 'api/content-operations/facade.ts'),
        "export { requestContentOperation } from './requestContentOperation'"
      )
      fs.writeFileSync(
        path.join(sourceRoot, 'api/content-operations/fakeFacade.ts'),
        "export { requestContentOperation } from './fakeHelper'"
      )
      const cases = new Map([
        [
          'getFakePhase7',
          `import { requestContentOperation } from '../../content-operations/fakeHelper'; export const endpoint = () => ${contentOperationReturn}`
        ],
        [
          'getReexportedPhase7',
          `import { requestContentOperation } from '../../content-operations/facade'; export const endpoint = () => ${contentOperationReturn}`
        ],
        [
          'getFakeReexportPhase7',
          `import { requestContentOperation } from '../../content-operations/fakeFacade'; export const endpoint = () => ${contentOperationReturn}`
        ],
        [
          'getRenamedPhase7',
          `import { requestContentOperation as renamed } from '../../content-operations/requestContentOperation'; export const endpoint = () => renamed(${contentOperationInput})`
        ],
        [
          'getVariableAliasPhase7',
          `${contentOperationImport}const renamed = requestContentOperation; export const endpoint = () => renamed(${contentOperationInput})`
        ],
        [
          'getRawRenamedPhase7',
          `import { get as requestContentOperation } from '../../http'; export const endpoint = () => ${contentOperationReturn}`
        ],
        [
          'getLocalFakePhase7',
          `const requestContentOperation = async (_input: unknown) => ({}); export const endpoint = () => ${contentOperationReturn}`
        ],
        [
          'getUnknownPhase7',
          `${contentOperationImport}export const endpoint = () => requestContentOperation({ operation: 'unknownOperation', params: {}, query: {}, body: undefined })`
        ],
        [
          'getDynamicPhase7',
          `${contentOperationImport}const operation = 'listAdminQuestions'; export const endpoint = () => requestContentOperation({ operation, params: {}, query: {}, body: undefined })`
        ],
        [
          'getSpreadPhase7',
          `${contentOperationImport}export const endpoint = () => requestContentOperation({ operation: 'listAdminQuestions', ...{}, params: {}, query: {}, body: undefined })`
        ],
        [
          'getDuplicatePhase7',
          `${contentOperationImport}export const endpoint = () => requestContentOperation({ operation: 'listAdminQuestions', operation: 'getAdminQuestion', params: {}, query: {}, body: undefined })`
        ],
        [
          'getComputedPhase7',
          `${contentOperationImport}export const endpoint = () => requestContentOperation({ ['operation']: 'listAdminQuestions', params: {}, query: {}, body: undefined })`
        ],
        [
          'getInputAliasPhase7',
          `${contentOperationImport}const input = ${contentOperationInput}; export const endpoint = () => requestContentOperation(input)`
        ],
        [
          'getIgnoredPhase7',
          `${contentOperationImport}export const endpoint = () => { void ${contentOperationReturn}; return {} }`
        ],
        [
          'getUncheckedBranchPhase7',
          `${contentOperationImport}export const endpoint = (flag: boolean) => { if (flag) return {}; return ${contentOperationReturn} }`
        ],
        [
          'getUncheckedExportPhase7',
          `${contentOperationImport}export const endpoint = () => ${contentOperationReturn}; export const unchecked = () => ({})`
        ],
        [
          'getFetchAliasPhase7',
          `${contentOperationImport}const raw = fetch; export const endpoint = () => { void raw('/api'); return ${contentOperationReturn} }`
        ],
        [
          'getWindowFetchPhase7',
          `${contentOperationImport}export const endpoint = () => { void window.fetch('/api'); return ${contentOperationReturn} }`
        ],
        [
          'getHttpAliasPhase7',
          `${contentOperationImport}import { get } from '../../http'; const raw = get; export const endpoint = () => { void raw('/api'); return ${contentOperationReturn} }`
        ],
        [
          'getClientAliasPhase7',
          `${contentOperationImport}import { apiClient } from '../../config'; const client = apiClient; export const endpoint = () => { void client.get('/api'); return ${contentOperationReturn} }`
        ],
        [
          'getClientMethodPhase7',
          `${contentOperationImport}import { apiClient } from '../../config'; const raw = apiClient.get; export const endpoint = () => { void raw('/api'); return ${contentOperationReturn} }`
        ],
        [
          'getClientDestructurePhase7',
          `${contentOperationImport}import { apiClient } from '../../config'; const { get: raw } = apiClient; export const endpoint = () => { void raw('/api'); return ${contentOperationReturn} }`
        ],
        [
          'getAxiosPhase7',
          `${contentOperationImport}import axios from 'axios'; export const endpoint = () => { void axios.get('/api'); return ${contentOperationReturn} }`
        ]
      ])
      for (const [name, source] of cases) add(name, source)
      add(
        'getMissingSchemaPhase7',
        `${contentOperationImport}export const endpoint = () => ${contentOperationReturn}`,
        null
      )
      add(
        'getFakeSchemaPhase7',
        `${contentOperationImport}export const endpoint = () => ${contentOperationReturn}`,
        "import { z } from 'zod'; export const fakeRequestSchema = z.object({}).strict(); export const fakeResponseSchema = z.object({}).strict()"
      )
      add(
        'getWrongRequestPhase7',
        `${contentOperationImport}export const endpoint = () => ${contentOperationReturn}`,
        "export { getAdminQuestionParamsSchema as wrongRequestSchema, listAdminQuestionsResponseSchema as correctResponseSchema } from '@nihongo/contracts/admin/phase7'"
      )
      add(
        'getWrongResponsePhase7',
        `${contentOperationImport}export const endpoint = () => ${contentOperationReturn}`,
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
