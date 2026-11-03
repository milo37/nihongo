import { toOptimisticBookmark } from '@app/bookmark/toOptimisticBookmark'
import type { OptimisticBookmarkSource } from '@app/bookmark/toOptimisticBookmark'

const source = (
  overrides: Partial<OptimisticBookmarkSource> = {}
): OptimisticBookmarkSource => ({
  id: 'question-1',
  questionVersionId: 'version-1',
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  difficulty: 'EASY',
  questionText: '日本語',
  tagSummaries: [{ id: 'tag-1', label: '漢字' }],
  ...overrides
})

describe('toOptimisticBookmark', () => {
  it('builds an available row from the pinned question version', () => {
    expect(toOptimisticBookmark(source())).toMatchObject({
      questionId: 'question-1',
      availability: 'AVAILABLE',
      question: {
        id: 'question-1',
        questionVersionId: 'version-1',
        questionTextPreview: '日本語',
        tags: [{ id: 'tag-1', label: '漢字' }]
      }
    })
  })

  it('cuts previews longer than 160 characters to 157 plus an ellipsis', () => {
    const exact = '字'.repeat(160)
    expect(
      toOptimisticBookmark(source({ questionText: exact }))?.question
        .questionTextPreview
    ).toBe(exact)
    const preview = toOptimisticBookmark(
      source({ questionText: '字'.repeat(161) })
    )?.question.questionTextPreview
    expect(preview).toBe(`${'字'.repeat(157)}...`)
  })

  it.each([
    ['questionVersionId', { questionVersionId: null }],
    ['tagSummaries', { tagSummaries: null }]
  ] as const)('returns nothing without %s', (_field, overrides) => {
    expect(toOptimisticBookmark(source(overrides))).toBeUndefined()
  })
})
