import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/phase7'

// JLP-212 internal review; this batch is separate from the immutable 65-question bootstrap.
export const approvedReadingBatch2 = {
  items: [
    {
      draftId: 'JLP-209-n4-reading-04-draft1',
      sha256:
        '45ceb85ca0b3f737b46c2c5491f4439dcc82501a5d86dba72de787c873ef2dc6',
      registration: {
        id: 'n4-reading-04',
        level: 'N4',
        subject: 'READING',
        questionType: 'SHORT_READING',
        passage:
          'ジャムを 全部 食べたので、びんを 捨てようと 思いました。でも、きれいに 洗うと、まだ 使えそうでした。そこで、今は その びんに 花を 入れて、部屋に 飾っています。花を 飾るための 新しい びんは 買いませんでした。',
        questionText: '「わたし」は ジャムの びんを どうしましたか。',
        options: [
          '捨てずに 花を 飾るために 使いました。',
          '洗ってから ごみ箱に 捨てました。',
          '新しく 買った びんに ジャムを 入れました。',
          'ジャムを 残したまま 部屋に 飾りました。'
        ],
        correctIndex: 0,
        explanationKo:
          '잼을 다 먹은 뒤 병을 버리려 했지만, 씻어 보니 다시 쓸 수 있어 현재 꽃을 담아 장식하고 있습니다. 따라서 버리지 않고 꽃을 장식하는 데 사용했다는 선택이 맞습니다. 씻은 뒤 버렸다는 선택은 현재 사용하고 있다는 내용과 다릅니다. 새 병은 사지 않았으며 잼도 이미 다 먹었습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['짧은 글', '행동 변화', '재사용']
      }
    },
    {
      draftId: 'JLP-209-n4-reading-05-draft1',
      sha256:
        'bd0b6ea588b7294aa0ae1ba4fb258edbf42d9e506fb3ac96a18cf4688698af5c',
      registration: {
        id: 'n4-reading-05',
        level: 'N4',
        subject: 'READING',
        questionType: 'INFO_RETRIEVAL',
        passage:
          '映画館の 料金\n大人：1,200円\n学生：800円（学生証を 見せて ください）\n火曜日は 大人も 学生も 700円です。\nほかの 割引と 一緒には 使えません。',
        questionText:
          '学生の 山田さんは 火曜日に 映画を 見ます。学生証を 持っています。いくら 払いますか。',
        options: ['1,200円', '800円', '700円', '500円'],
        correctIndex: 2,
        explanationKo:
          '화요일에는 성인과 학생 모두 700엔이라는 특별 요금이 적용됩니다. 학생증을 가지고 있더라도 이 날은 일반 학생 요금 800엔이 아니라 700엔을 냅니다. 1,200엔은 보통 성인 요금입니다. 500엔이라는 요금은 안내에 없고 다른 할인과 함께 사용할 수도 없습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['정보 찾기', '요금', '예외 조건']
      }
    },
    {
      draftId: 'JLP-209-n4-reading-06-draft1',
      sha256:
        '851d5b6be6e19634dfd94c9965b294cd615245ad5d27843ff857cfbe6e4e1efe',
      registration: {
        id: 'n4-reading-06',
        level: 'N4',
        subject: 'READING',
        questionType: 'SHORT_READING',
        passage:
          'わたしは 日本語の 小説を 読んでみたいと 思っています。本屋で 二冊の 本を 見つけました。Aの 本は 安いですが、知らない 言葉が 多そうです。Bの 本は Aより 少し 高いですが、短い 話が 五つ 入っていて、言葉の 説明も あります。毎日 少しずつ 読みたいので、Bを 買うことに しました。',
        questionText:
          '「わたし」が Bの 本を 選んだ 理由として、本文に 合うものは どれですか。',
        options: [
          '二冊の 中で いちばん 安いからです。',
          '知らない 言葉が 一つも ないからです。',
          '一つの 長い 話を 一日で 読めるからです。',
          '短い 話と 言葉の 説明があり、少しずつ 読めそうだからです。'
        ],
        correctIndex: 3,
        explanationKo:
          '화자는 매일 조금씩 읽고 싶어 짧은 이야기 다섯 편과 단어 설명이 있는 B를 선택합니다. B가 A보다 조금 비싸므로 가장 저렴해서 선택한 것은 아닙니다. 단어 설명이 있다고 했지만 모르는 단어가 전혀 없다고 하지 않았습니다. B는 하나의 긴 이야기가 아니라 짧은 이야기 다섯 편이며 하루에 다 읽으려는 목적도 아닙니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['짧은 글', '비교', '선택 이유']
      }
    },
    {
      draftId: 'JLP-209-n4-reading-07-draft1',
      sha256:
        '6ac45b35a46bf4209a001ca83c006f9f6f7c143387745ccea910a85bd4440342',
      registration: {
        id: 'n4-reading-07',
        level: 'N4',
        subject: 'READING',
        questionType: 'SHORT_READING',
        passage:
          '日曜日に 友だちと カレーを 作りました。野菜を 切る前に、米を 洗って 炊き始めました。野菜を 切ってから、なべで 肉を 焼きました。そのあと、野菜と 水を 入れました。カレーが できたときには、ご飯も できていました。',
        questionText: '「わたしたち」が 野菜を 切る前に したことは 何ですか。',
        options: [
          '米を 洗って 炊き始めたことです。',
          'なべに 野菜と 水を 入れたことです。',
          'なべで 肉を 焼いたことです。',
          'できた カレーを 食べたことです。'
        ],
        correctIndex: 0,
        explanationKo:
          '채소를 자르기 전에 쌀을 씻고 밥을 짓기 시작했다고 명시합니다. 고기를 굽는 일은 채소를 자른 뒤이고, 채소와 물을 넣는 일은 고기를 구운 뒤입니다. 완성된 카레를 먹는 행동은 지문에 서술되지 않았으며, 적어도 채소를 자르기 전의 행동으로 제시되지 않았습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['짧은 글', '행동 순서', '요리']
      }
    },
    {
      draftId: 'JLP-209-n4-reading-08-draft1',
      sha256:
        'abae1a1d37844ea7d273483d964dfe844f76ba90029eba738ce6d5f215687d1d',
      registration: {
        id: 'n4-reading-08',
        level: 'N4',
        subject: 'READING',
        questionType: 'INFO_RETRIEVAL',
        passage:
          'マンションの ごみの 出し方\n月曜日：燃える ごみ\n水曜日：びん・缶（中を 空にして、別々の 袋に 入れてください）\n金曜日：紙\n割れた びんは 水曜日に 出さないでください。紙で 包んで、月曜日に 出してください。',
        questionText:
          '割れていない 空の びんと 空の 缶を 出したいです。どうしますか。',
        options: [
          '月曜日に、二つを 同じ 袋に 入れて 出します。',
          '水曜日に、びんと 缶を 別々の 袋に 入れて 出します。',
          '水曜日に、びんだけを 紙で 包んで 出します。',
          '金曜日に、二つを 別々の 袋に 入れて 出します。'
        ],
        correctIndex: 1,
        explanationKo:
          '질문의 병은 깨지지 않았고 병과 캔은 모두 비어 있습니다. 따라서 일반 병·캔 배출 규칙을 적용해 수요일에 각각 다른 봉투에 넣어 내놓습니다. 월요일에 종이로 싸서 내놓는 예외는 깨진 병에만 해당합니다. 같은 봉투에 넣는 것은 별도 봉투 규칙과 다르고, 병만 내놓는 선택은 두 물건을 모두 버리려는 상황을 충족하지 않습니다. 금요일은 종이 배출일입니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['정보 찾기', '분리배출', '물품별 조건']
      }
    }
  ],
  qaPass: 5,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedReadingBatch2Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedReadingBatch2.items.map(({ registration }) => ({
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
