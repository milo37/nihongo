import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertExactReleaseMarker,
  collectTreeInventory
} from './release-contract.mjs'

export const assertBrowserBuildGraph = (artifact, modules) => {
  if (
    !['web', 'admin'].includes(artifact) ||
    !Array.isArray(modules) ||
    modules.length === 0
  ) {
    throw new Error('Invalid browser build graph.')
  }
  for (const module of modules) {
    if (typeof module !== 'string')
      throw new Error('Invalid browser module ID.')
    const id = `/${module.replaceAll('\\', '/')}`
    if (
      /\/(?:apps\/api|packages\/domain|scripts\/content|content|prisma)\//u.test(
        id
      ) ||
      /\/(?:mocks|node_modules\/msw)\//u.test(id) ||
      /\/node_modules\/\.pnpm\/msw@/u.test(id) ||
      /(?:^|\/)node:/u.test(id) ||
      /\/(?:\.env(?:\.|$)|[^/]+\.(?:key|pem)$)/u.test(id)
    ) {
      throw new Error(
        `Forbidden server, mock or private module in ${artifact} build: ${module}`
      )
    }
    if (
      artifact === 'web' &&
      /\/(?:apps\/admin\/src|app\/admin-question|api\/admin-question)\//u.test(
        id
      )
    ) {
      throw new Error(`Admin module in learner build: ${module}`)
    }
  }
}

export const assertBrowserArtifact = (artifact, directory) => {
  const entries = collectTreeInventory(directory, { enforceSafeNames: true })
  if (entries.some((entry) => entry.type !== 'file')) {
    throw new Error('Browser artifacts cannot contain symlinks.')
  }
  const manifest = JSON.parse(
    readFileSync(join(directory, 'browser-build-manifest.json'), 'utf8')
  )
  if (manifest.artifact !== artifact)
    throw new Error('Browser artifact identity mismatch.')
  assertBrowserBuildGraph(artifact, manifest.modules)
  const html = readFileSync(join(directory, 'index.html'), 'utf8')
  assertExactReleaseMarker(html, manifest.releaseId, `${artifact} artifact`, {
    allowLocal: true
  })
  const prefix = artifact === 'admin' ? '/admin/' : '/'
  const scriptPaths = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gu)].map(
    (match) => match[1]
  )
  if (
    scriptPaths.length === 0 ||
    scriptPaths.some(
      (url) =>
        !url.startsWith(`${prefix}assets/`) ||
        !entries.some((entry) => entry.path === url.slice(prefix.length))
    )
  ) {
    throw new Error('Browser entry asset path does not match its app base.')
  }
  for (const entry of entries) {
    if (
      /(?:^|\/)(?:mockServiceWorker\.js|mocks|content|prisma)(?:\/|$)/u.test(
        entry.path
      )
    ) {
      throw new Error(`Forbidden browser artifact file: ${entry.path}`)
    }
    if (!/\.(?:js|mjs|json|html|css|map)$/u.test(entry.path)) continue
    const source = readFileSync(join(directory, entry.path), 'utf8')
    if (
      /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:DATABASE_URL|GOOGLE_CLIENT_SECRET|CONTENT_POLICY_ROOT_FINGERPRINT_SHA256)\b/u.test(
        source
      )
    ) {
      throw new Error(
        `Private runtime material in browser artifact: ${entry.path}`
      )
    }
  }
  return {
    artifact,
    releaseId: manifest.releaseId,
    files: entries.length,
    modules: manifest.modules.length
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [artifact, directory, ...extra] = process.argv.slice(2)
  if (!artifact || !directory || extra.length)
    throw new Error('Usage: browser-artifact-check.mjs web|admin DIRECTORY')
  console.log(
    JSON.stringify(assertBrowserArtifact(artifact, resolve(directory)))
  )
}
