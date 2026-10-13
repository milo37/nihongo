import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/phase7'

// JLP-230 internal review; this batch is separate from the immutable 65-question bootstrap.
export const approvedGrammarBatch1 = {
  items: [
    {
      draftId: 'JLP-228-n4-grammar-06-draft1',
      sha256:
        'fcf4e516e7bbb3287c72b0abefb4116be99603932de90d7fbf01698f6345b0e9',
      registration: {
        id: 'n4-grammar-06',
        level: 'N4',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          '休みの 日は、掃除を したり、買い物を（　）して 過ごします。',
        options: ['したり', 'したら', 'すると', 'するなら'],
        correctIndex: 0,
        explanationKo:
          '휴일에 하는 여러 행동을 예로 드는 「〜たり、〜たりする」 형식이므로 두 번째 행동도 「買い物をしたり」가 맞습니다. 「したら」「すると」「するなら」는 조건을 연결하는 형태로, 이 문장에서 「掃除をしたり」와 병렬을 이루고 뒤의 「して過ごします」로 마무리하는 구조에 맞지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['행동 나열', 'たり', '휴일'],
        passage: null
      }
    },
    {
      draftId: 'JLP-228-n4-grammar-07-draft1',
      sha256:
        '3ea57304c85a6ed615f85a536330690b992f62dc1bc84a54ee2798acd32e96cb',
      registration: {
        id: 'n4-grammar-07',
        level: 'N4',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          'この 町では、駅から 美術館まで 行くのに、バス（　）電車の ほうが 十分ほど 早いです。',
        options: ['まで', 'より', 'しか', 'ほど'],
        correctIndex: 1,
        explanationKo:
          '버스보다 전철이 약 10분 더 빠르다고 비교하므로 비교 기준을 나타내는 「より」가 맞습니다. 「AよりBのほうが〜」는 A와 비교해 B 쪽이 더 그렇다는 구조입니다. 「まで」는 이 자리의 비교 기준이 아니고, 「しか」는 보통 부정 표현과 결합하며 이 비교 형식에 맞지 않습니다. 「ほど」도 이번 「Bのほうが早い」에 대응하는 「Aより」를 대신하지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['비교', 'より', '교통'],
        passage: null
      }
    },
    {
      draftId: 'JLP-228-n4-grammar-08-draft1',
      sha256:
        '4f9189a6a6b2654e2c928db09f76e9e7ff25db1a66a3d83331bd29a10cb55a6f',
      registration: {
        id: 'n4-grammar-08',
        level: 'N4',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        questionText:
          '受付で「申込用紙は 必ず 黒い ペンで 書いてください」と 言われました。申込用紙は 黒い ペンで 書かなければ（　）。',
        options: ['いません', 'しました', 'なりません', 'あるでしょう'],
        correctIndex: 2,
        explanationKo:
          '접수처가 반드시 검은 펜으로 쓰라고 했으므로 의무를 나타내는 「書かなければなりません」가 맞습니다. 「〜なければならない」는 하지 않으면 안 된다, 즉 해야 한다는 뜻입니다. 다른 선택지는 이 의무 표현을 완성하지 못합니다. 「いません」이나 「あるでしょう」는 존재 관련 표현이고 「しました」는 する의 과거형으로 제시된 접속에 맞지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['의무', 'なければならない', '접수'],
        passage: null
      }
    },
    {
      draftId: 'JLP-228-n4-grammar-09-draft1',
      sha256:
        'db295a2753656d89c6fa7b6bafc6044e770109ad8d7cef5f5588594aca2fc937',
      registration: {
        id: 'n4-grammar-09',
        level: 'N4',
        subject: 'GRAMMAR',
        questionType: 'TEXT_GRAMMAR',
        questionText: '文章の（　）に 入る 最も 適切な 表現は どれですか。',
        options: [
          'それにもかかわらず',
          'その代わり',
          'そうでなければ',
          'その結果'
        ],
        correctIndex: 3,
        explanationKo:
          '설명서만으로 사용하지 못하다가 담당자와 한번 사용해 본 뒤 방법을 이해하고 혼자 복사할 수 있게 됐습니다. 따라서 앞 행동의 결과를 잇는 「その結果」가 맞습니다. 「それにもかかわらず」는 예상에 반한 결과를 나타내지만 여기서는 도움으로 익힌 결과입니다. 「その代わり」가 나타낼 교환·대체나 「そうでなければ」가 이어 줄 반대 조건도 없습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['문장문법', '결과 연결', 'その結果'],
        passage:
          '新しい コピー機の 使い方が 分からず、説明書だけを 読んでも うまく 使えませんでした。そこで、係の 人に 頼んで、一緒に 一度 使ってみました。（　）、自分で コピーできるように なりました。説明してもらった 通りに ボタンを 押せば よいと 分かったからです。'
      }
    },
    {
      draftId: 'JLP-228-n4-grammar-10-draft1',
      sha256:
        '3c8015b735b168fd9582d9f815ff013d1871c33cb1585273a215f87e3dcafa56',
      registration: {
        id: 'n4-grammar-10',
        level: 'N4',
        subject: 'GRAMMAR',
        questionType: 'TEXT_GRAMMAR',
        questionText: '文章の（　）に 入る 最も 適切な 表現は どれですか。',
        options: ['ところが', 'そのため', 'つまり', '例えば'],
        correctIndex: 0,
        explanationKo:
          '조용한 방에서 편히 쉬리라는 기대와 실제로는 자동차 소음 때문에 잠들기 어려웠다는 결과가 대비됩니다. 따라서 기대와 다른 전개를 나타내는 「ところが」가 맞습니다. 「そのため」로 앞 기대가 소음의 원인인 것처럼 연결할 수 없고, 「つまり」가 앞 내용을 다시 풀어 설명하는 관계도 아닙니다. 실제 경험은 기대를 뒷받침하는 예가 아니라 반대되는 내용이므로 「例えば」도 가장 적절하지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['문장문법', '기대와 실제', 'ところが'],
        passage:
          '旅行の 前に、ホテルの 部屋は 広くて 静かだと 聞いていました。ゆっくり 休めると 思って、楽しみに していました。（　）、実際に 泊まってみると、部屋は 広かったのですが、夜も 外の 車の 音が よく 聞こえました。うるさくて、なかなか 眠れませんでした。'
      }
    }
  ],
  qaPass: 5,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedGrammarBatch1Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedGrammarBatch1.items.map(({ registration }) => ({
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
