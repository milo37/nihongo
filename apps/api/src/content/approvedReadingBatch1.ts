import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/phase7'

// JLP-207 internal review; this batch is separate from the immutable 65-question bootstrap.
export const approvedReadingBatch1 = {
  items: [
    {
      draftId: 'JLP-205-n5-reading-04-draft1',
      sha256:
        '16fa77f432f7bd21e8f774dc6d14b9989deb2d9451646c9b2aebda8b960b032b',
      registration: {
        id: 'n5-reading-04',
        level: 'N5',
        subject: 'READING',
        questionType: 'SHORT_READING',
        passage:
          'ゆきさんへ。パンは もう 買いました。牛乳は まだ ありません。帰りに 牛乳を 一つ 買って ください。パンは 買わなくても いいです。母',
        questionText: 'ゆきさんは 帰りに 何を 買いますか。',
        options: ['パンだけ', '牛乳だけ', 'パンと 牛乳', '何も 買いません'],
        correctIndex: 1,
        explanationKo:
          '어머니는 빵을 이미 샀지만 우유는 아직 없다며 돌아오는 길에 우유 한 개를 사 달라고 합니다. 따라서 우유만 사면 됩니다. 빵만 사는 선택은 요청과 다르고, 빵과 우유를 모두 사는 선택은 빵을 사지 않아도 된다는 말과 다릅니다. 아무것도 사지 않는 선택은 우유를 사 달라는 요청을 따르지 않습니다.',
        explanationJa: null,
        difficulty: 'EASY',
        tags: ['짧은 글', '요청', '완료와 미완료']
      }
    },
    {
      draftId: 'JLP-205-n5-reading-05-draft1',
      sha256:
        '80f970215ab16e31f7baed455bf1d5c7e1fedbd3a689111c757b794b3a5b433c',
      registration: {
        id: 'n5-reading-05',
        level: 'N5',
        subject: 'READING',
        questionType: 'INFO_RETRIEVAL',
        passage:
          '図書館の お知らせ\n本を 返す 場所\n図書館が 開いている とき：一階の カウンター\n図書館が 閉まっている とき：入り口の 横の 箱\nCDは 箱に 入れないで ください。カウンターで 返して ください。',
        questionText:
          '図書館が 閉まっています。本だけを 返したいです。どこに 返しますか。',
        options: [
          '一階の カウンター',
          '入り口の 横の 箱',
          '図書館の 中の いす',
          'CDの 箱'
        ],
        correctIndex: 1,
        explanationKo:
          '도서관이 닫혀 있을 때 책을 반환하는 곳은 입구 옆 상자입니다. 질문은 CD 없이 책만 반환하려는 상황입니다. 1층 카운터는 도서관이 열려 있을 때 책을 반환하는 곳입니다. 도서관 안의 의자는 반환 장소로 안내되지 않았고, CD 전용 상자도 안내되지 않았습니다. 오히려 CD를 상자에 넣지 말고 카운터에 반환하라고 합니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['정보 찾기', '시설 안내', '조건']
      }
    },
    {
      draftId: 'JLP-205-n5-reading-06-draft1',
      sha256:
        'f01d66df4ab767b8e682c0a656188286cfe395cd5d6acf80dfd18f6da9ae0d48',
      registration: {
        id: 'n5-reading-06',
        level: 'N5',
        subject: 'READING',
        questionType: 'SHORT_READING',
        passage:
          'きょうは 絵の 授業が あります。先生が「赤と 青の えんぴつを 持ってきて ください」と 言いました。わたしの かばんには 赤い えんぴつだけが あります。青い えんぴつは 家の つくえの 上に あります。家を 出る 前に、それを かばんに 入れます。',
        questionText: '「わたし」は これから 何を かばんに 入れますか。',
        options: [
          '赤い えんぴつ',
          '赤い えんぴつと 青い えんぴつ',
          '絵の 本',
          '青い えんぴつ'
        ],
        correctIndex: 3,
        explanationKo:
          '빨간 연필은 이미 가방 안에 있고, 파란 연필은 집 책상 위에 있습니다. 집을 나서기 전에 가방에 넣겠다는 「それ」는 바로 앞에서 설명한 파란 연필을 가리킵니다. 따라서 이제 넣을 것은 파란 연필입니다. 빨간 연필은 이미 가방 안에 있으므로 새로 넣을 물건이 아닙니다. 두 연필을 모두 넣겠다는 선택도 현재 가방 상태와 맞지 않습니다. 그림책은 지문에 나오지 않습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['짧은 글', '지시어', '준비물']
      }
    }
  ],
  qaPass: 3,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedReadingBatch1Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedReadingBatch1.items.map(({ registration }) => ({
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
