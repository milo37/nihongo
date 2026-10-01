import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  LOCAL_RELEASE_ID,
  assertReleaseId,
  collectTreeInventory,
  createReleaseManifest,
  verifyReleaseManifest
} from './release-contract.mjs'

const releaseId = '1234567890abcdef1234567890abcdef12345678'

const createFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'nihongo-release-manifest-'))
  const apiDirectory = join(root, 'api')
  const webDirectory = join(root, 'web')
  const environmentContractPath = join(root, 'environment.json')
  const lockfilePath = join(root, 'pnpm-lock.yaml')

  mkdirSync(join(apiDirectory, 'dist'), { recursive: true })
  mkdirSync(join(apiDirectory, 'node_modules', 'runtime-package'), {
    recursive: true
  })
  mkdirSync(join(apiDirectory, 'prisma', 'migrations', '20260101000000_init'), {
    recursive: true
  })
  mkdirSync(join(webDirectory, 'assets'), { recursive: true })
  writeFileSync(join(apiDirectory, 'dist', 'server.js'), 'export {}\n')
  writeFileSync(
    join(apiDirectory, 'node_modules', 'runtime-package', 'index.js'),
    'export {}\n'
  )
  writeFileSync(join(apiDirectory, 'package.json'), '{"type":"module"}\n')
  writeFileSync(
    join(
      apiDirectory,
      'prisma',
      'migrations',
      '20260101000000_init',
      'migration.sql'
    ),
    'SELECT 1;\n'
  )
  writeFileSync(
    join(webDirectory, 'index.html'),
    `<meta name="nihongo-release-id" content="${releaseId}"><script src="/assets/app.js"></script>\n`
  )
  writeFileSync(join(webDirectory, 'assets', 'app.js'), 'export {}\n')
  writeFileSync(environmentContractPath, '{"schemaVersion":1}\n')
  writeFileSync(lockfilePath, 'lockfileVersion: 9\n')

  return {
    apiDirectory,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    environmentContractPath,
    lockfilePath,
    webDirectory
  }
}

const buildManifest = (fixture) =>
  createReleaseManifest({
    apiDirectory: fixture.apiDirectory,
    environmentContractPath: fixture.environmentContractPath,
    lockfilePath: fixture.lockfilePath,
    nodeVersion: '22.23.0',
    pnpmVersion: '10.2.1',
    releaseId,
    webDirectory: fixture.webDirectory
  })

test('release manifest is deterministic and closed-schema', () => {
  const fixture = createFixture()
  try {
    const first = buildManifest(fixture)
    const second = buildManifest(fixture)

    assert.deepEqual(second, first)
    assert.equal(verifyReleaseManifest(first), first)

    const withUnknownField = { ...first, provider: 'invented' }
    assert.throws(
      () => verifyReleaseManifest(withUnknownField),
      /invalid key set/u
    )

    const reversedEntries = structuredClone(first)
    reversedEntries.artifacts.web.entries.reverse()
    assert.throws(
      () => verifyReleaseManifest(reversedEntries),
      /artifact path/u
    )
  } finally {
    fixture.cleanup()
  }
})

test('release manifest digest changes with artifact bytes', () => {
  const fixture = createFixture()
  try {
    const first = buildManifest(fixture)
    writeFileSync(
      join(fixture.webDirectory, 'assets', 'app.js'),
      'export { x }\n'
    )
    const second = buildManifest(fixture)

    assert.notEqual(
      second.artifacts.web.digestSha256,
      first.artifacts.web.digestSha256
    )
    assert.equal(
      second.artifacts.api.digestSha256,
      first.artifacts.api.digestSha256
    )
  } finally {
    fixture.cleanup()
  }
})

test('release IDs reject invalid and local sentinel values', () => {
  assert.equal(assertReleaseId(releaseId), releaseId)
  assert.throws(() => assertReleaseId('short'), /40-character/u)
  assert.throws(
    () => assertReleaseId(LOCAL_RELEASE_ID),
    /local release sentinel/u
  )
})

test('web payload rejects secrets and escaping symlinks', () => {
  const fixture = createFixture()
  try {
    writeFileSync(
      join(fixture.webDirectory, '.env.production'),
      'SECRET=value\n'
    )
    assert.throws(() => buildManifest(fixture), /Forbidden release file/u)
    rmSync(join(fixture.webDirectory, '.env.production'))

    symlinkSync('/tmp', join(fixture.webDirectory, 'escape'))
    assert.throws(
      () => collectTreeInventory(fixture.webDirectory),
      /escapes its artifact/u
    )
  } finally {
    fixture.cleanup()
  }
})

test('web marker must match the release ID', () => {
  const fixture = createFixture()
  try {
    for (const invalidHtml of [
      `<!-- <meta name="nihongo-release-id" content="${releaseId}"> -->`,
      `<script>const marker = '<meta name="nihongo-release-id" content="${releaseId}">'</script>`,
      `<meta name="nihongo-release-id" content="${releaseId}"><meta name="nihongo-release-id" content="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">`,
      `<meta name="nihongo-release-id" content="${releaseId.toUpperCase()}">`
    ]) {
      writeFileSync(join(fixture.webDirectory, 'index.html'), invalidHtml)
      assert.throws(() => buildManifest(fixture), /release marker/u)
    }
  } finally {
    fixture.cleanup()
  }
})
