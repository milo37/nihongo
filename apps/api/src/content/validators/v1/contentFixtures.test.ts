import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readArtifactBytes, readArtifactJson } from './artifactReader.js'
import { BundleValidationError, validateBundle } from './bundleValidator.js'
import { contentBundleSchema, tagTaxonomySchema } from './contentSchemas.js'
import type { VerifiedPolicySnapshotV1 } from './policyVerifier.js'
import { parseStrictJsonBytes, StrictJsonError } from './strictJson.js'

const POLICY_SHA256 = '0'.repeat(64)

const repositoryRoot = await realpath(
  fileURLToPath(new URL('../../../../../../', import.meta.url))
)

const readFixture = (filePath: string): Promise<unknown> =>
  readArtifactJson({
    repositoryRoot,
    filePath,
    maximumBytes: 1024 * 1024
  })

const createFixturePolicy = async (): Promise<VerifiedPolicySnapshotV1> => {
  const taxonomy = tagTaxonomySchema.parse(
    await readFixture('content/taxonomy/tags.v1.json')
  )
  return {
    policySnapshotSha256: POLICY_SHA256,
    taxonomy
  } as unknown as VerifiedPolicySnapshotV1
}

describe('Phase 6 Slice 1 tracked content fixtures', () => {
  it('validates the original N5 bundle through the executable validator', async () => {
    const bundle = await readFixture(
      'content/fixtures/valid/original-n5-context-bundle.v1.json'
    )
    const validated = validateBundle({
      bundle,
      policy: await createFixturePolicy(),
      now: new Date('2026-08-25T00:00:00.000Z')
    })

    expect(validated.canonicalBundle.items).toHaveLength(1)
    expect(validated.items[0]?.contentKey).toBe('original.n5.context.001')
    expect(validated.duplicateWarnings).toEqual([])
    expect(validated.coverage.itemCount).toBe(1)
  })

  it('rejects a schema-valid envelope with invalid question semantics', async () => {
    const bundle = await readFixture(
      'content/fixtures/invalid/semantic-matrix-bundle.v1.json'
    )
    const result = contentBundleSchema.safeParse(bundle)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        'CONTENT_OPTION_UNIQUE',
        'CONTENT_PASSAGE_MATRIX',
        'CONTENT_RATIONALE_MATRIX',
        'CONTENT_TYPE_MATRIX'
      ])
    )
  })

  it('rejects duplicate decoded JSON keys before Zod validation', async () => {
    const bytes = await readArtifactBytes({
      repositoryRoot,
      filePath: 'content/fixtures/invalid/duplicate-key.json',
      maximumBytes: 1024
    })

    expect(() => parseStrictJsonBytes(bytes)).toThrowError(StrictJsonError)
  })

  it('hard-fails unrelated exact duplicate items', async () => {
    const fixture = contentBundleSchema.parse(
      await readFixture(
        'content/fixtures/valid/original-n5-context-bundle.v1.json'
      )
    )
    const firstItem = fixture.items[0]
    expect(firstItem).toBeDefined()
    if (firstItem === undefined) return
    const duplicateBundle = {
      ...fixture,
      items: [
        firstItem,
        {
          ...firstItem,
          contentKey: 'original.n5.context.002',
          content: {
            ...firstItem.content,
            difficulty: 'HARD' as const
          }
        }
      ]
    }

    try {
      validateBundle({
        bundle: duplicateBundle,
        policy: await createFixturePolicy(),
        now: new Date('2026-08-25T00:00:00.000Z')
      })
      expect.unreachable('exact duplicate bundle must fail')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BundleValidationError)
      expect((error as BundleValidationError).code).toBe(
        'BUNDLE_EXACT_DUPLICATE'
      )
    }
  })

  it('rejects unknown tags, restricted metadata and future timestamps', async () => {
    const fixture = contentBundleSchema.parse(
      await readFixture(
        'content/fixtures/valid/original-n5-context-bundle.v1.json'
      )
    )
    const firstItem = fixture.items[0]
    expect(firstItem).toBeDefined()
    if (firstItem === undefined) return
    const policy = await createFixturePolicy()

    for (const [bundle, code] of [
      [
        {
          ...fixture,
          items: [
            {
              ...firstItem,
              content: { ...firstItem.content, tagKeys: ['미등록'] }
            }
          ]
        },
        'BUNDLE_TAG_UNKNOWN'
      ],
      [
        { ...fixture, title: 'https://invalid.example 검증 묶음' },
        'BUNDLE_METADATA_RESTRICTED'
      ]
    ] as const) {
      expect(() =>
        validateBundle({
          bundle,
          policy,
          now: new Date('2026-08-25T00:00:00.000Z')
        })
      ).toThrowError(expect.objectContaining({ code }))
    }

    expect(() =>
      validateBundle({
        bundle: fixture,
        policy,
        now: new Date('2026-08-24T23:54:59.999Z')
      })
    ).toThrowError(
      expect.objectContaining({ code: 'BUNDLE_CREATED_AT_FUTURE' })
    )
  })

  it('emits stable directed warnings for a schema-valid near duplicate', async () => {
    const fixture = contentBundleSchema.parse(
      await readFixture(
        'content/fixtures/valid/original-n5-context-bundle.v1.json'
      )
    )
    const firstItem = fixture.items[0]
    expect(firstItem).toBeDefined()
    if (firstItem === undefined) return
    const secondItem = {
      ...firstItem,
      contentKey: 'original.n5.context.002',
      content: {
        ...firstItem.content,
        options: [
          firstItem.content.options[0],
          { key: '2' as const, text: '見ます' },
          firstItem.content.options[2],
          firstItem.content.options[3]
        ]
      }
    }
    const validated = validateBundle({
      bundle: { ...fixture, items: [firstItem, secondItem] },
      policy: await createFixturePolicy(),
      now: new Date('2026-08-25T00:00:00.000Z')
    })

    expect(validated.duplicateWarnings).toHaveLength(4)
    expect(
      validated.duplicateWarnings.map(
        ({ candidateContentKey, contentKey, score }) => ({
          candidateContentKey,
          contentKey,
          ruleId: score.ruleId
        })
      )
    ).toEqual([
      {
        candidateContentKey: 'original.n5.context.002',
        contentKey: 'original.n5.context.001',
        ruleId: 'QUESTION_PASSAGE_TRIGRAM_V1'
      },
      {
        candidateContentKey: 'original.n5.context.002',
        contentKey: 'original.n5.context.001',
        ruleId: 'QUESTION_TEXT_EDIT_V1'
      },
      {
        candidateContentKey: 'original.n5.context.001',
        contentKey: 'original.n5.context.002',
        ruleId: 'QUESTION_PASSAGE_TRIGRAM_V1'
      },
      {
        candidateContentKey: 'original.n5.context.001',
        contentKey: 'original.n5.context.002',
        ruleId: 'QUESTION_TEXT_EDIT_V1'
      }
    ])
  })
})
