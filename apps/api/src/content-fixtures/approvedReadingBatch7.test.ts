import { describe, expect, it } from 'vitest'
import { originalQuestionSeeds } from '../../prisma/seed-data/questions/index.js'
import { approvedReadingBatch1 } from './approvedReadingBatch1.js'
import { approvedReadingBatch2 } from './approvedReadingBatch2.js'
import { approvedReadingBatch3 } from './approvedReadingBatch3.js'
import { approvedReadingBatch4 } from './approvedReadingBatch4.js'
import { approvedReadingBatch5 } from './approvedReadingBatch5.js'
import { approvedVocabularyBatch1 } from './approvedVocabularyBatch1.js'
import { approvedGrammarBatch1 } from './approvedGrammarBatch1.js'
import { approvedVocabularyBatch2 } from './approvedVocabularyBatch2.js'
import { approvedGrammarBatch2 } from './approvedGrammarBatch2.js'
import { approvedVocabularyBatch3 } from './approvedVocabularyBatch3.js'
import { approvedGrammarBatch3 } from './approvedGrammarBatch3.js'
import { approvedVocabularyBatch4 } from './approvedVocabularyBatch4.js'
import { approvedGrammarBatch4 } from './approvedGrammarBatch4.js'
import { approvedGrammarBatch5 } from './approvedGrammarBatch5.js'
import { approvedVocabularyBatch5 } from './approvedVocabularyBatch5.js'
import { approvedReadingBatch6 } from './approvedReadingBatch6.js'
import {
  approvedReadingBatch7,
  createApprovedReadingBatch7Import
} from './approvedReadingBatch7.js'

describe('approvedReadingBatch7', () => {
  it('preserves bootstrap and rejects cross-batch logical ID collisions', () => {
    expect(originalQuestionSeeds).toHaveLength(65)
    const ids = new Set(originalQuestionSeeds.map(({ id }) => id))
    for (const { registration } of [
      ...approvedReadingBatch1.items,
      ...approvedReadingBatch2.items,
      ...approvedReadingBatch3.items,
      ...approvedReadingBatch4.items,
      ...approvedReadingBatch5.items,
      ...approvedVocabularyBatch1.items,
      ...approvedGrammarBatch1.items,
      ...approvedVocabularyBatch2.items,
      ...approvedGrammarBatch2.items,
      ...approvedVocabularyBatch3.items,
      ...approvedGrammarBatch3.items,
      ...approvedVocabularyBatch4.items,
      ...approvedGrammarBatch4.items,
      ...approvedGrammarBatch5.items,
      ...approvedVocabularyBatch5.items,
      ...approvedReadingBatch6.items,
      ...approvedReadingBatch7.items
    ]) {
      expect(ids.has(registration.id)).toBe(false)
      ids.add(registration.id)
    }
  })
  it('preserves approved content, answers, tags and absent translation', () => {
    const request = createApprovedReadingBatch7Import()
    expect(request.items).toHaveLength(5)
    expect(
      approvedReadingBatch7.items.map(
        ({ registration }) => registration.correctIndex
      )
    ).toEqual([2, 0, 3, 1, 3])
    request.items.forEach((item, index) => {
      const source = approvedReadingBatch7.items[index]!.registration
      expect(item.clientItemId).toBe(source.id)
      expect(item.content.options.map(({ text }) => text)).toEqual(
        source.options
      )
      expect(item.content.correctOptionKey).toBe(
        `option-${source.correctIndex + 1}`
      )
      expect(item.content.passage).toBe(source.passage)
      expect(item.content.questionText).toBe(source.questionText)
      expect(item.content.explanationKo).toBe(source.explanationKo)
      expect(item.content.explanationJa).toBeNull()
      expect(item.content.tagNames).toEqual(source.tags)
    })
  })
})
