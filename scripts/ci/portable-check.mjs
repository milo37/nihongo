import { randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  assertReleaseId,
  verifyReleaseManifest
} from '../operations/release-contract.mjs'
import {
  assertExpectedRuntimeImageId,
  runPortableRuntimeSmoke,
  verifyPortableRuntimeSmokeEvidence
} from '../operations/portable-runtime-smoke.mjs'

const runCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.capture ? 'utf8' : undefined,
    env: process.env,
    stdio: options.capture ? 'pipe' : 'inherit'
  })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`PORTABLE_COMMAND_SIGNAL:${result.signal}`)
  if (result.status !== 0) {
    throw new Error(`PORTABLE_COMMAND_FAILED:${command}:${result.status ?? 1}`)
  }
  return options.capture ? result.stdout.trim() : ''
}

export const verifyPortableSource = ({
  releaseId,
  repositoryRoot,
  git = execFileSync
}) => {
  assertReleaseId(releaseId)
  const head = git('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  }).trim()
  const status = git(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: repositoryRoot, encoding: 'utf8', stdio: 'pipe' }
  ).trim()
  if (head !== releaseId) throw new Error('PORTABLE_RELEASE_ID_MISMATCH')
  if (status) throw new Error('PORTABLE_SOURCE_DIRTY')
  return releaseId
}

export const runPortableCheck = async ({
  releaseId,
  repositoryRoot,
  command = runCommand
}) => {
  verifyPortableSource({ releaseId, repositoryRoot })
  const suffix = `${releaseId.slice(0, 12)}-${randomUUID().slice(0, 8)}`
  const imageTag = `nihongo-portable:${suffix}`
  const manifestContainer = `nihongo-portable-manifest-${suffix}`
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), 'nihongo-portable-check-')
  )
  const manifestPath = path.join(temporaryDirectory, 'release-manifest.json')
  const runtimePath = path.join(temporaryDirectory, 'runtime-smoke.json')
  let operationError
  let containerCreated = false
  let imageCreated = false

  try {
    command(
      'docker',
      [
        'build',
        '--build-arg',
        `RELEASE_ID=${releaseId}`,
        '--tag',
        imageTag,
        '.'
      ],
      { cwd: repositoryRoot }
    )
    imageCreated = true
    const imageId = command(
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}', imageTag],
      { cwd: repositoryRoot, capture: true }
    )
    const revision = command(
      'docker',
      [
        'image',
        'inspect',
        '--format',
        '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
        imageTag
      ],
      { cwd: repositoryRoot, capture: true }
    )
    if (revision !== releaseId)
      throw new Error('PORTABLE_IMAGE_REVISION_MISMATCH')

    command('docker', ['create', '--name', manifestContainer, imageId], {
      cwd: repositoryRoot
    })
    containerCreated = true
    command(
      'docker',
      ['cp', `${manifestContainer}:/app/release-manifest.json`, manifestPath],
      { cwd: repositoryRoot }
    )
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    verifyReleaseManifest(manifest)
    if (manifest.releaseId !== releaseId) {
      throw new Error('PORTABLE_MANIFEST_RELEASE_ID_MISMATCH')
    }

    command('pnpm', ['run', 'db:generate'], { cwd: repositoryRoot })
    await runPortableRuntimeSmoke({
      expectedImageId: imageId,
      image: imageId,
      output: runtimePath,
      releaseId
    })
    const runtime = verifyPortableRuntimeSmokeEvidence(
      JSON.parse(readFileSync(runtimePath, 'utf8'))
    )
    assertExpectedRuntimeImageId(runtime.imageId, imageId)
    process.stdout.write(
      `${JSON.stringify({
        event: 'portable.image.verified',
        imageId,
        releaseId
      })}\n`
    )
  } catch (error) {
    operationError = error
  }

  const cleanupErrors = []
  if (containerCreated) {
    try {
      command('docker', ['rm', '-f', manifestContainer], {
        cwd: repositoryRoot
      })
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (imageCreated) {
    try {
      command('docker', ['image', 'rm', '-f', imageTag], {
        cwd: repositoryRoot
      })
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  try {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (operationError && cleanupErrors.length) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      'PORTABLE_OPERATION_AND_CLEANUP_FAILED'
    )
  }
  if (operationError) throw operationError
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, 'PORTABLE_CLEANUP_FAILED')
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
  )
  const releaseId = process.env.RELEASE_ID
  runPortableCheck({ releaseId, repositoryRoot }).catch((error) => {
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_:.-]+$/u.test(error.message)
        ? error.message
        : 'PORTABLE_CHECK_FAILED'
    process.stderr.write(
      `${JSON.stringify({ event: 'portable.image.failed', code })}\n`
    )
    process.exitCode = 1
  })
}
