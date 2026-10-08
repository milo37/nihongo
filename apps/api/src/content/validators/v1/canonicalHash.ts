import { createHash } from 'node:crypto'
import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'

export const sha256Bytes = (value: Uint8Array | string): string =>
  createHash('sha256').update(value).digest('hex')

export const canonicalJsonBytes = (value: unknown): Buffer =>
  Buffer.from(canonicalizeJson(value), 'utf8')

export const canonicalJsonSha256 = (value: unknown): string =>
  sha256Bytes(canonicalJsonBytes(value))

export const canonicalSelfHash = (
  value: Readonly<Record<string, unknown>>,
  selfHashKey: string
): string => {
  const projection = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== selfHashKey)
  )
  return canonicalJsonSha256(projection)
}
