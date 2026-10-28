import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyPortableSource } from './portable-check.mjs'

const releaseId = 'a'.repeat(40)

test('portable source requires the exact clean evaluated commit', () => {
  assert.equal(
    verifyPortableSource({
      releaseId,
      repositoryRoot: process.cwd(),
      git: (_command, args) => (args[0] === 'rev-parse' ? `${releaseId}\n` : '')
    }),
    releaseId
  )
  assert.throws(
    () =>
      verifyPortableSource({
        releaseId,
        repositoryRoot: process.cwd(),
        git: (_command, args) =>
          args[0] === 'rev-parse' ? `${'b'.repeat(40)}\n` : ''
      }),
    /PORTABLE_RELEASE_ID_MISMATCH/u
  )
  assert.throws(
    () =>
      verifyPortableSource({
        releaseId,
        repositoryRoot: process.cwd(),
        git: (_command, args) =>
          args[0] === 'rev-parse' ? `${releaseId}\n` : ' M package.json\n'
      }),
    /PORTABLE_SOURCE_DIRTY/u
  )
})
