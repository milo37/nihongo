import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (file: string) => readFileSync(file, 'utf8')
const productionSources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory())
      return ['generated', 'fixtures', 'e2e'].includes(entry.name)
        ? []
        : productionSources(path)
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)
      ? [path]
      : []
  })
const localImports = (file: string): string[] =>
  [...source(file).matchAll(/from\s+'(\.[^']+)'|import\(\s*'(\.[^']+)'/gu)]
    .map((match) =>
      resolve(dirname(file), (match[1] ?? match[2]!).replace(/\.js$/u, '.ts'))
    )
    .filter((path) => existsSync(path))
const reachableFrom = (entry: string): Set<string> => {
  const seen = new Set<string>()
  const pending = [entry]
  for (let file = pending.pop(); file; file = pending.pop()) {
    if (seen.has(file)) continue
    seen.add(file)
    pending.push(...localImports(file))
  }
  return seen
}
const name = (file: string) => relative(sourceRoot, file)

describe('account erasure execution entry (#57)', () => {
  it('runs only from the apps/api CLI command, never from the web server', () => {
    const scripts = (
      JSON.parse(source(resolve(sourceRoot, '../package.json'))) as {
        scripts: Record<string, string>
      }
    ).scripts
    expect(scripts['auth:erase-deletion-pending']).toContain(
      'src/auth/ssoAccountErasureCommand.ts'
    )
    const callers = productionSources(sourceRoot)
      .filter((file) =>
        /\b(?:createSsoAccountErasureWorker|runSsoAccountErasureBatch|runSsoProviderRevokeBatch)\(/u.test(
          source(file)
        )
      )
      .map(name)
      .toSorted()
    expect(callers).toEqual(['auth/ssoAccountErasureCommand.ts'])
    const server = [...reachableFrom(resolve(sourceRoot, 'server.ts'))].map(
      name
    )
    // The web server requests erasure through the repository it shares.
    expect(server).toContain('auth/ssoAccountRepository.ts')
    expect(server).not.toContain('auth/ssoAccountErasureCommand.ts')
    expect(server).not.toContain('auth/ssoProviderRevoke.ts')
  })
})
