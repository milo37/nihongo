import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/content-operations'

// JLP-233 internal review; this batch is separate from the immutable 65-question bootstrap.
export const approvedVocabularyBatch2 = {
  items: [
    {
      draftId: 'JLP-231-n3-vocabulary-06-draft1',
      sha256:
        'f268e80931b6158f384453b28f3f9305f35df72d82afa9ae6d57780c10a71ce1',
      registration: {
        id: 'n3-vocabulary-06',
        level: 'N3',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        questionText:
          '手伝ってくれた 人に「感謝」の 気持ちを 伝えました。「感謝」の 読み方は どれですか。',
        options: ['かんしゅう', 'かんさ', 'かんしゃ', 'かんじ'],
        correctIndex: 2,
        explanationKo:
          '도와준 사람에게 고마운 마음을 전한다는 문장에서 「感謝」는 「かんしゃ」라고 읽습니다. 다른 선택지는 「感謝」의 독음이 아닙니다. 특히 謝는 이 숙어에서 しゃ로 읽어 しゅう나 さ, じ로 바꾸지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['한자 읽기', '감사', '추상 명사'],
        passage: null
      }
    },
    {
      draftId: 'JLP-231-n3-vocabulary-07-draft1',
      sha256:
        '479ed5b7a52be48b28d50d717e6c0d24278016d11a11f9da5f7342932d0eb444',
      registration: {
        id: 'n3-vocabulary-07',
        level: 'N3',
        subject: 'VOCABULARY',
        questionType: 'CONTEXT_VOCABULARY',
        questionText:
          '祖父の 話を あとで 聞き直したいので、音声だけを データとして 残すことに しました。祖父の 声を（　）しました。映像は 撮っていません。',
        options: ['印刷', '翻訳', '録画', '録音'],
        correctIndex: 3,
        explanationKo:
          '나중에 다시 들으려고 할아버지 목소리를 음성 데이터로 남겼으므로 「録音しました」가 맞습니다. 「印刷」는 종이 등에 인쇄하는 행동이고 「翻訳」는 다른 언어로 옮기는 행동입니다. 「録画」는 영상 기록으로, 영상은 찍지 않고 음성만 남겼다는 조건과 다릅니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['문맥 어휘', '음성 기록', '동작성 명사'],
        passage: null
      }
    },
    {
      draftId: 'JLP-231-n3-vocabulary-08-draft1',
      sha256:
        '74a82facd321bef03cdee579a44d4485e574b26987b160966c6226a3bc5df8af',
      registration: {
        id: 'n3-vocabulary-08',
        level: 'N3',
        subject: 'VOCABULARY',
        questionType: 'PARAPHRASE',
        questionText:
          '夜も 遅くなりました。「そろそろ」帰る 時間です。この 文に 近い 意味の 文は どれですか。',
        options: [
          '帰るのに よい 時刻が 近づいています。',
          'もう 家に 着いて、休んでいます。',
          'まだ 長い 時間 ここに いなければなりません。',
          '帰るかどうかは、時間と 全く 関係が ありません。'
        ],
        correctIndex: 0,
        explanationKo:
          '「そろそろ」는 어떤 일을 할 적절한 때가 가까워졌음을 나타냅니다. 밤이 늦어 이제 돌아갈 때가 되어 간다는 문장이 가깝습니다. 이미 집에 도착했다는 뜻이나 아직 오래 머물러야 한다는 뜻은 아닙니다. 시각과 관계가 전혀 없다는 의미도 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['유의 표현', '행동 시기', '부사'],
        passage: null
      }
    },
    {
      draftId: 'JLP-231-n3-vocabulary-09-draft1',
      sha256:
        'ff8261796f93d4154b2454611023875f215de265e61a1dc175a9adc85f387c60',
      registration: {
        id: 'n3-vocabulary-09',
        level: 'N3',
        subject: 'VOCABULARY',
        questionType: 'ORTHOGRAPHY',
        questionText:
          '友人を 自分の 誕生日の 食事会に「しょうたい」しました。正しい 漢字表記は どれですか。',
        options: ['紹介', '招待', '期待', '招集'],
        correctIndex: 1,
        explanationKo:
          '사람을 자신의 행사에 초대하는 「しょうたい」의 표기는 「招待」입니다. 「紹介」는 「しょうかい」로 소개, 「期待」는 「きたい」로 기대, 「招集」는 「しょうしゅう」로 불러 모으는 것을 나타내며 제시된 독음과 다릅니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['한자 표기', '초대', '유사 한자'],
        passage: null
      }
    },
    {
      draftId: 'JLP-231-n3-vocabulary-10-draft1',
      sha256:
        'b0ae191d6465451bbaf38f277bb544342806b8bd60651cd40e86308ed38fb6ba',
      registration: {
        id: 'n3-vocabulary-10',
        level: 'N3',
        subject: 'VOCABULARY',
        questionType: 'WORD_USAGE',
        questionText: '「延期」の 使い方が 正しい 文は どれですか。',
        options: [
          '日時は 変えずに 会議室だけを 変えたので、会議を 延期した。',
          '金曜日の 会議を 同じ週の 月曜日に 早めるため、延期した。',
          '今週の 会議を 来週 行うことに して、延期した。',
          '今後は 開催しないと 決めて、会議を 延期した。'
        ],
        correctIndex: 2,
        explanationKo:
          '「延期」는 예정된 일을 더 뒤의 시기로 미루는 것입니다. 이번 주 회의를 다음 주에 열기로 한 문장이 맞습니다. 시간은 그대로 두고 장소만 바꾸는 것은 연기가 아니며, 같은 주 금요일을 월요일로 앞당기는 것도 반대입니다. 앞으로도 열지 않기로 중지만 결정한 경우는 뒤에 열기로 미루는 연기와 다릅니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['단어 용법', '예정 변경', '延期'],
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
export const createApprovedVocabularyBatch2Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedVocabularyBatch2.items.map(({ registration }) => ({
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
