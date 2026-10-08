import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  normalizeApiDeploy,
  runNormalizeApiDeployCli
} from './normalize-api-deploy.mjs'

const createFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'nihongo-api-deploy-'))
  const apiDirectory = join(root, 'release', 'api')
  const workspaceApiDirectory = join(root, 'workspace', 'apps', 'api')
  const selfLinkDirectory = join(
    apiDirectory,
    'node_modules',
    '.pnpm',
    'node_modules',
    '@nihongo'
  )
  mkdirSync(selfLinkDirectory, { recursive: true })
  mkdirSync(workspaceApiDirectory, { recursive: true })
  writeFileSync(join(workspaceApiDirectory, 'package.json'), '{}\n')
  return {
    apiDirectory,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    selfLink: join(selfLinkDirectory, 'api'),
    workspaceApiDirectory
  }
}

test('normalizer removes only the exact pnpm workspace self reference', () => {
  const fixture = createFixture()
  try {
    const internalPackage = join(
      fixture.apiDirectory,
      'node_modules',
      '.pnpm',
      'contracts'
    )
    mkdirSync(internalPackage, { recursive: true })
    const siblingLink = join(
      fixture.apiDirectory,
      'node_modules',
      '@nihongo-contracts'
    )
    symlinkSync(internalPackage, siblingLink)
    symlinkSync(fixture.workspaceApiDirectory, fixture.selfLink)

    normalizeApiDeploy(fixture)

    assert.equal(existsSync(fixture.selfLink), false)
    assert.equal(lstatSync(siblingLink).isSymbolicLink(), true)
  } finally {
    fixture.cleanup()
  }
})

test('normalizer fails closed for missing, regular, or redirected entries', () => {
  for (const shape of ['missing', 'regular', 'redirected']) {
    const fixture = createFixture()
    try {
      if (shape === 'regular') writeFileSync(fixture.selfLink, 'not a link\n')
      if (shape === 'redirected') {
        const unexpected = join(fixture.apiDirectory, 'unexpected')
        mkdirSync(unexpected)
        symlinkSync(unexpected, fixture.selfLink)
      }

      assert.throws(() => normalizeApiDeploy(fixture))
      if (shape !== 'missing') assert.equal(existsSync(fixture.selfLink), true)
    } finally {
      fixture.cleanup()
    }
  }
})

test('normalizer CLI is OCI-only with an exact argument set', () => {
  const fixture = createFixture()
  try {
    symlinkSync(fixture.workspaceApiDirectory, fixture.selfLink)
    const argumentsList = [
      '--api-directory',
      fixture.apiDirectory,
      '--workspace-api-directory',
      fixture.workspaceApiDirectory
    ]
    assert.throws(
      () => runNormalizeApiDeployCli(argumentsList, { ociBuild: undefined }),
      /restricted to OCI builds/u
    )
    assert.throws(
      () =>
        runNormalizeApiDeployCli([...argumentsList, '--provider', 'x'], {
          ociBuild: '1'
        }),
      /invalid argument set/u
    )
    assert.doesNotThrow(() =>
      runNormalizeApiDeployCli(argumentsList, { ociBuild: '1' })
    )
  } finally {
    fixture.cleanup()
  }
})
