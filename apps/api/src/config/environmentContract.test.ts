import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { API_ENVIRONMENT_VARIABLE_NAMES } from './env.js'

const read = (path: string): string =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')

const contract = JSON.parse(
  read('operations/environment-contract.v1.json')
) as {
  publicVariableNames: string[]
  secretVariableNames: string[]
}
const contractNames = new Set([
  ...contract.publicVariableNames,
  ...contract.secretVariableNames
])
// Read outside the API process: commands and the web build.
const NOT_READ_BY_API = new Set([
  'PRODUCTION_DATABASE_URL',
  // #1046: the daily push command signs with these; the API only needs the
  // public key.
  'WEB_PUSH_PRIVATE_KEY',
  'WEB_PUSH_SUBJECT',
  'VITE_API_MODE',
  'VITE_API_BASE_URL',
  'VITE_RELEASE_ID'
])
// Local migrations only; the hosts get it from Terraform.
const LOCAL_ONLY = new Set(['MIGRATION_DATABASE_URL'])
// Apple sign-in is not deployed, so no host parameter exists for it yet.
const NOT_DEPLOYED = new Set(['APPLE_CLIENT_SECRET'])

const dotenvNames = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => /^#?\s*([A-Z][A-Z0-9_]*)=/u.exec(line)?.[1])
    .filter((name): name is string => name !== undefined)

describe('#672 environment variable lists agree', () => {
  it('the contract names exactly the variables the API reads', () => {
    expect(
      [...contractNames].filter((name) => !NOT_READ_BY_API.has(name)).sort()
    ).toEqual([...API_ENVIRONMENT_VARIABLE_NAMES].sort())
  })

  it('secrets are listed as secrets', () => {
    for (const name of API_ENVIRONMENT_VARIABLE_NAMES)
      if (/SECRET$|DATABASE_URL$/u.test(name))
        expect(contract.secretVariableNames).toContain(name)
  })

  it('the API example uses only contract names', () => {
    for (const name of dotenvNames(read('apps/api/.env.example')))
      expect(contractNames.has(name) || LOCAL_ONLY.has(name), name).toBe(true)
  })

  it('every contract secret has a host parameter in Terraform', () => {
    const terraform = read('infra/aws/main.tf')
    for (const name of contract.secretVariableNames)
      if (!NOT_DEPLOYED.has(name)) expect(terraform).toContain(`"${name}"`)
  })
})
