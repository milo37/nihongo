import {
  withQuestionContractIdentity,
  type QuestionContractIdentity
} from '@mocks/adapters/questionContractAdapter'
import {
  createOriginalQuestion,
  type OriginalQuestionSeed
} from '@mocks/data/questions/createQuestion'

interface ApprovedN5ReadingSeed {
  readonly draftId: string
  readonly approvedSourceSha256: string
  readonly seed: OriginalQuestionSeed
  readonly contractIdentity: QuestionContractIdentity
}

// JLP-210: approved original content and the disposable JLP-238 TEST UUID mapping.
// These are mock fixtures, not proof that the removed TEST database still exists.
export const approvedN5ReadingSeeds: readonly ApprovedN5ReadingSeed[] = [
  {
    draftId: 'JLP-205-n5-reading-04-draft1',
    approvedSourceSha256:
      '16fa77f432f7bd21e8f774dc6d14b9989deb2d9451646c9b2aebda8b960b032b',
    seed: {
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
      difficulty: 'EASY',
      tags: ['짧은 글', '요청', '완료와 미완료']
    },
    contractIdentity: {
      questionId: '510cf3fc-e5c7-41c4-b188-ce0b557a5be1',
      questionVersionId: 'af3f8671-1f19-4488-956c-3cbcc992284b',
      optionIdBySourceId: {
        'n5-reading-04-option-1': '6555712d-6d4e-453b-8569-1df8ed497cdc',
        'n5-reading-04-option-2': '5e316cc0-3888-4f30-91ed-421559eb9c9b',
        'n5-reading-04-option-3': '97dee3da-1cc4-4cae-98f5-3e4714e03756',
        'n5-reading-04-option-4': 'a05d6cd0-b565-4e8c-9f70-dc519386a784'
      },
      tagIdByNormalizedLabel: {}
    }
  },
  {
    draftId: 'JLP-205-n5-reading-05-draft1',
    approvedSourceSha256:
      '80f970215ab16e31f7baed455bf1d5c7e1fedbd3a689111c757b794b3a5b433c',
    seed: {
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
      difficulty: 'NORMAL',
      tags: ['정보 찾기', '시설 안내', '조건']
    },
    contractIdentity: {
      questionId: '934f1ef1-99d7-4f07-a369-0771a97bf134',
      questionVersionId: '685cbcd6-22ba-4cd5-8aa5-60a8d6557499',
      optionIdBySourceId: {
        'n5-reading-05-option-1': '7052c841-7295-40eb-89e1-8d9d8fd60f0b',
        'n5-reading-05-option-2': '774fd313-5d54-4eec-a3f9-76a6bdfc4224',
        'n5-reading-05-option-3': '77ba44c5-daba-4419-b66e-73e799794fa6',
        'n5-reading-05-option-4': '06e1941c-7f64-4d0a-8b91-8c5414baebc9'
      },
      tagIdByNormalizedLabel: {}
    }
  },
  {
    draftId: 'JLP-205-n5-reading-06-draft1',
    approvedSourceSha256:
      'f01d66df4ab767b8e682c0a656188286cfe395cd5d6acf80dfd18f6da9ae0d48',
    seed: {
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
      difficulty: 'NORMAL',
      tags: ['짧은 글', '지시어', '준비물']
    },
    contractIdentity: {
      questionId: 'fadef91c-4e79-4bae-bb5b-9f35e64950bf',
      questionVersionId: 'b6610bd9-0d1d-4123-8c5f-1ef14c679ca1',
      optionIdBySourceId: {
        'n5-reading-06-option-1': '203ad0dd-c27e-487f-8e97-b91d2bdbe6fa',
        'n5-reading-06-option-2': '03c766c3-ebfd-4ea5-bd34-96b699f1bdcc',
        'n5-reading-06-option-3': '50d351b2-66b2-47f8-9ad8-49bf2bc1be9f',
        'n5-reading-06-option-4': 'b027ac6d-8316-4921-a1ad-0a1cd1ed8fd2'
      },
      tagIdByNormalizedLabel: {}
    }
  }
]

export const approvedN5ReadingQuestions = approvedN5ReadingSeeds.map(
  ({ seed, contractIdentity }) =>
    withQuestionContractIdentity(createOriginalQuestion(seed), contractIdentity)
)
