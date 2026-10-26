import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  createReleaseManifest,
  verifyReleaseManifest
} from './release-contract.mjs'

const releaseId = '1234567890abcdef1234567890abcdef12345678'
const fixture = (run) => {
  const root = mkdtempSync(join(tmpdir(), 'nihongo-release-two-apps-'))
  try {
    for (const dir of [
      'api/dist',
      'api/prisma/migrations/20260101000000_initial',
      'web',
      'admin'
    ])
      mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, 'api/dist/server.js'), 'server')
    writeFileSync(join(root, 'api/package.json'), '{}')
    writeFileSync(
      join(root, 'api/prisma/migrations/20260101000000_initial/migration.sql'),
      '-- fixture'
    )
    for (const app of ['web', 'admin'])
      writeFileSync(
        join(root, app, 'index.html'),
        `<meta name="nihongo-release-id" content="${releaseId}">`
      )
    writeFileSync(join(root, 'lock.yaml'), 'fixture')
    writeFileSync(join(root, 'env.json'), '{}')
    const options = {
      apiDirectory: join(root, 'api'),
      webDirectory: join(root, 'web'),
      adminDirectory: join(root, 'admin'),
      releaseId,
      lockfilePath: join(root, 'lock.yaml'),
      environmentContractPath: join(root, 'env.json'),
      nodeVersion: '22.23.0',
      pnpmVersion: '10.2.1'
    }
    run(options)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
test('new release inventories bind both browser artifacts and retain historical v1 verification', () =>
  fixture((options) => {
    const manifest = createReleaseManifest(options)
    assert.equal(manifest.schemaVersion, 2)
    assert.deepEqual(
      Object.keys(verifyReleaseManifest(manifest).artifacts).sort(),
      ['admin', 'api', 'web']
    )
    const legacy = structuredClone(manifest)
    legacy.schemaVersion = 1
    delete legacy.artifacts.admin
    assert.equal(verifyReleaseManifest(legacy).schemaVersion, 1)
    delete manifest.artifacts.admin
    assert.throws(() => verifyReleaseManifest(manifest), /invalid key set/u)
  }))
test('rejects admin release mismatch, duplicate markers and overlapping artifact roots', () =>
  fixture((options) => {
    const index = join(options.adminDirectory, 'index.html')
    writeFileSync(
      index,
      `<meta name="nihongo-release-id" content="${'f'.repeat(40)}">`
    )
    assert.throws(() => createReleaseManifest(options), /does not match/u)
    writeFileSync(
      index,
      `<meta name="nihongo-release-id" content="${releaseId}">`.repeat(2)
    )
    assert.throws(() => createReleaseManifest(options), /exactly one/u)
    writeFileSync(
      index,
      `<meta name="nihongo-release-id" content="${releaseId}">`
    )
    assert.throws(
      () =>
        createReleaseManifest({
          ...options,
          adminDirectory: options.webDirectory
        }),
      /distinct/u
    )
    assert.throws(
      () =>
        createReleaseManifest({
          ...options,
          adminDirectory: options.apiDirectory
        }),
      /overlap|distinct|ENOENT/u
    )
  }))
test('rejects private files in admin artifact and modified inventory digest', () =>
  fixture((options) => {
    writeFileSync(join(options.adminDirectory, 'secret.pem'), 'fixture')
    assert.throws(() => createReleaseManifest(options), /Forbidden release/u)
    rmSync(join(options.adminDirectory, 'secret.pem'))
    const manifest = createReleaseManifest(options)
    manifest.artifacts.admin.entries[0].sha256 = 'a'.repeat(64)
    assert.throws(() => verifyReleaseManifest(manifest), /digest/u)
    assert.ok(readFileSync(join(options.webDirectory, 'index.html'), 'utf8'))
  }))
