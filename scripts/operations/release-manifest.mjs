#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertReleaseId,
  createReleaseManifest,
  verifyReleaseManifest
} from './release-contract.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const defaultWorkspace = resolve(scriptDirectory, '../..')

const parseArguments = (argumentsList) => {
  const values = new Map()
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index]
    const value = argumentsList[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Release manifest arguments must be --key value pairs.')
    }
    if (values.has(key)) throw new Error(`Duplicate argument: ${key}`)
    values.set(key, value)
  }
  return values
}

const requiredArgument = (argumentsMap, name) => {
  const value = argumentsMap.get(name)
  if (!value) throw new Error(`Missing required argument: ${name}`)
  return value
}

const readPnpmVersion = (workspace) => {
  const packageJson = JSON.parse(
    readFileSync(resolve(workspace, 'package.json'), 'utf8')
  )
  const packageManager = packageJson.packageManager
  const match = /^pnpm@(.+)$/u.exec(packageManager)
  if (!match?.[1]) throw new Error('Root packageManager must pin pnpm.')
  return match[1]
}

const assertCleanExactSource = (workspace, releaseId) => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: workspace,
    encoding: 'utf8'
  }).trim()
  if (head !== releaseId) {
    throw new Error('Release ID does not match the checked-out Git commit.')
  }
  const status = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: workspace, encoding: 'utf8' }
  ).trim()
  if (status.length > 0) {
    throw new Error(
      'Source must contain no tracked or non-ignored untracked changes before release manifest creation.'
    )
  }
}

export const writeManifestAtomically = (outputPath, manifest) => {
  const parent = dirname(outputPath)
  if (existsSync(outputPath)) {
    throw new Error('Evidence output must not already exist.')
  }
  mkdirSync(parent, { mode: 0o700, recursive: true })
  const temporaryPath = `${outputPath}.tmp-${process.pid}`
  rmSync(temporaryPath, { force: true })
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, outputPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export const runReleaseManifestCli = (argumentsList) => {
  const argumentsMap = parseArguments(argumentsList)
  const mode = argumentsMap.get('--mode') ?? 'create'
  const workspace = resolve(argumentsMap.get('--workspace') ?? defaultWorkspace)

  if (mode === 'verify') {
    const input = resolve(requiredArgument(argumentsMap, '--input'))
    verifyReleaseManifest(JSON.parse(readFileSync(input, 'utf8')))
    return
  }
  if (mode !== 'create' && mode !== 'create-oci-component') {
    throw new Error(`Unsupported mode: ${mode}`)
  }

  const releaseId = assertReleaseId(
    requiredArgument(argumentsMap, '--release-id')
  )
  if (mode === 'create') {
    assertCleanExactSource(workspace, releaseId)
  } else if (process.env.NIHONGO_OCI_BUILD !== '1') {
    throw new Error(
      'OCI component mode is available only inside the image build.'
    )
  }
  const manifest = createReleaseManifest({
    apiDirectory: resolve(requiredArgument(argumentsMap, '--api-directory')),
    environmentContractPath: resolve(
      workspace,
      'operations/environment-contract.v1.json'
    ),
    lockfilePath: resolve(workspace, 'pnpm-lock.yaml'),
    nodeVersion: process.versions.node,
    pnpmVersion: readPnpmVersion(workspace),
    releaseId,
    webDirectory: resolve(requiredArgument(argumentsMap, '--web-directory'))
  })
  verifyReleaseManifest(manifest)
  writeManifestAtomically(
    resolve(requiredArgument(argumentsMap, '--output')),
    manifest
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runReleaseManifestCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Release manifest failed.'}\n`
    )
    process.exitCode = 1
  }
}
