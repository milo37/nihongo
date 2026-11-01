import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/content-operations'

// JLP-252 internal QA; registration and release remain unverified.
export const approvedGrammarBatch4 = {
  items: [
    {
      draftId: 'JLP-251-n5-grammar-06-draft1',
      sha256:
        '3883b98d0633a1030f801dc188b5f0d6889abe4d7999d7fa8ec715770f426cd8',
      registration: {
        id: 'n5-grammar-06',
        level: 'N5',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          'きのうは とても（　）です。きょうは あまり さむく ありません。',
        options: ['さむい', 'さむくない', 'さむく', 'さむかった'],
        correctIndex: 3,
        explanationKo:
          '어제의 추위를 말하므로 い형용사 さむい의 과거형 「さむかった」가 맞습니다. さむい는 현재형, さむくない는 현재 부정형, さむく는 이 문장에서 です와 함께 과거 서술을 이루지 못하는 연결형입니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['い형용사 과거', 'かった', '날씨'],
        passage: null
      }
    },
    {
      draftId: 'JLP-251-n5-grammar-07-draft1',
      sha256:
        'ba9c069f6cfde8b31a53e09029d1b4b89d74f1ff04af0dfbb5b3acb95077661a',
      registration: {
        id: 'n5-grammar-07',
        level: 'N5',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          '図書館では おおきな 声で 話しては（　）。しずかに してください。',
        options: ['いけません', 'ください', 'います', 'あります'],
        correctIndex: 0,
        explanationKo:
          '도서관에서 큰 소리로 말하면 안 된다는 금지이므로 「〜てはいけません」의 「いけません」이 맞습니다. ください는 てください에서 요청을 나타내지만 여기에는 は가 들어가 금지 구조를 이룹니다. います·あります도 이 금지 구문의 끝을 이루지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['금지', 'てはいけません', '도서관'],
        passage: null
      }
    },
    {
      draftId: 'JLP-251-n5-grammar-08-draft1',
      sha256:
        '74c4a943a183d6a1ed9742c2b7e64cf09e688a18bdf9f5dee56b0c4f63febb96',
      registration: {
        id: 'n5-grammar-08',
        level: 'N5',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText: 'この へやは しずか（　）きれいです。',
        options: ['くて', 'で', 'に', 'を'],
        correctIndex: 1,
        explanationKo:
          'な형용사 しずか를 다른 상태인 きれい와 나열할 때는 「しずかで」를 사용합니다. くて는 い형용사 연결형이며 しずか에는 붙이지 않습니다. に는 부사적 연결, を는 목적격 조사이므로 이 두 상태의 나열에 맞지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['な형용사 연결', 'で', '방'],
        passage: null
      }
    },
    {
      draftId: 'JLP-251-n5-grammar-09-draft2',
      sha256:
        '88f23450cacef80ed55de1d6ab696d76a484df83e0a6eac103a4f3f050112f19',
      registration: {
        id: 'n5-grammar-09',
        level: 'N5',
        subject: 'GRAMMAR',
        questionType: 'TEXT_GRAMMAR',
        questionText: '文章の（　）に 入る ものを えらんで ください。',
        options: ['から', 'まで', 'も', 'で'],
        correctIndex: 2,
        explanationKo:
          '우유를 사고 빵도 산다는 추가 관계이므로 「パンも一つ買います」의 「も」가 맞습니다. 뒤에서 두 물건을 가방에 넣는다고 하여 빵이 추가 구매 대상임을 확인할 수 있습니다. から·まで는 범위, 「で」는 이 문장에서 구매 대상을 추가하지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['추가 조사', 'も', '구매'],
        passage:
          'きょう、わたしは スーパーへ 行きます。牛乳と パンを かいます。かばんは 小さいですが、牛乳は 一本です。パン（　）一つ かいます。二つの ものを かばんに 入れます。'
      }
    },
    {
      draftId: 'JLP-251-n5-grammar-10-draft1',
      sha256:
        '9a69e5a5a355c697c491158bdae308e2f4cd9f4aa0af9aba9efbfe022283bc04',
      registration: {
        id: 'n5-grammar-10',
        level: 'N5',
        subject: 'GRAMMAR',
        questionType: 'TEXT_GRAMMAR',
        questionText: '文章の（　）に 入る ものを えらんで ください。',
        options: ['に', 'を', 'と', 'から'],
        correctIndex: 3,
        explanationKo:
          '역에서 집까지 걸리는 시간을 묻으므로 시작점 駅에 「から」를 붙여 「駅から家まで」로 표현합니다. に는 도착점·장소·시간 등에 쓰이지만 이 문장에서는 집까지의 시작점을 나타내지 않습니다. を는 이동 경로나 목적어, と는 동반·인용 등을 나타내어 시작점과 끝점의 짝에 맞지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['시작점 끝점', 'からまで', '이동 시간'],
        passage:
          'あした、田中さんの 家へ 行きます。田中さんの 家は はじめてです。田中さんに ききました。わたし「駅（　）家まで、何分 かかりますか。」田中さん「歩いて 十分です。」'
      }
    }
  ],
  qaPass: 5,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedGrammarBatch4Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedGrammarBatch4.items.map(({ registration }) => ({
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
