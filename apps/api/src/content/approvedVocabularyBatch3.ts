import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/phase7'

// JLP-241 internal QA; registration and release remain unverified.
export const approvedVocabularyBatch3 = {
  items: [
    {
      draftId: 'JLP-240-n2-vocabulary-06-draft1',
      sha256:
        '0227918165d1f90da478202cbc3f498381123803e98856479a39e09607a09646',
      registration: {
        id: 'n2-vocabulary-06',
        level: 'N2',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        questionText:
          '作業の「手順」を確認してから、機械を動かしてください。「手順」の読み方はどれですか。',
        options: ['しゅじゅん', 'てじゅん', 'てしゅん', 'しゅしゅん'],
        correctIndex: 1,
        explanationKo:
          '작업을 진행하는 순서를 뜻하는 「手順」은 「てじゅん」이라고 읽습니다. 이 단어의 手는 て, 順은 じゅん으로 읽으며 다른 세 조합은 이 단어의 독음이 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['한자 읽기', '手順', '작업'],
        passage: null
      }
    },
    {
      draftId: 'JLP-240-n2-vocabulary-07-draft1',
      sha256:
        '62b4c157c17c5da609f0e576c7f22f2fe2fecc4b293ccc4ba5168e7871acd9ec',
      registration: {
        id: 'n2-vocabulary-07',
        level: 'N2',
        subject: 'VOCABULARY',
        questionType: 'CONTEXT_VOCABULARY',
        questionText:
          '費用を減らすため、事務用品を一つずつ買うのをやめ、必要な分をまとめて（　）することにした。注文する数量が多いほど、一個当たりの価格が下がるからだ。',
        options: ['支給', '請求', '購入', '返却'],
        correctIndex: 2,
        explanationKo:
          '문구를 따로 사던 방식에서 필요한 수량을 한꺼번에 사는 방식으로 바꾸므로 「購入する」가 맞습니다. 支給는 지급, 請求는 대금이나 제공을 요구함, 返却는 반환이므로 주문량에 따른 구매 단가를 낮추는 행동과 다릅니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['문맥 어휘', '購入', '단가'],
        passage: null
      }
    },
    {
      draftId: 'JLP-240-n2-vocabulary-08-draft1',
      sha256:
        '9b24190ef6045bfdc5565451676715d87ca01a10b7667570f00bedb26f0287a5',
      registration: {
        id: 'n2-vocabulary-08',
        level: 'N2',
        subject: 'VOCABULARY',
        questionType: 'PARAPHRASE',
        questionText:
          '発表前の説明会に参加したので、新しい制度の内容は「おおむね理解できた」。「おおむね理解できた」に最も近い意味はどれですか。',
        options: [
          '何も理解できなかった',
          'まだ説明を聞いていなかった',
          '細かな点まで一つ残らず理解できた',
          '大体は理解できた'
        ],
        correctIndex: 3,
        explanationKo:
          '「おおむね」는 대체로·대략이라는 뜻이므로 「大体は理解できた」가 가장 가깝습니다. 아무것도 이해하지 못한 상태나 설명을 아직 듣지 않은 상태가 아니며, 세부 사항을 빠짐없이 이해했다는 완전성까지 뜻하지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['유의 표현', 'おおむね', '이해 정도'],
        passage: null
      }
    },
    {
      draftId: 'JLP-240-n2-vocabulary-09-draft1',
      sha256:
        '4a0caa7fbc0c3e68dc902ad1d565196157383a07909d9203c5151a90c251549c',
      registration: {
        id: 'n2-vocabulary-09',
        level: 'N2',
        subject: 'VOCABULARY',
        questionType: 'ORTHOGRAPHY',
        questionText:
          '安全のため、利用者には決められた方法を「じゅんしゅ」してもらう。「じゅんしゅ」の正しい表記はどれですか。',
        options: ['遵守', '順序', '純粋', '巡視'],
        correctIndex: 0,
        explanationKo:
          '정해진 규칙이나 방법을 지켜 따르는 「じゅんしゅ」의 표기는 「遵守」입니다. 順序는 じゅんじょ, 純粋는 じゅんすい, 巡視는 じゅんし로 읽으며 읽기와 의미가 모두 다릅니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['한자 표기', '遵守', '규칙'],
        passage: null
      }
    },
    {
      draftId: 'JLP-240-n2-vocabulary-10-draft1',
      sha256:
        'f58593e6af503955b7e580704e8fb84ba2c3366b2b9ea468bb1e2e26cfae5450',
      registration: {
        id: 'n2-vocabulary-10',
        level: 'N2',
        subject: 'VOCABULARY',
        questionType: 'WORD_USAGE',
        questionText: '「省く」の使い方が正しいものはどれですか。',
        options: [
          '荷物を持ち上げるために、両手で省いた。',
          '時間が足りないので、説明の細かな部分を省いた。',
          '部屋が暗かったので、照明を省いて明るくした。',
          'なくした鍵が机の下から省いた。'
        ],
        correctIndex: 1,
        explanationKo:
          '「省く」는 일부를 빼거나 생략하는 뜻이므로 시간이 부족해 설명의 세부를 생략했다는 문장이 맞습니다. 짐을 들어 올리는 동작·조명을 켜는 동작·열쇠가 발견되는 상황을 나타내는 동사는 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['단어 용법', '省く', '생략'],
        passage: null
      }
    }
  ],
  qaPass: 5,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedVocabularyBatch3Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedVocabularyBatch3.items.map(({ registration }) => ({
      clientItemId: registration.id,
      content: adminQuestionContentInputSchema.parse({
        level: registration.level,
        subject: registration.subject,
        questionType: registration.questionType,
        difficulty: registration.difficulty,
        questionText: registration.questionText,
        passage: registration.passage,
        explanationKo: registration.explanationKo,
        explanationJa: registration.explanationJa,
        tagNames: registration.tags,
        options: registration.options.map((text, index) => ({
          clientOptionKey: `option-${index + 1}`,
          text
        })),
        correctOptionKey: `option-${registration.correctIndex + 1}`
      })
    }))
  })
