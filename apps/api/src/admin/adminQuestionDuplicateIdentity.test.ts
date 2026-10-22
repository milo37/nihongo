import { createPhase7QuestionDuplicateIdentity } from '@nihongo/contracts/admin/phase7'
import {
  canonicalDuplicateIdentity,
  type DuplicateIdentityMaterialV1
} from '@nihongo/domain/content/validators/v1/duplicates'
import type { OriginalQuestionContentV1 } from '@nihongo/domain/content/validators/v1/types'
import { describe, expect, it } from 'vitest'

describe('Phase 7 ADMIN duplicate identity parity', () => {
  it('matches the Phase 6 canonical identity across Unicode whitespace and option order', () => {
    const content: OriginalQuestionContentV1 = {
      level: 'N5',
      subject: 'VOCABULARY',
      questionType: 'CONTEXT_VOCABULARY',
      difficulty: 'NORMAL',
      passage: '\u3000Ａ  passage\ttext ',
      questionText: '  ＱＵＥＳＴＩＯＮ\n text\u00a0',
      options: [
        { key: '1', text: ' ＺＥＴＡ ' },
        { key: '2', text: '\u3000ＡＬＰＨＡ\tvalue' },
        { key: '3', text: 'かな' },
        { key: '4', text: ' Beta  value ' }
      ],
      correctOptionKey: '2',
      explanationKo: '중복 identity parity fixture입니다.',
      explanationJa: null,
      tagKeys: ['parity'],
      distractorRationalesKo: {
        '1': null,
        '2': null,
        '3': null,
        '4': null
      }
    }
    const material: DuplicateIdentityMaterialV1 = {
      subject: content.subject,
      questionType: content.questionType,
      passage: content.passage,
      questionText: content.questionText,
      optionTexts: content.options.map(({ text }) => text),
      correctOptionText:
        content.options.find(({ key }) => key === content.correctOptionKey)
          ?.text ?? ''
    }

    expect(createPhase7QuestionDuplicateIdentity(material)).toBe(
      canonicalDuplicateIdentity(content)
    )
  })
})
