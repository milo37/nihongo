import assert from 'node:assert/strict'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { checkWorkspaceArchitecture } from './workspace-checker.mjs'

const routePath = 'apps/api/src/routes/response-fixture.ts'
const validRoute = `
import { fixtureRequestSchema, fixtureResponseSchema } from '@nihongo/contracts/practice'

routes.post('/fixture', async (c) => {
  const request = fixtureRequestSchema.parse(await c.req.json())
  return c.json(fixtureResponseSchema.parse({ value: request.value }))
})
`
const validatedResponse =
  'fixtureResponseSchema.parse({ value: request.value })'
const plainResponse = '{ value: request.value }'
const apiCodes = new Set(['ARCH112', 'ARCH113', 'ARCH115'])

test('API route reports only a missing response contract at its exact path', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'nihongo-api-response-boundary-'))
  const file = join(root, routePath)
  const diagnostics = () =>
    checkWorkspaceArchitecture({ rootDir: root })
      .filter(({ code }) => apiCodes.has(code))
      .map(({ code, file }) => ({ code, file }))

  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, validRoute)

    await t.test('valid request and response contracts', () => {
      assert.deepEqual(diagnostics(), [])
    })

    await t.test('removing only response parsing reports ARCH112', () => {
      assert.equal(validRoute.split(validatedResponse).length, 2)
      writeFileSync(file, validRoute.replace(validatedResponse, plainResponse))
      assert.deepEqual(diagnostics(), [{ code: 'ARCH112', file: routePath }])
    })

    await t.test('restoring response parsing clears the diagnostic', () => {
      writeFileSync(file, validRoute)
      assert.deepEqual(diagnostics(), [])
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

  await t.test('temporary fixture is removed', () => {
    assert.throws(() => lstatSync(root), { code: 'ENOENT' })
  })
})
