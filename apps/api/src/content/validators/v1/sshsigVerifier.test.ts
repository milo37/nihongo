import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJsonBytes, canonicalJsonSha256 } from './canonicalHash.js'
import {
  policyActivationOwnerSignaturePayloadSchema,
  policyActivationSchema
} from './policySchemas.js'
import { verifyPolicyActivationChain } from './policyVerifier.js'
import {
  parseSshEd25519PublicKey,
  parseSshEd25519PublicKeyFile,
  verifySshSignature
} from './sshsigVerifier.js'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

const createTestKey = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nihongo-sshsig-test-'))
  temporaryRoots.push(root)
  await chmod(root, 0o700)
  const keyPath = path.join(root, 'test-ed25519')
  await execFileAsync('/usr/bin/ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-C',
    '',
    '-f',
    keyPath
  ])
  const publicKey = (await readFile(`${keyPath}.pub`, 'utf8')).trimEnd()
  return {
    root,
    keyPath,
    publicKey,
    parsed: parseSshEd25519PublicKey(publicKey)
  }
}

const signPayload = async (
  root: string,
  keyPath: string,
  namespace: string,
  name: string,
  payload: Uint8Array
): Promise<Buffer> => {
  const payloadPath = path.join(root, name)
  await writeFile(payloadPath, payload, { mode: 0o600 })
  await execFileAsync('/usr/bin/ssh-keygen', [
    '-q',
    '-Y',
    'sign',
    '-f',
    keyPath,
    '-n',
    namespace,
    payloadPath
  ])
  return readFile(`${payloadPath}.sig`)
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  )
})

describe('SSHSIG and activation chain v1', () => {
  it('parses the approved owner root bytes and fingerprint exactly', () => {
    const canonical =
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKUPw5xE5o+xTIheCWSpLztfuBzpgSp5CMpvvARb8uxw'
    const parsed = parseSshEd25519PublicKeyFile(
      Buffer.from(`${canonical}\n`, 'utf8')
    )
    expect(parsed.canonical).toBe(canonical)
    expect(parsed.fingerprintSha256).toBe(
      'c6f8c53384aa90de0ef57edac3398cea16f1ff48aec492b7b1df742cfbeb3467'
    )
    expect(() =>
      parseSshEd25519PublicKeyFile(Buffer.from(`${canonical} \n`, 'utf8'))
    ).toThrow()
    expect(() => parseSshEd25519PublicKey(`${canonical} comment`)).toThrow()
  })

  it('verifies ephemeral signatures only for the exact payload, identity and namespace', async () => {
    const key = await createTestKey()
    const payload = Buffer.from('{"schemaVersion":1}', 'utf8')
    const signature = await signPayload(
      key.root,
      key.keyPath,
      'nihongo-content-v1',
      'payload.json',
      payload
    )
    const input = {
      payload,
      signature,
      publicKey: key.publicKey,
      expectedFingerprintSha256: key.parsed.fingerprintSha256,
      identity: 'test-author',
      namespace: 'nihongo-content-v1' as const
    }
    await expect(verifySshSignature(input)).resolves.toBeUndefined()
    await expect(
      verifySshSignature({ ...input, payload: Buffer.from('changed') })
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' })
    await expect(
      verifySshSignature({
        ...input,
        namespace: 'nihongo-policy-v1'
      })
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' })
    await expect(
      verifySshSignature({
        ...input,
        expectedFingerprintSha256: '0'.repeat(64)
      })
    ).rejects.toMatchObject({ code: 'PUBLIC_KEY_INVALID' })
    await expect(
      verifySshSignature({
        ...input,
        payload: Buffer.alloc(64 * 1024 + 1)
      })
    ).rejects.toMatchObject({ code: 'SIGNATURE_OVERSIZED' })
  })

  it('verifies an append-only two-revision owner activation chain', async () => {
    const key = await createTestKey()
    const rootFingerprint = key.parsed.fingerprintSha256
    const createActivation = async (
      revision: number,
      activatedAt: string,
      previousActivationSha256: string | null
    ) => {
      const base = {
        schemaVersion: 1 as const,
        activationRevision: revision,
        policySnapshotSha256: String(revision).repeat(64),
        activatedAt,
        previousActivationSha256,
        rootEpoch: 1
      }
      const activation = policyActivationSchema.parse({
        ...base,
        activationSha256: canonicalJsonSha256(base)
      })
      const signaturePayload =
        policyActivationOwnerSignaturePayloadSchema.parse({
          schemaVersion: 1,
          role: 'POLICY_ACTIVATOR',
          activationSha256: activation.activationSha256,
          rootKeyFingerprintSha256: rootFingerprint
        })
      const signature = await signPayload(
        key.root,
        key.keyPath,
        'nihongo-policy-activation-v1',
        `activation-${revision}.json`,
        canonicalJsonBytes(signaturePayload)
      )
      return { activation, signature }
    }
    const first = await createActivation(1, '2026-08-25T00:00:00.000Z', null)
    const second = await createActivation(
      2,
      '2026-08-25T00:00:01.000Z',
      first.activation.activationSha256
    )
    await expect(
      verifyPolicyActivationChain({
        entries: [first, second],
        conveniencePointer: second.activation,
        ownerPublicKey: key.publicKey,
        expectedRootFingerprintSha256: rootFingerprint,
        expectedTerminalRevision: 2,
        expectedTerminalActivationSha256: second.activation.activationSha256
      })
    ).resolves.toMatchObject({ terminal: second.activation })
    await expect(
      verifyPolicyActivationChain({
        entries: [second, first],
        conveniencePointer: first.activation,
        ownerPublicKey: key.publicKey,
        expectedRootFingerprintSha256: rootFingerprint,
        expectedTerminalRevision: 2,
        expectedTerminalActivationSha256: second.activation.activationSha256
      })
    ).rejects.toMatchObject({ code: 'POLICY_ACTIVATION_INVALID' })
  })
})
