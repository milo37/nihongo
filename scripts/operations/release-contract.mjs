import { createHash } from 'node:crypto'
import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync
} from 'node:fs'
import {
  basename,
  dirname,
  extname,
  join,
  posix,
  relative,
  resolve,
  sep
} from 'node:path'

export const LOCAL_RELEASE_ID = '0000000000000000000000000000000000000000'
export const RELEASE_ID_PATTERN = /^[0-9a-f]{40}$/u
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const MIGRATION_NAME_PATTERN = /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*$/u

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const assertExactKeys = (value, expectedKeys, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  const actualKeys = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expected)) {
    throw new Error(`${label} has an invalid key set.`)
  }
}

const toPortablePath = (value) => value.split(sep).join('/')

const isWithin = (root, candidate) => {
  const pathFromRoot = relative(root, candidate)
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..')
  )
}

export const assertReleaseId = (releaseId, { allowLocal = false } = {}) => {
  if (!RELEASE_ID_PATTERN.test(releaseId)) {
    throw new Error('Release ID must be a lowercase 40-character Git SHA.')
  }
  if (!allowLocal && releaseId === LOCAL_RELEASE_ID) {
    throw new Error('The local release sentinel cannot identify a release.')
  }
  return releaseId
}

const parseMetaAttributes = (tag) => {
  const match = /^<meta\b([\s\S]*?)\s*\/?>$/iu.exec(tag)
  if (!match) return null

  let remaining = match[1]
  const attributes = new Map()
  while (remaining.trim().length > 0) {
    const attribute =
      /^\s+([a-z][a-z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(remaining)
    if (!attribute) return null
    const name = attribute[1].toLowerCase()
    if (attributes.has(name)) return null
    attributes.set(name, attribute[2] ?? attribute[3])
    remaining = remaining.slice(attribute[0].length)
  }
  return attributes
}

export const assertExactReleaseMarker = (html, releaseId, label) => {
  assertReleaseId(releaseId)
  const markupOnly = html
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(
      /<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
      ''
    )
  const candidates = [...markupOnly.matchAll(/<meta\b[^<>]*>/giu)].filter(
    ([tag]) => {
      const attributes = parseMetaAttributes(tag)
      return (
        attributes?.get('name')?.toLowerCase() === 'nihongo-release-id' ||
        /nihongo-release-id/iu.test(tag)
      )
    }
  )

  if (candidates.length !== 1) {
    throw new Error(`${label} must contain exactly one release marker.`)
  }
  const attributes = parseMetaAttributes(candidates[0][0])
  if (
    attributes === null ||
    attributes.size !== 2 ||
    attributes.get('name') !== 'nihongo-release-id' ||
    attributes.get('content') !== releaseId
  ) {
    throw new Error(`${label} release marker does not match RELEASE_ID.`)
  }
}

export const assertSafeReleasePath = (path) => {
  const name = basename(path)
  const extension = extname(name).toLowerCase()
  if (
    name === '.env' ||
    name.startsWith('.env.') ||
    ['.backup', '.dump', '.key', '.pem'].includes(extension)
  ) {
    throw new Error(`Forbidden release file: ${path}`)
  }
}

export const collectTreeInventory = (directory, options = {}) => {
  const root = realpathSync(directory)
  const entries = []
  const { enforceSafeNames = false } = options

  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort(
      (left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    )) {
      const absolutePath = join(current, entry.name)
      const portablePath = toPortablePath(relative(root, absolutePath))
      if (enforceSafeNames) assertSafeReleasePath(portablePath)

      const metadata = lstatSync(absolutePath)
      if (metadata.isSymbolicLink()) {
        const target = readlinkSync(absolutePath)
        const resolvedTarget = resolve(dirname(absolutePath), target)
        if (
          !isWithin(root, resolvedTarget) ||
          !isWithin(root, realpathSync(resolvedTarget))
        ) {
          throw new Error(
            `Release symlink escapes its artifact: ${portablePath}`
          )
        }
        entries.push({
          path: portablePath,
          target: toPortablePath(
            relative(dirname(absolutePath), resolvedTarget)
          ),
          type: 'symlink'
        })
        continue
      }

      if (metadata.isDirectory()) {
        visit(absolutePath)
        continue
      }

      if (!metadata.isFile()) {
        throw new Error(`Unsupported release entry: ${portablePath}`)
      }

      const content = readFileSync(absolutePath)
      entries.push({
        bytes: metadata.size,
        path: portablePath,
        sha256: sha256(content),
        type: 'file'
      })
    }
  }

  visit(root)
  entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  )
  if (entries.length === 0) {
    throw new Error(`Release artifact is empty: ${directory}`)
  }
  return entries
}

export const summarizeInventory = (entries) => ({
  digestSha256: sha256(
    entries
      .map((entry) =>
        entry.type === 'file'
          ? `file\0${entry.path}\0${entry.bytes}\0${entry.sha256}\n`
          : `symlink\0${entry.path}\0${entry.target}\n`
      )
      .join('')
  ),
  entryCount: entries.length,
  entries
})

const collectMigrationInventory = (migrationsDirectory) => {
  const migrations = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      if (!MIGRATION_NAME_PATTERN.test(entry.name)) {
        throw new Error(`Invalid migration directory name: ${entry.name}`)
      }
      const migrationFile = join(
        migrationsDirectory,
        entry.name,
        'migration.sql'
      )
      const metadata = lstatSync(migrationFile)
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error(`Migration is not a regular file: ${entry.name}`)
      }
      return {
        name: entry.name,
        sha256: sha256(readFileSync(migrationFile))
      }
    })
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    )

  if (migrations.length === 0) {
    throw new Error('Release contains no database migrations.')
  }

  return {
    count: migrations.length,
    digestSha256: sha256(
      migrations
        .map((migration) => `${migration.name}\0${migration.sha256}\n`)
        .join('')
    ),
    entries: migrations
  }
}

export const createReleaseManifest = ({
  apiDirectory,
  environmentContractPath,
  lockfilePath,
  nodeVersion,
  pnpmVersion,
  releaseId,
  webDirectory
}) => {
  assertReleaseId(releaseId)
  const webIndex = readFileSync(join(webDirectory, 'index.html'), 'utf8')
  assertExactReleaseMarker(webIndex, releaseId, 'Web artifact')

  const apiTopLevel = readdirSync(apiDirectory).sort()
  const unexpectedApiEntry = apiTopLevel.find(
    (entry) =>
      !['dist', 'node_modules', 'package.json', 'prisma'].includes(entry)
  )
  if (unexpectedApiEntry) {
    throw new Error(`Unexpected API artifact entry: ${unexpectedApiEntry}`)
  }
  const prismaTopLevel = readdirSync(join(apiDirectory, 'prisma')).sort()
  if (prismaTopLevel.length !== 1 || prismaTopLevel[0] !== 'migrations') {
    throw new Error('API artifact prisma payload must contain migrations only.')
  }

  const apiInventory = collectTreeInventory(apiDirectory)
  const webInventory = collectTreeInventory(webDirectory, {
    enforceSafeNames: true
  })
  for (const entry of apiInventory) {
    if (!entry.path.startsWith('node_modules/')) {
      assertSafeReleasePath(entry.path)
    }
  }

  const environmentContract = readFileSync(environmentContractPath)
  const lockfile = readFileSync(lockfilePath)
  JSON.parse(environmentContract.toString('utf8'))

  return {
    schemaVersion: 1,
    releaseId,
    source: {
      commit: releaseId,
      lockfileSha256: sha256(lockfile)
    },
    runtime: {
      node: nodeVersion,
      pnpm: pnpmVersion
    },
    artifacts: {
      api: summarizeInventory(apiInventory),
      web: summarizeInventory(webInventory)
    },
    migrations: collectMigrationInventory(
      join(apiDirectory, 'prisma', 'migrations')
    ),
    environmentContract: {
      path: 'operations/environment-contract.v1.json',
      sha256: sha256(environmentContract)
    }
  }
}

export const verifyReleaseManifest = (manifest) => {
  assertExactKeys(
    manifest,
    [
      'artifacts',
      'environmentContract',
      'migrations',
      'releaseId',
      'runtime',
      'schemaVersion',
      'source'
    ],
    'Release manifest'
  )
  if (manifest.schemaVersion !== 1) {
    throw new Error('Unsupported release manifest schema.')
  }
  assertReleaseId(manifest.releaseId)
  assertExactKeys(manifest.source, ['commit', 'lockfileSha256'], 'Source')
  if (
    manifest.source.commit !== manifest.releaseId ||
    !SHA256_PATTERN.test(manifest.source.lockfileSha256)
  ) {
    throw new Error('Invalid source provenance.')
  }
  assertExactKeys(manifest.runtime, ['node', 'pnpm'], 'Runtime')
  if (
    typeof manifest.runtime.node !== 'string' ||
    typeof manifest.runtime.pnpm !== 'string'
  ) {
    throw new Error('Invalid runtime versions.')
  }
  assertExactKeys(manifest.artifacts, ['api', 'web'], 'Artifacts')
  for (const key of ['api', 'web']) {
    const artifact = manifest.artifacts?.[key]
    assertExactKeys(
      artifact,
      ['digestSha256', 'entries', 'entryCount'],
      `${key} artifact`
    )
    if (
      !artifact ||
      !Number.isInteger(artifact.entryCount) ||
      artifact.entryCount <= 0 ||
      !SHA256_PATTERN.test(artifact.digestSha256) ||
      !Array.isArray(artifact.entries) ||
      artifact.entries.length !== artifact.entryCount
    ) {
      throw new Error(`Invalid ${key} artifact summary.`)
    }
    const paths = new Set()
    let previousPath = ''
    for (const entry of artifact.entries) {
      const expectedKeys =
        entry?.type === 'file'
          ? ['bytes', 'path', 'sha256', 'type']
          : ['path', 'target', 'type']
      assertExactKeys(entry, expectedKeys, `${key} artifact entry`)
      if (
        typeof entry.path !== 'string' ||
        entry.path.length === 0 ||
        entry.path.startsWith('/') ||
        entry.path.split('/').includes('..') ||
        paths.has(entry.path) ||
        (previousPath.length > 0 && previousPath >= entry.path)
      ) {
        throw new Error(`Invalid ${key} artifact path.`)
      }
      paths.add(entry.path)
      previousPath = entry.path
      if (
        entry.type === 'file' &&
        (!Number.isInteger(entry.bytes) ||
          entry.bytes < 0 ||
          !SHA256_PATTERN.test(entry.sha256))
      ) {
        throw new Error(`Invalid ${key} file entry.`)
      }
      if (
        entry.type === 'symlink' &&
        (typeof entry.target !== 'string' ||
          entry.target.length === 0 ||
          posix.isAbsolute(entry.target) ||
          posix
            .normalize(posix.join(posix.dirname(entry.path), entry.target))
            .startsWith('../') ||
          posix.normalize(
            posix.join(posix.dirname(entry.path), entry.target)
          ) === '..')
      ) {
        throw new Error(`Invalid ${key} symlink entry.`)
      }
      if (entry.type !== 'file' && entry.type !== 'symlink') {
        throw new Error(`Invalid ${key} artifact entry type.`)
      }
    }
    const recomputed = summarizeInventory(artifact.entries)
    if (recomputed.digestSha256 !== artifact.digestSha256) {
      throw new Error(`Invalid ${key} artifact digest.`)
    }
  }
  assertExactKeys(
    manifest.migrations,
    ['count', 'digestSha256', 'entries'],
    'Migrations'
  )
  if (
    !Number.isInteger(manifest.migrations?.count) ||
    manifest.migrations.count <= 0 ||
    manifest.migrations.entries?.length !== manifest.migrations.count ||
    !SHA256_PATTERN.test(manifest.migrations.digestSha256)
  ) {
    throw new Error('Invalid migration inventory.')
  }
  let previousMigrationName = ''
  for (const migration of manifest.migrations.entries) {
    assertExactKeys(migration, ['name', 'sha256'], 'Migration entry')
    if (
      typeof migration.name !== 'string' ||
      !MIGRATION_NAME_PATTERN.test(migration.name) ||
      (previousMigrationName.length > 0 &&
        previousMigrationName >= migration.name) ||
      !SHA256_PATTERN.test(migration.sha256)
    ) {
      throw new Error('Invalid migration entry.')
    }
    previousMigrationName = migration.name
  }
  const migrationDigest = sha256(
    manifest.migrations.entries
      .map((migration) => `${migration.name}\0${migration.sha256}\n`)
      .join('')
  )
  if (migrationDigest !== manifest.migrations.digestSha256) {
    throw new Error('Invalid migration digest.')
  }
  assertExactKeys(
    manifest.environmentContract,
    ['path', 'sha256'],
    'Environment contract'
  )
  if (
    manifest.environmentContract.path !==
      'operations/environment-contract.v1.json' ||
    !SHA256_PATTERN.test(manifest.environmentContract.sha256)
  ) {
    throw new Error('Invalid environment contract provenance.')
  }
  return manifest
}
