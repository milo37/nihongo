import { describe, expect, it } from 'vitest'
import {
  CanonicalJsonError,
  canonicalizeJson
} from '../src/content/validators/v1/canonical-json.js'
import {
  INTERNAL_BETA_LEVEL_FLOORS,
  summarizeBundleCoverage
} from '../src/content/validators/v1/coverage.js'
import {
  canonicalDuplicateIdentity,
  inspectIntraBundleDuplicates,
  scoreNearDuplicate
} from '../src/content/validators/v1/duplicates.js'
import {
  isApplicableContentType,
  validateOriginalQuestionContent
} from '../src/content/validators/v1/question-content.js'
import {
  createContentBundleReleaseHashInput,
  createLegacySeedItemHashInput
} from '../src/content/validators/v1/release-hash.js'
import type { OriginalQuestionContentV1 } from '../src/content/validators/v1/types.js'
import {
  compareUnicodeScalars,
  normalizeDuplicateText,
  normalizeTagKey
} from '../src/content/validators/v1/unicode.js'

const createContent = (
  overrides: Partial<OriginalQuestionContentV1> = {}
): OriginalQuestionContentV1 => ({
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
  explanationKo: '문맥상 신문을 읽는다는 뜻이 자연스럽습니다.',
  explanationJa: null,
  tagKeys: ['문맥 어휘'],
  distractorRationalesKo: {
    '1': null,
    '2': '신문은 마시는 대상이 아닙니다.',
    '3': '신문을 달린다는 결합은 성립하지 않습니다.',
    '4': '신문을 잔다는 결합은 성립하지 않습니다.'
  },
  ...overrides
})

describe('Phase 6 content validator v1 domain', () => {
  it('serializes canonical JSON without numeric-key enumeration drift', () => {
    expect(canonicalizeJson({ '2': 2, '10': 10, a: true })).toBe(
      '{"10":10,"2":2,"a":true}'
    )

    const astral = '\u{1f600}'
    const bmp = '\ue000'
    expect(canonicalizeJson({ [bmp]: 1, [astral]: 2 })).toBe(
      `{"${astral}":2,"${bmp}":1}`
    )
    expect(compareUnicodeScalars(bmp, astral)).toBeLessThan(0)
  })

  it('rejects unsafe canonical JSON inputs', () => {
    expect(() => canonicalizeJson(-0)).toThrowError(CanonicalJsonError)
    expect(() => canonicalizeJson(1.5)).toThrowError(CanonicalJsonError)
    expect(() => canonicalizeJson('\ud800')).toThrowError(CanonicalJsonError)
    const sparse: string[] = ['a']
    sparse[2] = 'b'
    expect(() => canonicalizeJson(sparse)).toThrowError(CanonicalJsonError)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalizeJson(cyclic)).toThrowError(CanonicalJsonError)
  })

  it('normalizes tags and duplicate text by the frozen pipelines', () => {
    expect(normalizeTagKey(' Ａ  B\tC ')).toBe('a b c')
    expect(normalizeDuplicateText(' 例\n  TEST ')).toBe('例 test')
  })

  it('enforces question type, passage, option and rationale semantics', () => {
    expect(validateOriginalQuestionContent(createContent())).toEqual([])
    expect(
      validateOriginalQuestionContent(
        createContent({
          subject: 'READING',
          questionType: 'LONG_READING',
          passage: null,
          options: [
            { key: '1', text: '同じ' },
            { key: '2', text: '同じ' },
            { key: '3', text: '三' },
            { key: '4', text: '四' }
          ],
          distractorRationalesKo: {
            '1': '정답 rationale가 있으면 안 됩니다.',
            '2': null,
            '3': '오답입니다.',
            '4': '오답입니다.'
          }
        })
      ).map(({ ruleCode }) => ruleCode)
    ).toEqual(
      expect.arrayContaining([
        'CONTENT_OPTION_UNIQUE',
        'CONTENT_PASSAGE_MATRIX',
        'CONTENT_RATIONALE_MATRIX'
      ])
    )
    expect(isApplicableContentType('N5', 'READING', 'LONG_READING')).toBe(false)
    expect(isApplicableContentType('N2', 'READING', 'LONG_READING')).toBe(true)
  })

  it('detects exact and symmetric near duplicate bundle pairs', () => {
    const left = createContent()
    const exact = createContent({ difficulty: 'HARD', tagKeys: ['다른 태그'] })
    expect(canonicalDuplicateIdentity(left)).toBe(
      canonicalDuplicateIdentity(exact)
    )
    expect(
      inspectIntraBundleDuplicates([
        { contentKey: 'item-a', content: left },
        { contentKey: 'item-b', content: exact }
      ]).exactPairs
    ).toEqual([{ leftContentKey: 'item-a', rightContentKey: 'item-b' }])

    const near = createContent({
      options: [
        { key: '1', text: '読みます' },
        { key: '2', text: '見ます' },
        { key: '3', text: '走ります' },
        { key: '4', text: '寝ます' }
      ]
    })
    expect(
      scoreNearDuplicate(left, near).some(({ matchesThreshold }) =>
        Boolean(matchesThreshold)
      )
    ).toBe(true)
  })

  it('builds the closed 400-item floor and stable bundle distribution', () => {
    expect(
      INTERNAL_BETA_LEVEL_FLOORS.reduce((total, { count }) => total + count, 0)
    ).toBe(400)
    const summary = summarizeBundleCoverage([{ content: createContent() }])
    expect(summary.itemCount).toBe(1)
    expect(
      summary.byLevelSubject.find(
        ({ level, subject }) => level === 'N5' && subject === 'VOCABULARY'
      )?.count
    ).toBe(1)
    expect(summary.byLevelSubjectType).toHaveLength(5 * 3 * 12)
  })

  it('projects release hash inputs without runtime discriminator overrides', () => {
    const digest = '0'.repeat(64)
    const projected = createContentBundleReleaseHashInput({
      releaseKey: 'fixture-release',
      releaseRevision: 1,
      bundleSha256: digest,
      certificateSha256: digest,
      duplicateReviewPlanSha256: digest,
      reviewEvidenceSha256: digest,
      authorSignatureSha256: digest,
      reviewerSignatureSha256: digest,
      approvalReceiptSha256: digest,
      approvalOwnerSignatureSha256: digest,
      policyActivationRevision: 1,
      policyActivationSha256: digest,
      policyActivationOwnerSignatureSha256: digest,
      policySnapshotSha256: digest,
      policyOwnerSignatureSha256: digest,
      schemaVersion: 9,
      artifactKind: 'OVERRIDE',
      extra: true
    } as unknown as Parameters<typeof createContentBundleReleaseHashInput>[0])
    expect(projected.schemaVersion).toBe(1)
    expect(projected.artifactKind).toBe('CONTENT_BUNDLE_V1')
    expect(Object.keys(projected)).not.toContain('extra')
    expect(
      createLegacySeedItemHashInput({
        contentKey: 'n5-vocabulary-01',
        semanticContentSha256: digest,
        globalReviewSha256: digest
      })
    ).toEqual({
      kind: 'LEGACY_SEED_ITEM_V1',
      contentKey: 'n5-vocabulary-01',
      semanticContentSha256: digest,
      globalReviewSha256: digest
    })
  })
})
