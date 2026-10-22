import {
  normalizeReleaseHashInput,
  type ReleaseHashInputV1
} from '@nihongo/domain/content/validators/v1/release-hash'
import { canonicalJsonSha256 } from './canonicalHash.js'

export const calculateReleaseSha256 = (input: ReleaseHashInputV1): string =>
  canonicalJsonSha256(normalizeReleaseHashInput(input))

export const assertReleaseSha256 = (
  input: ReleaseHashInputV1,
  expectedReleaseSha256: string
): void => {
  if (calculateReleaseSha256(input) !== expectedReleaseSha256) {
    throw new Error('RELEASE_SHA256_MISMATCH')
  }
}
