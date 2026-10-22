import { describe, expect, it } from 'vitest'
import { originalQuestionSeeds } from '../../prisma/seed-data/questions/index.js'
import {
  approvedReadingBatch4,
  createApprovedReadingBatch4Import
} from './approvedReadingBatch4.js'

import { approvedReadingBatch3 } from './approvedReadingBatch3.js'
import { approvedReadingBatch2 } from './approvedReadingBatch2.js'
import { approvedReadingBatch1 } from './approvedReadingBatch1.js'

describe('approved fourth incremental reading batch', () => {
  it('keeps the 65-question bootstrap separate and logical IDs disjoint', () => {
    expect(originalQuestionSeeds).toHaveLength(65)
    const ids = new Set(originalQuestionSeeds.map(({ id }) => id))
    for (const { registration } of [
      ...approvedReadingBatch1.items,
      ...approvedReadingBatch2.items,
      ...approvedReadingBatch3.items,
      ...approvedReadingBatch4.items
    ]) {
      expect(ids.has(registration.id)).toBe(false)
      ids.add(registration.id)
    }
    expect(ids.size).toBe(83)
  })

  it('maps reviewed content without changing answers, explanation or null translation', () => {
    const request = createApprovedReadingBatch4Import()
    expect(request.items).toHaveLength(5)
    request.items.forEach((item, index) => {
      const source = approvedReadingBatch4.items[index]!.registration
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
