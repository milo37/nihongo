import { describe, expect, it } from 'vitest'
import { projectCatalogAndDuplicateCorpus } from './catalogProjector.js'

const semantic = {
  level: 'N5' as const,
  subject: 'VOCABULARY' as const,
  questionType: 'CONTEXT_VOCABULARY' as const,
  difficulty: 'NORMAL' as const,
  passage: null,
  questionText: '朝、駅で新聞を（　）。',
  options: [
    { key: '1' as const, text: '読みます' },
    { key: '2' as const, text: '飲みます' },
    { key: '3' as const, text: '走ります' },
    { key: '4' as const, text: '寝ます' }
  ] as const,
  correctOptionKey: '1' as const,
  explanationKo: '문맥상 신문을 읽는다는 뜻이 자연스럽습니다.',
  explanationJa: null,
  tagKeys: ['vocabulary.context']
}

describe('catalogProjector v1', () => {
  it('creates stable catalog and corpus digests independent of input order', () => {
    const input = {
      questions: [
        {
          contentKey: 'item-b',
          lifecycleStatus: 'ARCHIVED' as const,
          currentPublishedVersionNumber: null
        },
        {
          contentKey: 'item-a',
          lifecycleStatus: 'ACTIVE' as const,
          currentPublishedVersionNumber: 2
        }
      ],
      versions: [
        {
          contentKey: 'item-a',
          lifecycleStatus: 'ACTIVE' as const,
          versionNumber: 2,
          versionStatus: 'PUBLISHED' as const,
          content: semantic
        },
        {
          contentKey: 'item-a',
          lifecycleStatus: 'ACTIVE' as const,
          versionNumber: 1,
          versionStatus: 'RETIRED' as const,
          content: { ...semantic, questionText: '朝、新聞を（　）。' }
        }
      ]
    }
    const projected = projectCatalogAndDuplicateCorpus(input)
    const reordered = projectCatalogAndDuplicateCorpus({
      questions: input.questions.toReversed(),
      versions: input.versions.toReversed()
    })
    expect(projected).toEqual(reordered)
    expect(
      projected.catalog.questions.map(({ contentKey }) => contentKey)
    ).toEqual(['item-a', 'item-b'])
    expect(projected.duplicateCorpusEvidence.versions).toHaveLength(2)
    expect(projected.catalogSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(projected.duplicateCorpusSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    {
      label: 'DRAFT version',
      questions: [
        {
          contentKey: 'item-a',
          lifecycleStatus: 'ACTIVE' as const,
          currentPublishedVersionNumber: null
        }
      ],
      versions: [
        {
          contentKey: 'item-a',
          lifecycleStatus: 'ACTIVE' as const,
          versionNumber: 1,
          versionStatus: 'DRAFT' as const,
          content: semantic
        }
      ]
    },
    {
      label: 'missing current version',
      questions: [
        {
          contentKey: 'item-a',
          lifecycleStatus: 'ACTIVE' as const,
          currentPublishedVersionNumber: 2
        }
      ],
      versions: []
    }
  ])('fails closed for $label', (input) => {
    expect(() => projectCatalogAndDuplicateCorpus(input)).toThrow()
  })
})
