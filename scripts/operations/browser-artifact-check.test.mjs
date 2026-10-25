import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  assertBrowserArtifact,
  assertBrowserBuildGraph
} from './browser-artifact-check.mjs'

const releaseId = '1234567890abcdef1234567890abcdef12345678'
const fixture = (artifact, run) => {
  const directory = mkdtempSync(join(tmpdir(), 'nihongo-browser-boundary-'))
  try {
    mkdirSync(join(directory, 'assets'))
    writeFileSync(join(directory, 'assets/index.js'), 'console.log("fixture")')
    writeFileSync(
      join(directory, 'index.html'),
      `<meta name="nihongo-release-id" content="${releaseId}"><script type="module" src="${artifact === 'admin' ? '/admin/' : '/'}assets/index.js"></script>`
    )
    writeFileSync(
      join(directory, 'browser-build-manifest.json'),
      JSON.stringify({
        artifact,
        releaseId,
        modules: [
          `apps/${artifact}/src/main.tsx`,
          'packages/browser/src/api/http.ts'
        ]
      })
    )
    run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('web/admin artifacts validate their own entry base and release identity', () => {
  for (const artifact of ['web', 'admin'])
    fixture(artifact, (directory) =>
      assert.equal(
        assertBrowserArtifact(artifact, directory).releaseId,
        releaseId
      )
    )
})
test('browser graphs reject server, domain, generator, mock and private inputs', () => {
  for (const id of [
    'apps/api/src/server.ts',
    'packages/domain/src/content/validator.ts',
    'scripts/content/run.mjs',
    'content/runtime/key.ts',
    'apps/web/src/mocks/browser.ts',
    'node_modules/.pnpm/msw@2.0/node_modules/msw/browser.mjs',
    'node:fs',
    '.env.local',
    'secret.pem'
  ]) {
    for (const artifact of ['web', 'admin'])
      assert.throws(() => assertBrowserBuildGraph(artifact, [id]), /Forbidden/u)
  }
  assert.throws(
    () =>
      assertBrowserBuildGraph('web', [
        'packages/browser/src/api/admin-question/get/index.ts'
      ]),
    /Admin module/u
  )
  assert.doesNotThrow(() =>
    assertBrowserBuildGraph('admin', [
      'packages/browser/src/api/admin-question/get/index.ts'
    ])
  )
})
test('rejects swapped apps, wrong release marker, root assets in admin and mock worker', () => {
  fixture('admin', (directory) => {
    assert.throws(
      () => assertBrowserArtifact('web', directory),
      /identity mismatch/u
    )
    writeFileSync(
      join(directory, 'index.html'),
      `<meta name="nihongo-release-id" content="${releaseId}"><script src="/assets/index.js"></script>`
    )
    assert.throws(
      () => assertBrowserArtifact('admin', directory),
      /asset path/u
    )
    writeFileSync(
      join(directory, 'index.html'),
      `<meta name="nihongo-release-id" content="${'a'.repeat(40)}"><script src="/admin/assets/index.js"></script>`
    )
    assert.throws(
      () => assertBrowserArtifact('admin', directory),
      /release marker/u
    )
  })
  fixture('web', (directory) => {
    writeFileSync(join(directory, 'mockServiceWorker.js'), 'worker')
    assert.throws(
      () => assertBrowserArtifact('web', directory),
      /Forbidden browser/u
    )
  })
})
test('rejects private material, symlinks and invalid module inventories', () => {
  fixture('admin', (directory) => {
    writeFileSync(
      join(directory, 'assets/index.js'),
      ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')
    )
    assert.throws(
      () => assertBrowserArtifact('admin', directory),
      /Private runtime/u
    )
  })
  fixture('web', (directory) => {
    symlinkSync('index.js', join(directory, 'assets/alias.js'))
    assert.throws(() => assertBrowserArtifact('web', directory), /symlinks/u)
  })
  assert.throws(() => assertBrowserBuildGraph('other', ['x']), /Invalid/u)
  assert.throws(() => assertBrowserBuildGraph('web', []), /Invalid/u)
})
