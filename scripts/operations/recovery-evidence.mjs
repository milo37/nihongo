#!/usr/bin/env node

import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  verifyBackupEvidence,
  verifyRecoveryContract,
  verifyRecoveryPlan,
  verifyRestoreEvidence
} from './recovery-contract.mjs'

const MAXIMUM_INPUT_BYTES = 1_048_576

const parseArguments = (argumentsList) => {
  if (argumentsList.length % 2 !== 0) {
    throw new Error('Recovery arguments must be --key value pairs.')
  }
  const values = new Map()
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index]
    const value = argumentsList[index + 1]
    if (!key?.startsWith('--') || !value || values.has(key)) {
      throw new Error('Recovery arguments must be unique --key value pairs.')
    }
    values.set(key, value)
  }
  return values
}

const assertExactArguments = (argumentsMap, expectedKeys) => {
  if (
    JSON.stringify([...argumentsMap.keys()].sort()) !==
    JSON.stringify([...expectedKeys].sort())
  ) {
    throw new Error('Recovery verification received an invalid argument set.')
  }
}

const readBoundedJson = (path, label) => {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new Error(`${label} path must be absolute.`)
  }
  const absolutePath = resolve(path)
  let descriptor
  try {
    descriptor = openSync(
      absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
    const metadata = fstatSync(descriptor)
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > MAXIMUM_INPUT_BYTES
    ) {
      throw new Error(`${label} must be a bounded regular file.`)
    }
    const input = Buffer.allocUnsafe(MAXIMUM_INPUT_BYTES + 1)
    let totalBytes = 0
    while (totalBytes < input.length) {
      const bytesRead = readSync(
        descriptor,
        input,
        totalBytes,
        input.length - totalBytes,
        null
      )
      if (bytesRead === 0) break
      totalBytes += bytesRead
    }
    if (totalBytes === 0 || totalBytes > MAXIMUM_INPUT_BYTES) {
      throw new Error(`${label} exceeds the input boundary.`)
    }
    return JSON.parse(input.subarray(0, totalBytes).toString('utf8'))
  } catch {
    throw new Error(`${label} must be a bounded regular JSON file.`)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

export const runRecoveryEvidenceCli = (
  argumentsList,
  { now = () => new Date() } = {}
) => {
  const argumentsMap = parseArguments(argumentsList)
  const mode = argumentsMap.get('--mode')
  const commonArguments = [
    '--contract',
    '--evidence',
    '--expected-environment',
    '--mode',
    '--plan',
    '--release-manifest'
  ]
  if (mode === 'verify-backup') {
    assertExactArguments(argumentsMap, commonArguments)
  } else if (mode === 'verify-restore') {
    assertExactArguments(argumentsMap, [
      ...commonArguments,
      '--backup-evidence'
    ])
  } else {
    throw new Error('Recovery evidence CLI is verify-only.')
  }

  const contract = readBoundedJson(
    argumentsMap.get('--contract'),
    'Recovery contract'
  )
  const plan = readBoundedJson(argumentsMap.get('--plan'), 'Recovery plan')
  const releaseManifest = readBoundedJson(
    argumentsMap.get('--release-manifest'),
    'Release manifest'
  )
  const evidence = readBoundedJson(
    argumentsMap.get('--evidence'),
    'Recovery evidence'
  )
  const expectedEnvironment = argumentsMap.get('--expected-environment')
  const observedNow = now()

  verifyRecoveryContract(contract)
  verifyRecoveryPlan(plan, {
    contract,
    expectedEnvironment,
    releaseManifest
  })
  if (mode === 'verify-backup') {
    verifyBackupEvidence(evidence, {
      contract,
      expectedEnvironment,
      now: observedNow,
      plan,
      releaseManifest
    })
    return
  }

  const backupEvidence = readBoundedJson(
    argumentsMap.get('--backup-evidence'),
    'Backup evidence'
  )
  verifyRestoreEvidence(evidence, {
    backupEvidence,
    contract,
    expectedEnvironment,
    now: observedNow,
    plan,
    releaseManifest
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runRecoveryEvidenceCli(process.argv.slice(2))
  } catch {
    process.stderr.write('Recovery evidence verification failed.\n')
    process.exitCode = 1
  }
}
