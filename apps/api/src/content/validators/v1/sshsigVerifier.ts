import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, mkdtemp, open, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const SSH_KEYGEN_PATH = '/usr/bin/ssh-keygen'
const SSH_PATH = '/usr/bin/ssh'
const MAX_TOOL_OUTPUT_BYTES = 64 * 1024
const MAX_SIGNATURE_BYTES = 64 * 1024
const MAX_SIGNING_PAYLOAD_BYTES = 64 * 1024

export type SshSignatureNamespace =
  | 'nihongo-content-v1'
  | 'nihongo-policy-v1'
  | 'nihongo-policy-activation-v1'
  | 'nihongo-release-approval-v1'

export type SshSignatureErrorCode =
  | 'PUBLIC_KEY_INVALID'
  | 'SIGNATURE_INVALID'
  | 'SIGNATURE_OVERSIZED'
  | 'SIGNATURE_TOOL_FAILED'
  | 'SIGNATURE_TOOL_TIMEOUT'

export class SshSignatureError extends Error {
  readonly code: SshSignatureErrorCode

  constructor(code: SshSignatureErrorCode, message: string) {
    super(message)
    this.name = 'SshSignatureError'
    this.code = code
  }
}

export interface ParsedSshEd25519PublicKey {
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

export const parseSshEd25519PublicKeyFile = (
  bytes: Uint8Array
): ParsedSshEd25519PublicKey => {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw new SshSignatureError(
      'PUBLIC_KEY_INVALID',
      'public key file에 UTF-8 BOM을 허용하지 않습니다.'
    )
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new SshSignatureError(
      'PUBLIC_KEY_INVALID',
      'public key file은 strict UTF-8이어야 합니다.'
    )
  }
  if (
    text.includes('\r') ||
    !text.endsWith('\n') ||
    text.slice(0, -1).includes('\n')
  ) {
    throw new SshSignatureError(
      'PUBLIC_KEY_INVALID',
      'public key file은 canonical key 뒤 terminal LF 하나만 허용합니다.'
    )
  }
  return parseSshEd25519PublicKey(text.slice(0, -1))
}

const writePrivateTempFile = async (
  directory: string,
  name: string,
  bytes: Uint8Array
): Promise<string> => {
  const fileName = path.join(directory, name)
  const handle = await open(
    fileName,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600
  )
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmod(fileName, 0o600)
  return fileName
}

const runVerifier = async (
  allowedSignersPath: string,
  signaturePath: string,
  identity: string,
  namespace: SshSignatureNamespace,
  payload: Uint8Array
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      SSH_KEYGEN_PATH,
      [
        '-Y',
        'verify',
        '-f',
        allowedSignersPath,
        '-I',
        identity,
        '-n',
        namespace,
        '-s',
        signaturePath
      ],
      {
        env: {
          LANG: 'C',
          LC_ALL: 'C',
          PATH: '/usr/bin:/bin'
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    let outputBytes = 0
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(
        new SshSignatureError(
          'SIGNATURE_TOOL_TIMEOUT',
          'signature verifier가 제한 시간 안에 끝나지 않았습니다.'
        )
      )
    }, 10_000)

    const consume = (chunk: Buffer): void => {
      outputBytes += chunk.length
      if (outputBytes > MAX_TOOL_OUTPUT_BYTES && !settled) {
        settled = true
        clearTimeout(timer)
        child.kill('SIGKILL')
        reject(
          new SshSignatureError(
            'SIGNATURE_TOOL_FAILED',
            'signature verifier output cap을 초과했습니다.'
          )
        )
      }
    }
    child.stdout.on('data', consume)
    child.stderr.on('data', consume)
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(
        new SshSignatureError(
          'SIGNATURE_TOOL_FAILED',
          'signature verifier를 시작할 수 없습니다.'
        )
      )
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve()
      else {
        reject(
          new SshSignatureError(
            'SIGNATURE_INVALID',
            'SSHSIG verification에 실패했습니다.'
          )
        )
      }
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(payload)
  })

export interface VerifySshSignatureInput {
  readonly payload: Uint8Array
  readonly signature: Uint8Array
  readonly publicKey: string
  readonly expectedFingerprintSha256: string
  readonly identity: string
  readonly namespace: SshSignatureNamespace
}

export const readOpenSshVersion = async (): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(SSH_PATH, ['-V'], {
      env: {
        LANG: 'C',
        LC_ALL: 'C',
        PATH: '/usr/bin:/bin'
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const chunks: Buffer[] = []
    let outputBytes = 0
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(
        new SshSignatureError(
          'SIGNATURE_TOOL_TIMEOUT',
          'OpenSSH version probe가 제한 시간 안에 끝나지 않았습니다.'
        )
      )
    }, 10_000)
    const consume = (chunk: Buffer): void => {
      outputBytes += chunk.length
      if (outputBytes > MAX_TOOL_OUTPUT_BYTES) {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          child.kill('SIGKILL')
          reject(
            new SshSignatureError(
              'SIGNATURE_TOOL_FAILED',
              'OpenSSH version probe output cap을 초과했습니다.'
            )
          )
        }
        return
      }
      chunks.push(Buffer.from(chunk))
    }
    child.stdout.on('data', consume)
    child.stderr.on('data', consume)
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(
        new SshSignatureError(
          'SIGNATURE_TOOL_FAILED',
          'OpenSSH version probe를 시작할 수 없습니다.'
        )
      )
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        reject(
          new SshSignatureError(
            'SIGNATURE_TOOL_FAILED',
            'OpenSSH version probe에 실패했습니다.'
          )
        )
        return
      }
      const match = /OpenSSH_[0-9]+\.[0-9]+p[0-9]+/.exec(
        Buffer.concat(chunks).toString('utf8')
      )
      if (match === null) {
        reject(
          new SshSignatureError(
            'SIGNATURE_TOOL_FAILED',
            'OpenSSH version을 판독할 수 없습니다.'
          )
        )
        return
      }
      resolve(match[0])
    })
  })

export const verifySshSignature = async ({
  payload,
  signature,
  publicKey,
  expectedFingerprintSha256,
  identity,
  namespace
}: VerifySshSignatureInput): Promise<void> => {
  if (
    payload.byteLength < 1 ||
    payload.byteLength > MAX_SIGNING_PAYLOAD_BYTES ||
    signature.byteLength < 1 ||
    signature.byteLength > MAX_SIGNATURE_BYTES
  ) {
    throw new SshSignatureError(
      'SIGNATURE_OVERSIZED',
      'SSHSIG byte length가 유효하지 않습니다.'
    )
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(identity)) {
    throw new SshSignatureError(
      'SIGNATURE_INVALID',
      'SSHSIG identity가 유효하지 않습니다.'
    )
  }
  const parsed = parseSshEd25519PublicKey(publicKey)
  if (parsed.fingerprintSha256 !== expectedFingerprintSha256) {
    throw new SshSignatureError(
      'PUBLIC_KEY_INVALID',
      'public key fingerprint가 일치하지 않습니다.'
    )
  }

  const temporaryRoot = await mkdtemp(
    path.join(
      os.tmpdir(),
      `nihongo-content-sshsig-${randomBytes(6).toString('hex')}-`
    )
  )
  await chmod(temporaryRoot, 0o700)
  try {
    const allowedSigners = Buffer.from(
      `${identity} namespaces="${namespace}" ${parsed.canonical}\n`,
      'utf8'
    )
    const allowedPath = await writePrivateTempFile(
      temporaryRoot,
      'allowed_signers',
      allowedSigners
    )
    const signaturePath = await writePrivateTempFile(
      temporaryRoot,
      'signature.sshsig',
      signature
    )
    await runVerifier(allowedPath, signaturePath, identity, namespace, payload)
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true })
  }
}
