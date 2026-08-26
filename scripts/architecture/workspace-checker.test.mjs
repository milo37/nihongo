import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { checkWorkspaceArchitecture } from './workspace-checker.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => path.join(directory, 'fixtures', name)

test('valid workspace dependency graph passes', () => {
  assert.deepEqual(
    checkWorkspaceArchitecture({
      rootDir: fixture('valid-workspace-boundaries')
    }),
    []
  )
})

test('reverse dependencies, framework leaks, broad imports and cycles fail', () => {
  const diagnostics = checkWorkspaceArchitecture({
    rootDir: fixture('invalid-workspace-boundaries')
  })
  const codes = new Set(diagnostics.map(({ code }) => code))

  for (const expectedCode of [
    'ARCH101',
    'ARCH102',
    'ARCH103',
    'ARCH104',
    'ARCH105',
    'ARCH106',
    'ARCH107',
    'ARCH108',
    'ARCH109',
    'ARCH110',
    'ARCH111',
    'ARCH112',
    'ARCH113',
    'ARCH114',
    'ARCH115',
    'ARCH116',
    'ARCH117'
  ]) {
    assert.equal(codes.has(expectedCode), true, expectedCode)
  }

  for (const fileName of [
    'content-cli-import.ts',
    'content-command-dynamic.ts',
    'content-command-import.ts',
    'content-command-reexport.ts'
  ]) {
    assert.equal(
      diagnostics.some(
        ({ code, file }) =>
          code === 'ARCH117' && file.endsWith(`/routes/${fileName}`)
      ),
      true,
      fileName
    )
  }
  assert.equal(
    diagnostics.some(
      ({ code, file }) =>
        code === 'ARCH116' && file.endsWith('/src/phase6SeedLeak.ts')
    ),
    true,
    'phase6SeedLeak.ts'
  )
  assert.equal(
    diagnostics.some(
      ({ code, file }) =>
        code === 'ARCH116' && file.endsWith('/src/phase6SeedEntrypointLeak.ts')
    ),
    true,
    'phase6SeedEntrypointLeak.ts'
  )

  const responseBypassDiagnostics = diagnostics.filter(({ file }) =>
    file.endsWith('/routes/response-bypass.ts')
  )
  assert.equal(
    responseBypassDiagnostics.some(({ code }) => code === 'ARCH112'),
    true
  )
  assert.equal(
    responseBypassDiagnostics.some(
      ({ code }) => code === 'ARCH113' || code === 'ARCH115'
    ),
    false
  )

  const fakeSchemaDiagnostics = diagnostics.filter(({ file }) =>
    file.endsWith('/routes/fake-response-schema.ts')
  )
  assert.equal(
    fakeSchemaDiagnostics.some(({ code }) => code === 'ARCH112'),
    true
  )
  assert.equal(
    fakeSchemaDiagnostics.some(
      ({ code }) => code === 'ARCH113' || code === 'ARCH115'
    ),
    false
  )

  const dashboardLeakDiagnostics = diagnostics.filter(({ file }) =>
    file.endsWith('/api/question/dashboardLeak.ts')
  )
  assert.equal(
    dashboardLeakDiagnostics.some(({ code }) => code === 'ARCH114'),
    true
  )

  const misplacedCancellationDiagnostics = diagnostics.filter(({ file }) =>
    file.endsWith('/routes/misplaced-cancellation.ts')
  )
  assert.equal(
    misplacedCancellationDiagnostics.some(({ code }) => code === 'ARCH112'),
    true
  )
  assert.equal(
    misplacedCancellationDiagnostics.some(
      ({ code }) => code === 'ARCH113' || code === 'ARCH115'
    ),
    false
  )

  for (const fileName of [
    'eagerSubmit.ts',
    'calledHelperDynamicSubmit.ts',
    'iifeDynamicSubmit.ts',
    'lazyDashboard.ts',
    'lazyReviewed.ts',
    'topLevelDynamicSubmit.ts'
  ]) {
    const sessionDiagnostics = diagnostics.filter(({ file }) =>
      file.endsWith(`/app/practice/session/${fileName}`)
    )
    assert.equal(
      sessionDiagnostics.some(({ code }) => code === 'ARCH114'),
      true,
      fileName
    )
  }
})

test('ARCH116 rejects every Web symlink and post-build content copy', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'nihongo-arch116-'))
  try {
    await cp(fixture('valid-workspace-boundaries'), rootDir, {
      recursive: true
    })
    await mkdir(path.join(rootDir, 'apps/web/public'), { recursive: true })
    await mkdir(path.join(rootDir, 'apps/web/dist/assets'), {
      recursive: true
    })
    await mkdir(path.join(rootDir, 'content/fixtures'), { recursive: true })
    await mkdir(path.join(rootDir, 'apps/api/prisma/seed-data/questions'), {
      recursive: true
    })
    const canary = '{"schemaVersion":1,"canary":"PHASE6_SERVER_ONLY"}\n'
    await writeFile(path.join(rootDir, 'content/fixtures/canary.json'), canary)
    await writeFile(
      path.join(rootDir, 'apps/web/dist/assets/leaked.json'),
      canary
    )
    const sensitiveQuestion = '昨日の図書館で借りた本について答えてください。'
    await writeFile(
      path.join(rootDir, 'apps/api/prisma/seed-data/questions/n5.ts'),
      `export const questionText = ${JSON.stringify(sensitiveQuestion)}\n`
    )
    await writeFile(
      path.join(rootDir, 'apps/web/dist/assets/transformed.js'),
      `window.__fixture={question:${JSON.stringify(sensitiveQuestion)}};`
    )
    await symlink(
      path.join(rootDir, 'apps/web/package.json'),
      path.join(rootDir, 'apps/web/vite.config.ts')
    )
    await symlink(
      path.join(rootDir, 'missing.json'),
      path.join(rootDir, 'apps/web/public/broken.json')
    )

    const diagnostics = checkWorkspaceArchitecture({ rootDir })
    const arch116Files = new Set(
      diagnostics
        .filter(({ code }) => code === 'ARCH116')
        .map(({ file }) => file)
    )
    for (const expectedFile of [
      'apps/web/dist/assets/leaked.json',
      'apps/web/dist/assets/transformed.js',
      'apps/web/public/broken.json',
      'apps/web/vite.config.ts'
    ]) {
      assert.equal(arch116Files.has(expectedFile), true, expectedFile)
    }
  } finally {
    await rm(rootDir, { force: true, recursive: true })
  }
})
