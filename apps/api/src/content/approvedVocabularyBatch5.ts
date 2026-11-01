import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/content-operations'

// JLP-259 internal QA; registration and release remain unverified.
export const approvedVocabularyBatch5 = {
  items: [
    {
      draftId: 'JLP-258-n1-vocabulary-06-draft1',
      sha256:
        'edad2bd3fe2a152c28885e8d360941abfdced2afb6e10f647eea86ac03b07902',
      registration: {
        id: 'n1-vocabulary-06',
        level: 'N1',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        questionText:
          '洪水による被害は「甚大」で、復旧には長い時間がかかった。「甚大」の読み方はどれですか。',
        options: ['しんたい', 'じんたい', 'しんだい', 'じんだい'],
        correctIndex: 3,
        explanationKo:
          '피해나 영향이 매우 큼을 뜻하는 「甚大」는 「じんだい」라고 읽습니다. 甚는 じん, 大는 だい이며 다른 보기는 이 단어의 독음과 다릅니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['한자 읽기', '甚大', '피해'],
        passage: null
      }
    },
    {
      draftId: 'JLP-258-n1-vocabulary-07-draft1',
      sha256:
        '1891c90e742e71e56f8cbaa8bcc1b67529002fe7a80f1adb53fa909a01ddf4bf',
      registration: {
        id: 'n1-vocabulary-07',
        level: 'N1',
        subject: 'VOCABULARY',
        questionType: 'CONTEXT_VOCABULARY',
        questionText:
          '同じ仕事をしているのに、雇用形態だけで手当の額に不公平な差が生じていた。会社はこの不公平をなくすため、支給基準を見直して格差を（　）する方針を示した。',
        options: ['是正', '助長', '黙認', '温存'],
        correctIndex: 0,
        explanationKo:
          '불공평을 없애기 위해 기준을 재검토하므로 잘못된 상태를 바로잡는 「是正」이 맞습니다. 助長는 더 커지도록 부추김, 黙認는 알면서 묵인함, 温存는 없애지 않고 남겨 둠으로 불공평을 해소하는 방침과 맞지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['문맥 어휘', '是正', '격차'],
        passage: null
      }
    },
    {
      draftId: 'JLP-258-n1-vocabulary-08-draft1',
      sha256:
        'd0c11bd573751d2f1dc7e9591441aee9810978f35a07eb69fd8176d46b96ffef',
      registration: {
        id: 'n1-vocabulary-08',
        level: 'N1',
        subject: 'VOCABULARY',
        questionType: 'PARAPHRASE',
        questionText:
          'その予測は細かな点では外れているが、方向は合っているので、「あながち間違いとは言えない」。近い意味はどれですか。',
        options: [
          '細部も含めて完全に正しいと言える',
          'すべて誤りだとは言い切れない',
          '内容をまだ一度も確認していない',
          '方向が合っているので細部は必ず正しい'
        ],
        correctIndex: 1,
        explanationKo:
          '부정 표현과 함께 쓰인 「あながち」는 반드시·무조건 그렇다고는 할 수 없다는 판단을 나타냅니다. 세부는 틀려도 방향은 맞으므로 모두 잘못이라고 단정하지 못한다는 「すべて誤りだとは言い切れない」가 가장 가깝습니다. 완전한 정답 보장이나 확인하지 않았다는 뜻은 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['유의 표현', 'あながち', '제한적 판단'],
        passage: null
      }
    },
    {
      draftId: 'JLP-258-n1-vocabulary-09-draft1',
      sha256:
        'ebbb64cd99756c1f0dccc5b469112467876aedf5663f26e871118ae43469e394',
      registration: {
        id: 'n1-vocabulary-09',
        level: 'N1',
        subject: 'VOCABULARY',
        questionType: 'ORTHOGRAPHY',
        questionText:
          '不都合な事実を外部に知らせないよう、記録を意図的に「いんぺい」していた。「いんぺい」の正しい表記はどれですか。',
        options: ['陰影', '隠居', '隠蔽', '印影'],
        correctIndex: 2,
        explanationKo:
          '사실이나 기록을 의도적으로 감추는 「いんぺい」의 표기는 「隠蔽」입니다. 陰影와 印影는 いんえい, 隠居는 いんきょ로 읽으며 읽기와 의미가 다릅니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['한자 표기', '隠蔽', '기록'],
        passage: null
      }
    },
    {
      draftId: 'JLP-258-n1-vocabulary-10-draft1',
      sha256:
        '624706807c477aeeb1eca19009e8e586d3c0676c7922625b7399690ac8a49d9e',
      registration: {
        id: 'n1-vocabulary-10',
        level: 'N1',
        subject: 'VOCABULARY',
        questionType: 'WORD_USAGE',
        questionText: '「打開」の使い方が正しいものはどれですか。',
        options: [
          '箱を打開して、中の商品を机に出した。',
          '朝、カーテンを打開して日光を入れた。',
          '学生は辞書を打開して、単語を調べた。',
          '交渉が行き詰まったが、新しい提案で事態を打開した。'
        ],
        correctIndex: 3,
        explanationKo:
          '「打開」는 막힌 상황이나 어려운 사태를 해결할 길을 여는 뜻이므로 새로운 제안으로 교착된 협상을 풀었다는 문장이 맞습니다. 상자·커튼·사전을 물리적으로 여는 동작을 나타내는 단어는 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['단어 용법', '打開', '교착 해결'],
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
export const createApprovedVocabularyBatch5Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedVocabularyBatch5.items.map(({ registration }) => ({
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
