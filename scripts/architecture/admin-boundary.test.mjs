import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkWorkspaceArchitecture } from './workspace-checker.mjs'

const fixture = (run) => {
  const root = mkdtempSync(join(tmpdir(), 'nihongo-admin-architecture-'))
  try {
    for (const directory of [
      'apps/web/src',
      'apps/admin/src',
      'apps/api/src',
      'packages/browser/src',
      'packages/contracts/src',
      'packages/domain/src'
    ])
      mkdirSync(join(root, directory), { recursive: true })
    for (const [directory, name] of [
      ['apps/web', 'web'],
      ['apps/admin', 'admin'],
      ['apps/api', 'api'],
      ['packages/browser', 'browser'],
      ['packages/contracts', 'contracts'],
      ['packages/domain', 'domain']
    ]) {
      writeFileSync(
        join(root, directory, 'package.json'),
        JSON.stringify({ name: `@nihongo/${name}`, private: true })
      )
    }
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('admin/shared cannot reach API, domain, generator or Node runtime', () =>
  fixture((root) => {
    for (const owner of ['apps/admin', 'packages/browser']) {
      writeFileSync(
        join(root, owner, 'src/unsafe.ts'),
        "import '@nihongo/domain/content/v1'; import '@nihongo/api/server'; import 'node:fs'\n"
      )
    }
    const diagnostics = checkWorkspaceArchitecture({ rootDir: root })
    for (const owner of ['apps/admin', 'packages/browser'])
      assert.ok(
        diagnostics.some((diagnostic) =>
          JSON.stringify(diagnostic).includes(`${owner}/src/unsafe.ts`)
        )
      )
  }))
test('workspace graph resolves browser package and rejects app-to-app imports', () =>
  fixture((root) => {
    writeFileSync(
      join(root, 'apps/admin/src/entry.ts'),
      "import '@nihongo/web/router'; import '@nihongo/browser/ui'\n"
    )
    writeFileSync(
      join(root, 'packages/browser/src/ui.ts'),
      'export const title = "fixture"\n'
    )
    assert.ok(
      checkWorkspaceArchitecture({ rootDir: root }).some((diagnostic) =>
        JSON.stringify(diagnostic).includes('ARCH118')
      )
    )
  }))
