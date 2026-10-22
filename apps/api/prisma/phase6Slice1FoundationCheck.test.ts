import { lstat, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { tagTaxonomySchema } from '../src/content/validators/v1/contentSchemas.js'
import { readArtifactJson } from '../src/content/validators/v1/artifactReader.js'
import { projectCanonicalLegacySeedArtifacts } from './phase6Slice1LegacyProjection.js'
import { buildAllQuestionSeeds } from './seedQuestionCatalog.js'
import {
  assertFoundationSourceManifestSha256,
  calculateApiPublicProjectionSha256,
  FOUNDATION_INPUT_PATHS_V1,
  FOUNDATION_PUBLIC_PROJECTION_SHA256,
  inspectFoundationCatalog,
  runPhase6Slice1FoundationCheck
} from './phase6Slice1FoundationCheck.js'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))

const snapshotContentTree = async (): Promise<ReadonlyMap<string, string>> => {
  const snapshot = new Map<string, string>()
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        continue
      }
      const stat = await lstat(entryPath, { bigint: true })
      snapshot.set(
        path.relative(repositoryRoot, entryPath),
        `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
      )
    }
  }
  await visit(path.join(repositoryRoot, 'content'))
  return snapshot
}

const loadCatalog = async () => {
  const [projection, taxonomyValue] = await Promise.all([
    projectCanonicalLegacySeedArtifacts(repositoryRoot),
    readArtifactJson({
      repositoryRoot,
      filePath: 'content/taxonomy/tags.v1.json',
      maximumBytes: 5 * 1024 * 1024
    })
  ])
  return {
    items: [...projection.semanticByContentKey].map(
      ([contentKey, content]) => ({ contentKey, content })
    ),
    taxonomy: tagTaxonomySchema.parse(taxonomyValue)
  }
}

describe('Phase 6 Slice 1 contributor-free foundation check', () => {
  it('validates the current 65-item foundation without writing artifacts', async () => {
    const before = await snapshotContentTree()
    const result = await runPhase6Slice1FoundationCheck(repositoryRoot)
    const after = await snapshotContentTree()

    expect(result).toMatchObject({
      schemaVersion: 1,
      command: 'content:foundation-check',
      status: 'PASS',
      questionCount: 65,
      contributorCount: 0,
      apiWebPublicProjectionSha256: FOUNDATION_PUBLIC_PROJECTION_SHA256,
      catalog: {
        optionCount: 260,
        passageCount: 15,
        tagReferenceCount: 130,
        taxonomyTagCount: 108,
        sentenceOrderCount: 0,
        coverage: {
          applicableCellCount: 53,
          zeroApplicableCellCount: 7
        },
        duplicates: {
          exactPairCount: 0,
          directedWarningCount: 2,
          undirectedPairCount: 1
        }
      }
    })
    expect(after).toEqual(before)
  })

  it('keeps v1.1 policy, activation, signature and 400-target inputs dormant', () => {
    expect(FOUNDATION_INPUT_PATHS_V1).not.toContain(
      'content/coverage/internal-beta.v1.json'
    )
    expect(
      FOUNDATION_INPUT_PATHS_V1.some(
        (value) =>
          value.includes('policy-snapshots') ||
          value.includes('activation') ||
          value.includes('sshsig') ||
          value.includes('policy-owner-root')
      )
    ).toBe(false)
  })

  it('pins the API public projection independently from the Web catalog', () => {
    expect(calculateApiPublicProjectionSha256()).toBe(
      FOUNDATION_PUBLIC_PROJECTION_SHA256
    )
    const seeds = buildAllQuestionSeeds()
    const first = seeds[0]
    if (!first) throw new Error('FOUNDATION_SEED_FIXTURE_MISSING')
    expect(
      calculateApiPublicProjectionSha256([
        { ...first, questionText: `${first.questionText} drift` },
        ...seeds.slice(1)
      ])
    ).not.toBe(FOUNDATION_PUBLIC_PROJECTION_SHA256)
  })

  it('fails an unreviewed foundation source-manifest drift', () => {
    expect(() =>
      assertFoundationSourceManifestSha256('0'.repeat(64), '1'.repeat(64))
    ).toThrow('FOUNDATION_SOURCE_MANIFEST_DRIFT')
  })

  it('hard-fails an exact duplicate while retaining the current near warning', async () => {
    const { items, taxonomy } = await loadCatalog()
    const diagnostics = inspectFoundationCatalog(items, taxonomy)
    expect(diagnostics.duplicates.directedWarningCount).toBe(2)

    const [first, second, ...rest] = items
    if (!first || !second) throw new Error('FOUNDATION_SEED_FIXTURE_MISSING')
    const exactDuplicate = {
      ...second.content,
      subject: first.content.subject,
      questionType: first.content.questionType,
      passage: first.content.passage,
      questionText: first.content.questionText,
      options: first.content.options,
      correctOptionKey: first.content.correctOptionKey
    }
    expect(() =>
      inspectFoundationCatalog(
        [first, { ...second, content: exactDuplicate }, ...rest],
        taxonomy
      )
    ).toThrow('FOUNDATION_EXACT_DUPLICATE')
  })

  it('fails when the tracked taxonomy no longer covers the seed catalog', async () => {
    const { items, taxonomy } = await loadCatalog()
    expect(() =>
      inspectFoundationCatalog(items, {
        ...taxonomy,
        tags: taxonomy.tags.slice(1)
      } as typeof taxonomy)
    ).toThrow()
  })
})
