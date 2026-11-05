import { createHash } from 'node:crypto'

type SshSignatureErrorCode =
  | 'PUBLIC_KEY_INVALID'
  | 'SIGNATURE_INVALID'
  | 'SIGNATURE_OVERSIZED'
  | 'SIGNATURE_TOOL_FAILED'
  | 'SIGNATURE_TOOL_TIMEOUT'

class SshSignatureError extends Error {
  readonly code: SshSignatureErrorCode

  constructor(code: SshSignatureErrorCode, message: string) {
    super(message)
    this.name = 'SshSignatureError'
    this.code = code
  }
}

interface ParsedSshEd25519PublicKey {
  readonly canonical: string
  readonly blob: Buffer
  readonly fingerprintSha256: string
}

export const parseSshEd25519PublicKey = (
  value: string
): ParsedSshEd25519PublicKey => {
  const match = /^(ssh-ed25519) ([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) {
    throw new SshSignatureError(
      'PUBLIC_KEY_INVALID',
      'public key는 comment 없는 canonical two-field Ed25519 key여야 합니다.'
    )
  }
  const encoded = match[2] ?? ''
  const blob = Buffer.from(encoded, 'base64')
  if (blob.toString('base64') !== encoded || blob.length !== 51) {
    throw new SshSignatureError(
      'PUBLIC_KEY_INVALID',
      'public key Base64 또는 blob length가 유효하지 않습니다.'
    )
  }
  const algorithmLength = blob.readUInt32BE(0)
  const algorithmEnd = 4 + algorithmLength
  if (
    algorithmLength !== 11 ||
    blob.subarray(4, algorithmEnd).toString('ascii') !== 'ssh-ed25519' ||
    blob.readUInt32BE(algorithmEnd) !== 32 ||
    algorithmEnd + 4 + 32 !== blob.length
  ) {
    throw new SshSignatureError(
      'PUBLIC_KEY_INVALID',
      'public key wire-format이 canonical Ed25519가 아닙니다.'
    )
  }
  return {
    canonical: value,
    blob,
    fingerprintSha256: createHash('sha256').update(blob).digest('hex')
  }
}
