import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ContentBundleItemV1,
  ContentBundleV1
} from '@nihongo/domain/content/validators/v1/types'
import { LEGACY_SEED_SOURCE_PATHS } from '../../validators/v1/legacySchemas.js'
import {
  ContentAnalysisError,
  MAX_ANALYSIS_INPUT_BYTES,
  resolveRepositoryRoot
} from './commandSupport.js'
import { runContentAnalysis } from './commands.js'

const roots: string[] = []
const temporaryRoot = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jlp524-content-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

const item = (contentKey = 'fixture-a'): ContentBundleItemV1 => ({
  contentKey,
  intent: {
    kind: 'CREATE',
    expectedCurrentVersionNumber: null,
    expectedCurrentSemanticContentSha256: null
  },
  content: {
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'CONTEXT_VOCABULARY',
    difficulty: 'NORMAL',
    passage: null,
    questionText: '朝、駅で新聞を（　）。',
    options: [
      { key: '1', text: '読みます' },
      { key: '2', text: '飲みます' },
      { key: '3', text: '走ります' },
      { key: '4', text: '寝ます' }
    ],
    correctOptionKey: '1',
    explanationKo: '문맥상 신문을 읽는다는 뜻입니다.',
    explanationJa: null,
    tagKeys: ['문맥 어휘'],
    distractorRationalesKo: {
      '1': null,
      '2': '신문은 마시는 대상이 아닙니다.',
      '3': '신문을 달린다는 뜻이 아닙니다.',
      '4': '신문을 잔다는 뜻이 아닙니다.'
    }
  },
  provenance: {
    sourceType: 'ORIGINAL',
    authorRef: 'fixture-author',
    creationMethod: 'HUMAN',
    rightsAttestation: 'ORIGINAL_NO_COPY',
    authoredAt: '2026-01-01T00:00:00.000Z',
    sourceNote: 'Synthetic fixture only; no operational author claim.'
  }
})
const bundle = (
  items: readonly ContentBundleItemV1[] = [item()]
): ContentBundleV1 => ({
  schemaVersion: 1,
  releaseKey: 'fixture-release',
  releaseRevision: 1,
  title: 'Synthetic passive fixture',
  createdAt: '2026-01-02T00:00:00.000Z',
  policyVersion: 'original-content-v1',
  taxonomyVersion: 'tags-v1',
  reviewRubricVersion: 'review-rubric-v1',
  policySnapshotSha256: 'a'.repeat(64),
  items
})
const fixture = async (value: unknown) => {
  const root = await temporaryRoot()
  await writeFile(path.join(root, 'bundle.json'), JSON.stringify(value))
  return root
}
const canonicalCopy = async () => {
  const root = await temporaryRoot()
  const source = await resolveRepositoryRoot()
  const files = [
    ...LEGACY_SEED_SOURCE_PATHS,
    'content/legacy/legacy-seed-source-manifest.v1.json',
    'content/legacy/legacy-seed-mapping-manifest.v1.json',
    'content/releases/legacy-system-seed-v1/1/legacy-seed-manifest.json',
    'content/taxonomy/tags.v1.json'
  ]
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await copyFile(path.join(source, file), path.join(root, file))
  }
  return root
}

describe('passive content support4', () => {
  it.each(['check', 'validate', 'coverage'] as const)(
    'analyzes actual frozen373 sources with scoped tags: %s',
    async (command) => {
      const result = await runContentAnalysis(command, [])
      expect(result).toMatchObject({
        mode: 'PASSIVE_ANALYSIS',
        command: `content:${command}`,
        status: 'ANALYZED',
        scope: 'CURRENT_APPROVED_SOURCES',
        itemCount: 373,
        trustVerified: false,
        fullTaxonomyApplicabilityVerified: false,
        inventory: {
          foundationQuestionCount: 65,
          approvedQuestionCount: 308,
          foundationTaxonomyTagCount: 107,
          approvedRequiredTagNameCount: 388,
          approvedRequiredTagTupleCount: 437
        }
      })
      expect(result.inputSha256).toMatch(/^[a-f0-9]{64}$/u)
      if ('coverage' in result) {
        expect(result.coverage.itemCount).toBe(373)
        expect(
          result.coverage.byLevelSubject.reduce(
            (sum, row) => sum + row.count,
            0
          )
        ).toBe(373)
        expect(
          result.coverage.byLevelSubjectType.reduce(
            (sum, row) => sum + row.count,
            0
          )
        ).toBe(373)
      }
    }
  )

  it('analyzes whole source duplicate candidates with bounded output', async () => {
    const result = await runContentAnalysis('duplicates', [])
    expect(result.itemCount).toBe(373)
    if (!('duplicateAnalysis' in result))
      throw new Error('Expected candidate analysis')
    expect(result.duplicateAnalysis.reportedCandidateCount).toBeLessThanOrEqual(
      100
    )
    expect(result.duplicateAnalysis.exactPairCount).toBe(0)
    expect(JSON.stringify(result)).not.toContain('sourceFile')
  }, 45000)

  it.each(['--policy-snapshot', '--author-signature', '--target', '--unknown'])(
    'rejects excluded or unknown input flag %s',
    async (flag) => {
      await expect(
        runContentAnalysis('validate', [flag, 'secret'], '/unused')
      ).rejects.toBeInstanceOf(ContentAnalysisError)
    }
  )
  it.each([
    ['--bundle'],
    ['--bundle', '--bundle'],
    ['--bundle', ''],
    ['--bundle', 'a', '--bundle', 'b'],
    ['--bundle', 'a\nb']
  ])('rejects malformed argv %j', async (...args) => {
    await expect(
      runContentAnalysis('validate', args, '/unused')
    ).rejects.toBeInstanceOf(ContentAnalysisError)
  })
  it('keeps check limited to its canonical source inputs', async () => {
    await expect(
      runContentAnalysis('check', ['--bundle', 'bundle.json'], '/unused')
    ).rejects.toBeInstanceOf(ContentAnalysisError)
  })

  it('validates a strict bundle structurally without claiming author trust or exposing content', async () => {
    const value = bundle()
    const root = await fixture(value)
    const result = await runContentAnalysis(
      'validate',
      ['--bundle', 'bundle.json'],
      root
    )
    expect(result).toMatchObject({
      scope: 'BUNDLE_ONLY',
      itemCount: 1,
      inventory: null,
      structurallyValid: true,
      trustVerified: false
    })
    const text = JSON.stringify(result)
    expect(text).not.toContain(value.items[0]?.content.questionText)
    expect(text).not.toContain('fixture-author')
    expect(text).not.toContain(root)
  })

  it('reports exact and near candidates deterministically without a zero-warning gate', async () => {
    const exact = item('fixture-b')
    const near = item('fixture-c')
    const nearItem = {
      ...near,
      content: {
        ...near.content,
        options: [
          near.content.options[0],
          { key: '2' as const, text: '見ます' },
          near.content.options[2],
          near.content.options[3]
        ] as const
      }
    }
    const root = await fixture(bundle([nearItem, exact, item()]))
    const first = await runContentAnalysis(
      'duplicates',
      ['--bundle', 'bundle.json'],
      root
    )
    const second = await runContentAnalysis(
      'duplicates',
      ['--bundle', 'bundle.json'],
      root
    )
    expect(second).toEqual(first)
    if (!('duplicateAnalysis' in first))
      throw new Error('Expected duplicate analysis')
    expect(first.duplicateAnalysis.exactPairCount).toBe(1)
    expect(first.duplicateAnalysis.nearCandidateCount).toBeGreaterThan(0)
    expect(first.duplicateAnalysis.candidates[0]).toMatchObject({
      leftContentKey: 'fixture-a',
      rightContentKey: 'fixture-b',
      kind: 'EXACT'
    })
  })

  it('caps candidate rows while preserving total counts', async () => {
    const root = await fixture(
      bundle(
        Array.from({ length: 25 }, (_, index) =>
          item(`fixture-${String(index).padStart(2, '0')}`)
        )
      )
    )
    const result = await runContentAnalysis(
      'duplicates',
      ['--bundle', 'bundle.json'],
      root
    )
    if (!('duplicateAnalysis' in result))
      throw new Error('Expected duplicate analysis')
    expect(result.duplicateAnalysis).toMatchObject({
      exactPairCount: 300,
      nearCandidateCount: 0,
      reportedCandidateCount: 100,
      truncated: true
    })
  })

  it.each(['duplicate-key', 'too-many', 'semantic', 'duplicate-id'] as const)(
    'rejects invalid bundle %s',
    async (kind) => {
      const root = await temporaryRoot()
      const value =
        kind === 'too-many'
          ? bundle(
              Array.from({ length: 26 }, (_, index) => item(`fixture-${index}`))
            )
          : kind === 'duplicate-id'
            ? bundle([item(), item()])
            : bundle()
      let text = JSON.stringify(value)
      if (kind === 'duplicate-key')
        text = text.replace(
          '"schemaVersion":1',
          '"schemaVersion":1,"schemaVersion":1'
        )
      if (kind === 'semantic')
        text = text.replace('"correctOptionKey":"1"', '"correctOptionKey":"5"')
      await writeFile(path.join(root, 'bundle.json'), text)
      await expect(
        runContentAnalysis('validate', ['--bundle', 'bundle.json'], root)
      ).rejects.toThrow()
    }
  )

  it('refuses outside-root, symlink, oversized and non-regular input', async () => {
    const root = await fixture(bundle())
    const outside = await fixture(bundle())
    await symlink(
      path.join(outside, 'bundle.json'),
      path.join(root, 'link.json')
    )
    await writeFile(
      path.join(root, 'large.json'),
      Buffer.alloc(MAX_ANALYSIS_INPUT_BYTES + 1)
    )
    for (const file of [
      path.join(outside, 'bundle.json'),
      'link.json',
      'large.json',
      '.'
    ]) {
      await expect(
        runContentAnalysis('validate', ['--bundle', file], root)
      ).rejects.toThrow()
    }
  })

  it('rejects canonical source-byte drift without changing original inputs', async () => {
    const root = await canonicalCopy()
    const file = path.join(root, LEGACY_SEED_SOURCE_PATHS[0])
    await writeFile(
      file,
      Buffer.concat([await readFile(file), Buffer.from('\n')])
    )
    await expect(runContentAnalysis('check', [], root)).rejects.toThrow()
  })
})
