import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/phase7'

// JLP-227 internal review; this batch is separate from the immutable 65-question bootstrap.
export const approvedVocabularyBatch1 = {
  items: [
    {
      draftId: 'JLP-225-n4-vocabulary-06-draft1',
      sha256:
        'ea0106f4429ec5edf16c230e2655baf354d0e59d8666aef91b53d015b05ee349',
      registration: {
        id: 'n4-vocabulary-06',
        level: 'N4',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        questionText:
          '道が 分からないとき、「親切」な 人が 駅まで 案内してくれました。「親切」の 読み方は どれですか。',
        options: ['しんせつ', 'しんさい', 'しんけつ', 'おやきり'],
        correctIndex: 0,
        explanationKo:
          '「親切」는 남을 배려하고 친절하게 대하는 뜻이며 「しんせつ」라고 읽습니다. 문장에서는 길을 모를 때 역까지 안내해 준 사람의 친절함을 나타냅니다. 나머지 독음은 「親切」의 읽기가 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['한자 읽기', '친절', '형용동사'],
        passage: null
      }
    },
    {
      draftId: 'JLP-225-n4-vocabulary-07-draft1',
      sha256:
        '4f70046770b440a132734b2ab8c23928b2e81a61ffa1def2d2a7bd11c08f02ae',
      registration: {
        id: 'n4-vocabulary-07',
        level: 'N4',
        subject: 'VOCABULARY',
        questionType: 'CONTEXT_VOCABULARY',
        questionText:
          '友だちは 日本語の 辞書を 持っていません。わたしの 辞書を 一週間 使ってもらい、そのあと 返してもらうことに しました。わたしは 友だちに 辞書を（　）。',
        options: ['借ります', '貸します', '捨てます', '売ります'],
        correctIndex: 1,
        explanationKo:
          '화자가 자기 사전을 친구에게 일주일 쓰게 하고 돌려받으므로 빌려주는 「貸します」가 맞습니다. 「借ります」는 화자가 다른 사람 물건을 빌리는 반대 방향입니다. 「捨てます」는 버리는 행동이고 「売ります」는 팔아 소유를 넘기는 행동으로, 사용 후 돌려받는 이번 대여와 다릅니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['문맥 어휘', '대여 방향', '동사'],
        passage: null
      }
    },
    {
      draftId: 'JLP-225-n4-vocabulary-08-draft1',
      sha256:
        'd584e6fe48bd66eab14da5bb86bd9a702c04973eb4a58c296e93168ec7da58e2',
      registration: {
        id: 'n4-vocabulary-08',
        level: 'N4',
        subject: 'VOCABULARY',
        questionType: 'PARAPHRASE',
        questionText:
          '会場には「だいたい」五十人の 人が いました。この 文に 近い 意味の 文は どれですか。',
        options: [
          '会場には 五十人より ずっと 多くの 人が いました。',
          '会場には ちょうど 五十人の 人が いました。',
          '会場には 五十人に 近い 数の 人が いました。',
          '会場には 人が 一人も いませんでした。'
        ],
        correctIndex: 2,
        explanationKo:
          '숫자 앞의 「だいたい」는 정확히 확정한 수가 아니라 대략 그 정도라는 뜻입니다. 따라서 50명에 가까운 수를 뜻하는 선택이 가장 가깝습니다. 훨씬 많다는 뜻이나 오차 없이 정확히 50명이라는 뜻은 아니며, 사람이 하나도 없다는 뜻도 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['유의 표현', '수량', '대략'],
        passage: null
      }
    },
    {
      draftId: 'JLP-225-n4-vocabulary-09-draft1',
      sha256:
        '592d23cd689c9caa0bce94700090a0ff3cae496bb64a4d2f2c2b6a32006ded73',
      registration: {
        id: 'n4-vocabulary-09',
        level: 'N4',
        subject: 'VOCABULARY',
        questionType: 'ORTHOGRAPHY',
        questionText:
          '使った 道具を 箱に 戻して、部屋を「かたづけます」。正しい 漢字表記は どれですか。',
        options: ['近付けます', '続けます', '届けます', '片付けます'],
        correctIndex: 3,
        explanationKo:
          '물건을 제자리에 돌려놓고 방을 정리하는 「かたづけます」의 한자 표기는 「片付けます」입니다. 「近付けます」는 「ちかづけます」로 가까이 가져가는 뜻, 「続けます」는 「つづけます」로 계속하는 뜻, 「届けます」는 「とどけます」로 전달하는 뜻입니다. 이 문항은 제시된 네 선택지 중 해당 읽기의 한자 표기를 고릅니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['한자 표기', '정리', '동사'],
        passage: null
      }
    },
    {
      draftId: 'JLP-225-n4-vocabulary-10-draft1',
      sha256:
        '5300adcc5adaa23f6c16965ca42b9bb14a87b9f33891c56483e2dcadcd990d9e',
      registration: {
        id: 'n4-vocabulary-10',
        level: 'N4',
        subject: 'VOCABULARY',
        questionType: 'WORD_USAGE',
        questionText: '「増える」の 使い方が 正しい 文は どれですか。',
        options: [
          '参加する 人の 数が 去年の 二十人から 三十人に 増えました。',
          '参加する 人の 数が 二十人から 十人に 増えました。',
          '係の 人が 参加する 人の 数を 増えました。',
          '参加する 人の 名前を 紙に 増えました。'
        ],
        correctIndex: 0,
        explanationKo:
          '「増える」는 수나 양이 많아지는 것을 나타내는 자동사입니다. 참가 인원이 20명에서 30명으로 많아졌고 「数が増えました」라고 한 문장이 맞습니다. 20명에서 10명은 줄어든 것이므로 「減りました」가 알맞습니다. 담당자가 인원을 늘리는 타동사 문장에는 「数を増やしました」를 씁니다. 이름을 종이에 쓰는 행동도 「増える」로 표현하지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['단어 용법', '수량 변화', '자동사 타동사'],
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
export const createApprovedVocabularyBatch1Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedVocabularyBatch1.items.map(({ registration }) => ({
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
