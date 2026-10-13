import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/phase7'

// JLP-249 internal QA; registration and release remain unverified.
export const approvedVocabularyBatch4 = {
  items: [
    {
      draftId: 'JLP-248-n5-vocabulary-06-draft1',
      sha256:
        '94fdc33bdbdcbf847f7e5fba0d1698db31ff5300839be3a05ed591e5f653f82f',
      registration: {
        id: 'n5-vocabulary-06',
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        questionText: '「山」の よみかたは どれですか。',
        options: ['かわ', 'うみ', 'やま', 'そら'],
        correctIndex: 2,
        explanationKo:
          '「山」은 산을 뜻하며 「やま」라고 읽습니다. かわ는 강, うみ는 바다, そら는 하늘의 읽기로 山의 독음이 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['한자 읽기', '山', '자연'],
        passage: null
      }
    },
    {
      draftId: 'JLP-248-n5-vocabulary-07-draft1',
      sha256:
        'b771e02c06d0c629b1e867b7959276174203f05a704aad529df92ac948bd653d',
      registration: {
        id: 'n5-vocabulary-07',
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'CONTEXT_VOCABULARY',
        questionText:
          'パンを かいます。パンは 一つ 百円です。二つで（　）です。',
        options: ['五十円', '百円', '三百円', '二百円'],
        correctIndex: 3,
        explanationKo:
          '빵 한 개가 100엔이므로 두 개는 200엔이며 「二百円」이 맞습니다. 五十円은 50엔, 百円은 100엔, 三百円은 300엔입니다. 숫자 어휘를 문맥의 수량과 연결합니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['문맥 어휘', '금액', '二百'],
        passage: null
      }
    },
    {
      draftId: 'JLP-248-n5-vocabulary-08-draft1',
      sha256:
        '9296bbfc033dadf19054c56bce890d5df3c06837d509e38f03ffe3f9f1122108',
      registration: {
        id: 'n5-vocabulary-08',
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'PARAPHRASE',
        questionText:
          'この かばんは「ちいさい」です。ちかい いみは どれですか。',
        options: [
          '大きく ありません',
          'あたらしく ありません',
          'きれいでは ありません',
          'やすく ありません'
        ],
        correctIndex: 0,
        explanationKo:
          '「ちいさい」는 크기가 작다는 뜻이므로 크지 않다는 「大きくありません」이 가장 가깝습니다. 새로움·깨끗함·가격과는 다른 크기의 표현입니다. 크지 않은 모든 것이 반드시 작다는 일반 정의가 아니라, 제시된 보기 중 크기에 관한 가장 가까운 표현을 고릅니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['유의 표현', 'ちいさい', '크기'],
        passage: null
      }
    },
    {
      draftId: 'JLP-248-n5-vocabulary-09-draft1',
      sha256:
        '37520aff6dbb7259a157ae3933504f8a88642d64dc62c50a5b3ce69593d62fa3',
      registration: {
        id: 'n5-vocabulary-09',
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'ORTHOGRAPHY',
        questionText: '「みぎ」を かんじで かくと どれですか。',
        options: ['左', '右', '上', '下'],
        correctIndex: 1,
        explanationKo:
          '오른쪽을 뜻하는 「みぎ」의 한자 표기는 「右」입니다. 左는 ひだり(왼쪽), 上은 うえ(위), 下는 した(아래)입니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['한자 표기', '右', '방향'],
        passage: null
      }
    },
    {
      draftId: 'JLP-248-n5-vocabulary-10-draft1',
      sha256:
        'ae82e1520d4f86eb811fb0a983a0d2ae084135a1fb24c20a0e2d9ca9c054e906',
      registration: {
        id: 'n5-vocabulary-10',
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'WORD_USAGE',
        questionText: '「はく」の つかいかたが ただしい ものは どれですか。',
        options: [
          'ぼうしを はきます。',
          'シャツを はきます。',
          'くつを はきます。',
          'めがねを はきます。'
        ],
        correctIndex: 2,
        explanationKo:
          '신발·양말·바지처럼 발이나 하반신에 착용하는 물건에는 「はく」를 씁니다. 따라서 「くつをはきます」가 맞습니다. 모자는 かぶる, 셔츠는 きる, 안경은 かける가 자연스럽습니다. 여기서는 착용 동사의 용법을 묻습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['단어 용법', 'はく', '착용'],
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
export const createApprovedVocabularyBatch4Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedVocabularyBatch4.items.map(({ registration }) => ({
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
