import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { classifyCommandFailure } from '../../commands/v1/commandSupport.js'
import { assertOperationalContributorEnrollment } from './contentCheck.js'
import { contributorsRegistrySchema } from './policySchemas.js'
import { parseSshEd25519PublicKey } from './sshsigVerifier.js'

const sshString = (value: Uint8Array): Buffer => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(value.byteLength)
  return Buffer.concat([length, value])
}

const createPublicKey = () => {
  const { publicKey } = generateKeyPairSync('ed25519')
  const subjectPublicKeyInfo = publicKey.export({
    format: 'der',
    type: 'spki'
  })
  const wire = Buffer.concat([
    sshString(Buffer.from('ssh-ed25519', 'ascii')),
    sshString(subjectPublicKeyInfo.subarray(-32))
  ])
  const canonical = `ssh-ed25519 ${wire.toString('base64')}`
  return {
    canonical,
    fingerprint: parseSshEd25519PublicKey(canonical).fingerprintSha256
  }
}

const authorKey = createPublicKey()
const reviewerKey = createPublicKey()

const contributor = ({
  contributorRef,
  roles,
  active,
  key
}: {
  readonly contributorRef: string
  readonly roles: readonly ('AUTHOR' | 'REVIEWER')[]
  readonly active: boolean
  readonly key: ReturnType<typeof createPublicKey>
}) => ({
  contributorRef,
  roles,
  active,
  sshPublicKey: key.canonical,
  sshKeyFingerprintSha256: key.fingerprint
})

const registry = (contributors: readonly ReturnType<typeof contributor>[]) =>
  contributorsRegistrySchema.parse({
    schemaVersion: 1,
    snapshotRevision: 1,
    contributors
  })

describe('Phase 6 Slice 1 operational contributor enrollment', () => {
  it.each([
    ['empty registry', []],
    [
      'author only',
      [
        contributor({
          contributorRef: 'fixture-author',
          roles: ['AUTHOR'],
          active: true,
          key: authorKey
        })
      ]
    ],
    [
      'reviewer only',
      [
        contributor({
          contributorRef: 'fixture-reviewer',
          roles: ['REVIEWER'],
          active: true,
          key: reviewerKey
        })
      ]
    ],
    [
      'one dual-role principal',
      [
        contributor({
          contributorRef: 'fixture-dual-role',
          roles: ['AUTHOR', 'REVIEWER'],
          active: true,
          key: authorKey
        })
      ]
    ],
    [
      'inactive reviewer',
      [
        contributor({
          contributorRef: 'fixture-author',
          roles: ['AUTHOR'],
          active: true,
          key: authorKey
        }),
        contributor({
          contributorRef: 'fixture-reviewer',
          roles: ['REVIEWER'],
          active: false,
          key: reviewerKey
        })
      ]
    ]
  ])('rejects %s', (_name, contributors) => {
    expect(() =>
      assertOperationalContributorEnrollment(registry(contributors))
    ).toThrow('CONTRIBUTOR_OPERATIONAL_ENROLLMENT_REQUIRED')
  })

  it('accepts distinct active author and reviewer principals and keys', () => {
    const contributors = registry([
      contributor({
        contributorRef: 'fixture-author',
        roles: ['AUTHOR'],
        active: true,
        key: authorKey
      }),
      contributor({
        contributorRef: 'fixture-reviewer',
        roles: ['REVIEWER'],
        active: true,
        key: reviewerKey
      })
    ])
    expect(() =>
      assertOperationalContributorEnrollment(contributors)
    ).not.toThrow()
  })

  it('rejects duplicate active contributor keys before enrollment gating', () => {
    expect(
      contributorsRegistrySchema.safeParse({
        schemaVersion: 1,
        snapshotRevision: 1,
        contributors: [
          contributor({
            contributorRef: 'fixture-author',
            roles: ['AUTHOR'],
            active: true,
            key: authorKey
          }),
          contributor({
            contributorRef: 'fixture-reviewer',
            roles: ['REVIEWER'],
            active: true,
            key: authorKey
          })
        ]
      }).success
    ).toBe(false)
  })

  it('maps incomplete enrollment to the closed artifact failure', () => {
    expect(
      classifyCommandFailure(
        new Error('CONTRIBUTOR_OPERATIONAL_ENROLLMENT_REQUIRED')
      )
    ).toEqual({ code: 'CONTENT_ARTIFACT_INVALID', exitCode: 2 })
  })
})
