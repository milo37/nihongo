#!/usr/bin/env node

import { existsSync, lstatSync, realpathSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const selfLinkSegments = [
  'node_modules',
  '.pnpm',
  'node_modules',
  '@nihongo',
  'api'
]

const parseArguments = (argumentsList) => {
  if (argumentsList.length % 2 !== 0) {
    throw new Error('API deploy normalization arguments must be pairs.')
  }
  const values = new Map()
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index]
    const value = argumentsList[index + 1]
    if (!key?.startsWith('--') || !value || values.has(key)) {
      throw new Error(
        'API deploy normalization arguments must be unique --key value pairs.'
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

export const normalizeApiDeploy = ({ apiDirectory, workspaceApiDirectory }) => {
  const deployRoot = realpathSync(resolve(apiDirectory))
  const expectedWorkspaceApi = realpathSync(resolve(workspaceApiDirectory))
  const selfLink = join(deployRoot, ...selfLinkSegments)
  const metadata = lstatSync(selfLink)

  if (!metadata.isSymbolicLink()) {
    throw new Error('Portable API deploy self reference must be a symlink.')
  }
  if (realpathSync(selfLink) !== expectedWorkspaceApi) {
    throw new Error(
      'Portable API deploy self reference does not match the workspace API.'
    )
  }

  unlinkSync(selfLink)
  if (existsSync(selfLink)) {
    throw new Error('Portable API deploy self reference was not removed.')
  }
}

export const runNormalizeApiDeployCli = (
  argumentsList,
  { ociBuild = process.env.NIHONGO_OCI_BUILD } = {}
) => {
  if (ociBuild !== '1') {
    throw new Error('API deploy normalization is restricted to OCI builds.')
  }
  const argumentsMap = parseArguments(argumentsList)
  if (
    JSON.stringify([...argumentsMap.keys()].sort()) !==
    JSON.stringify(['--api-directory', '--workspace-api-directory'])
  ) {
    throw new Error(
      'API deploy normalization received an invalid argument set.'
    )
  }
  normalizeApiDeploy({
    apiDirectory: requiredArgument(argumentsMap, '--api-directory'),
    workspaceApiDirectory: requiredArgument(
      argumentsMap,
      '--workspace-api-directory'
    )
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runNormalizeApiDeployCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'API deploy normalization failed.'}\n`
    )
    process.exitCode = 1
  }
}
