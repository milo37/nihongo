import type { AdminImportItem } from '@nihongo/contracts/admin/content-operations'
import { describe, expect, it, vi } from 'vitest'
import { collectImportValidation } from './adminQuestionWorkflowImport.js'

const item = (tagNames: string[]): AdminImportItem => ({
  clientItemId: 'item-1',
  content: {
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    difficulty: 'EASY',
    passage: null,
    questionText: '水',
    explanationKo: '물',
    explanationJa: null,
    tagNames,
    options: [
      { clientOptionKey: 'a', text: 'みず' },
      { clientOptionKey: 'b', text: 'みせ' },
      { clientOptionKey: 'c', text: 'むず' },
      { clientOptionKey: 'd', text: 'めず' }
    ],
    correctOptionKey: 'a'
  }
})

describe('import validation tag limit (#712)', () => {
  it('refuses more than two tags before reading the database', async () => {
    const client = { $queryRawUnsafe: vi.fn() }
    await expect(
      collectImportValidation(client, [
        item(['vocab.a']),
        item(['vocab.a', 'vocab.b', 'vocab.c'])
      ])
    ).rejects.toMatchObject({
      code: 'IMPORT_VALIDATION_FAILED',
      fieldErrors: { '/items/1/content/tagNames': ['태그는 2개까지입니다.'] }
    })
    expect(client.$queryRawUnsafe).not.toHaveBeenCalled()
  })
})
