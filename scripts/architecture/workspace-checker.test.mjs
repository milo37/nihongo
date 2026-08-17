import assert from 'node:assert/strict'
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
    'ARCH115'
  ]) {
    assert.equal(codes.has(expectedCode), true, expectedCode)
  }

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
