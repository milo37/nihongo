#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertReleaseId, verifyReleaseManifest } from './release-contract.mjs'
import { writeManifestAtomically } from './release-manifest.mjs'

const imageIdPattern = /^sha256:[0-9a-f]{64}$/u
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const parseArguments = (argumentsList) => {
  const values = new Map()
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index]
    const value = argumentsList[index + 1]
    if (!key?.startsWith('--') || value === undefined || values.has(key)) {
      throw new Error(
        'OCI evidence arguments must be unique --key value pairs.'
      )
    }
    values.set(key, value)
  }
  return values
}

const requiredArgument = (argumentsMap, name) => {
  const value = argumentsMap.get(name)
  if (!value) throw new Error(`Missing required argument: ${name}`)
  return value
}

const assertExactKeys = (value, expectedKeys) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('OCI evidence must be an object.')
  }
  if (
    JSON.stringify(Object.keys(value).sort()) !==
    JSON.stringify([...expectedKeys].sort())
  ) {
    throw new Error('OCI evidence has an invalid key set.')
  }
}

export const createOciEvidence = ({ imageId, manifestBytes, releaseId }) => {
  const manifest = verifyReleaseManifest(
    JSON.parse(manifestBytes.toString('utf8'))
  )
  const expectedReleaseId = assertReleaseId(releaseId)
  if (manifest.releaseId !== expectedReleaseId) {
    throw new Error('OCI manifest release ID mismatch.')
  }
  if (!imageIdPattern.test(imageId)) {
    throw new Error('OCI image ID must be a sha256 digest.')
  }
  return {
    schemaVersion: 1,
    releaseId: expectedReleaseId,
    imageId,
    componentManifestSha256: sha256(manifestBytes),
    components: {
      apiSha256: manifest.artifacts.api.digestSha256,
      webSha256: manifest.artifacts.web.digestSha256,
      migrationsSha256: manifest.migrations.digestSha256,
      environmentContractSha256: manifest.environmentContract.sha256
    }
  }
}

export const verifyOciEvidence = (evidence) => {
  assertExactKeys(evidence, [
    'components',
    'componentManifestSha256',
    'imageId',
    'releaseId',
    'schemaVersion'
  ])
  assertExactKeys(evidence.components, [
    'apiSha256',
    'environmentContractSha256',
    'migrationsSha256',
    'webSha256'
  ])
  if (
    evidence.schemaVersion !== 1 ||
    !imageIdPattern.test(evidence.imageId) ||
    !/^[0-9a-f]{64}$/u.test(evidence.componentManifestSha256)
  ) {
    throw new Error('Invalid OCI evidence.')
  }
  assertReleaseId(evidence.releaseId)
  for (const digest of Object.values(evidence.components)) {
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) {
      throw new Error('Invalid OCI component digest.')
    }
  }
  return evidence
}

export const runOciEvidenceCli = (argumentsList) => {
  const argumentsMap = parseArguments(argumentsList)
  const mode = argumentsMap.get('--mode') ?? 'create'
  if (mode === 'verify') {
    verifyOciEvidence(
      JSON.parse(
        readFileSync(resolve(requiredArgument(argumentsMap, '--input')), 'utf8')
      )
    )
    return
  }
  if (mode !== 'create') throw new Error(`Unsupported mode: ${mode}`)

  const manifestBytes = readFileSync(
    resolve(requiredArgument(argumentsMap, '--manifest'))
  )
  const evidence = createOciEvidence({
    imageId: requiredArgument(argumentsMap, '--image-id'),
    manifestBytes,
    releaseId: requiredArgument(argumentsMap, '--release-id')
  })
  verifyOciEvidence(evidence)
  writeManifestAtomically(
    resolve(requiredArgument(argumentsMap, '--output')),
    evidence
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runOciEvidenceCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'OCI evidence failed.'}\n`
    )
    process.exitCode = 1
  }
}
