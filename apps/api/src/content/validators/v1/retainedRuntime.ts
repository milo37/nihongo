import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { parseStrictJsonBytes } from './strictJson.js'

const RETAINED_VALIDATOR_ROOT = '/opt/validator'
const RETAINED_CLI_PATH = '/opt/validator/apps/api/dist/content/cli.js'
const RETAINED_TSX_LOADER_PATH =
  '/opt/validator/apps/api/node_modules/tsx/dist/loader.mjs'
const RETAINED_LEGACY_CHECK_PATH =
  '/opt/validator/apps/api/prisma/phase6Slice1ArtifactCheck.ts'
const RETAINED_REPOSITORY_ROOT = '/workspace'
const MAX_CHILD_OUTPUT_BYTES = 16 * 1024

export interface RetainedRuntimeAttestationV1 {
  readonly runtimeImageIndexSha256: string
}

export const assertRetainedRuntime =
  async (): Promise<RetainedRuntimeAttestationV1> => {
    const configuredDigest =
      process.env.CONTENT_VALIDATOR_RUNTIME_IMAGE_INDEX_SHA256
    if (
      process.env.CONTENT_RETAINED_RUNTIME !== '1' ||
      process.env.CONTENT_REPOSITORY_ROOT !== RETAINED_REPOSITORY_ROOT ||
      configuredDigest === undefined ||
      !/^[a-f0-9]{64}$/.test(configuredDigest) ||
      (await realpath(process.argv[1] ?? '')) !== RETAINED_CLI_PATH ||
      (await realpath(RETAINED_VALIDATOR_ROOT)) !== RETAINED_VALIDATOR_ROOT
    ) {
      throw new Error('RETAINED_RUNTIME_REQUIRED')
    }
    return { runtimeImageIndexSha256: configuredDigest }
  }

export interface CanonicalLegacyProjectionAttestationV1 {
  readonly itemCount: 65
  readonly seedSourceManifestSha256: string
  readonly legacySeedMappingSha256: string
  readonly globalReviewSha256: string
}

export const verifyCanonicalLegacyProjectionInRetainedRuntime =
  async (): Promise<CanonicalLegacyProjectionAttestationV1> =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          RETAINED_TSX_LOADER_PATH,
          RETAINED_LEGACY_CHECK_PATH,
          RETAINED_REPOSITORY_ROOT
        ],
        {
          cwd: RETAINED_REPOSITORY_ROOT,
          env: {
            HOME: '/tmp',
            LANG: 'C.UTF-8',
            LC_ALL: 'C.UTF-8',
            PATH: '/usr/local/bin:/usr/bin:/bin'
          },
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
      const stdout: Buffer[] = []
      let outputBytes = 0
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill('SIGKILL')
        reject(new Error('LEGACY_PROJECTION_CHECK_TIMEOUT'))
      }, 60_000)
      const consume =
        (target: Buffer[] | null) =>
        (chunk: Buffer): void => {
          outputBytes += chunk.length
          if (outputBytes > MAX_CHILD_OUTPUT_BYTES) {
            if (!settled) {
              settled = true
              clearTimeout(timer)
              child.kill('SIGKILL')
              reject(new Error('LEGACY_PROJECTION_CHECK_OUTPUT_OVERSIZED'))
            }
            return
          }
          target?.push(Buffer.from(chunk))
        }
      child.stdout.on('data', consume(stdout))
      child.stderr.on('data', consume(null))
      child.on('error', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error('LEGACY_PROJECTION_CHECK_FAILED'))
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code !== 0) {
          reject(new Error('LEGACY_PROJECTION_CHECK_FAILED'))
          return
        }
        const parsed = parseStrictJsonBytes(Buffer.concat(stdout))
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          !('status' in parsed) ||
          parsed.status !== 'PASS' ||
          !('itemCount' in parsed) ||
          parsed.itemCount !== 65 ||
          !('seedSourceManifestSha256' in parsed) ||
          typeof parsed.seedSourceManifestSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(parsed.seedSourceManifestSha256) ||
          !('legacySeedMappingSha256' in parsed) ||
          typeof parsed.legacySeedMappingSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(parsed.legacySeedMappingSha256) ||
          !('globalReviewSha256' in parsed) ||
          typeof parsed.globalReviewSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(parsed.globalReviewSha256)
        ) {
          reject(new Error('LEGACY_PROJECTION_CHECK_INVALID'))
          return
        }
        resolve({
          itemCount: 65,
          seedSourceManifestSha256: parsed.seedSourceManifestSha256,
          legacySeedMappingSha256: parsed.legacySeedMappingSha256,
          globalReviewSha256: parsed.globalReviewSha256
        })
      })
    })
