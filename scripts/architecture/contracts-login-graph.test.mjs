import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const source = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../packages/contracts/src'
)
const IMPORT =
  /(?:import|export)\s[^'"]*?from\s+'(\.[^']+)'|import\s+'(\.[^']+)'/gu

/** Relative modules a contracts file reaches, type-only imports included. */
const reachable = (entry) => {
  const seen = new Set()
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const target = join(
        dirname(file),
        (match[1] ?? match[2]).replace(/\.js$/u, '.ts')
      )
      assert.ok(existsSync(target), `${relative(source, file)} → ${target}`)
      pending.push(target)
    }
  }
  return [...seen].map((file) => relative(source, file))
}

// #1053: the learner login page checks its return path with this module, so
// it must not pull the admin content contracts into the learner bundle.
test('login return-path check reaches only the light admin report route', () => {
  const modules = reachable(join(source, 'auth/sign-in-social.ts'))
  assert.ok(modules.includes('admin/question-report-route.ts'))
  assert.deepEqual(
    modules.filter(
      (module) =>
        module.startsWith('admin/') &&
        module !== 'admin/question-report-route.ts'
    ),
    []
  )
  assert.ok(!modules.includes('common/content-validation.ts'))
})
