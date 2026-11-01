import {
  adminQuestionContentInputSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/content-operations'

// JLP-262 internal QA; registration and release remain unverified.
export const approvedReadingBatch6 = {
  items: [
    {
      draftId: 'JLP-261-n5-reading-07-draft2',
      sha256:
        '857d8e9d910a49930676e7e91b3111042ee7dda95aff4ced5b0a4d8bb3eeb2c5',
      registration: {
        id: 'n5-reading-07',
        level: 'N5',
        subject: 'READING',
        questionType: 'SHORT_READING',
        questionText: 'きょう、しなかったと 書いてある ことは 何ですか。',
        options: [
          '六時に おきる こと',
          '朝ご飯を 食べる こと',
          '花に 水を あげる こと',
          '七時に 家を 出る こと'
        ],
        correctIndex: 2,
        explanationKo:
          '오늘은 여섯 시에 일어나 아침을 먹고 일곱 시에 집을 나갔다고 각각 명시했습니다. 비가 와서 꽃에는 물을 주지 않고 나갔다고 했으므로 하지 않았다고 적힌 일은 꽃에 물을 주는 것입니다. 毎朝라는 일반 습관만으로 오늘의 실행을 추정하지 않고, 오늘의 별도 서술을 근거로 삼습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['평소와 예외', '행동 확인', '비'],
        passage:
          'わたしは 毎朝 六時に おきます。家を 出る 前に 花に 水を あげます。花は 庭に あります。きょうは 六時に おきて、朝ご飯を 食べました。でも、きょうは 雨です。花に 水を あげないで、七時に 家を 出ました。'
      }
    },
    {
      draftId: 'JLP-261-n5-reading-08-draft1',
      sha256:
        '93cd417e1817b1b58a2dfda0a862301e3574db6e1d93ae029b1bb495bfddfabc',
      registration: {
        id: 'n5-reading-08',
        level: 'N5',
        subject: 'READING',
        questionType: 'SHORT_READING',
        questionText: '山田さんは、田中さんと いつ、どこで 会いたいですか。',
        options: [
          '土曜日の 一時に、駅の 前で',
          '土曜日の 三時に、駅の 前で',
          '土曜日の 一時に、映画館で',
          '土曜日の 三時に、映画館で'
        ],
        correctIndex: 0,
        explanationKo:
          '토요일 역 앞에서 만나자는 제안에 이어 점심을 먼저 먹기 위해 1시에 만나자고 했습니다. 영화 시작 3시와 영화관은 만남 이후의 일정·장소이므로 약속 시각·장소와 구별해야 합니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['약속 정보', '시각 장소', '영화'],
        passage:
          '田中さんへ。土曜日は 駅の 前で 会いましょう。映画は 三時からですが、その前に 昼ご飯を 食べたいです。一時に 会うのは どうですか。昼ご飯の 後で、映画館へ 行きましょう。山田'
      }
    },
    {
      draftId: 'JLP-261-n5-reading-09-draft1',
      sha256:
        'cba0ff47d3f2f6cb3c9b732e4a3d98788d7caf419e3e5d34f98350a0c459882a',
      registration: {
        id: 'n5-reading-09',
        level: 'N5',
        subject: 'READING',
        questionType: 'SHORT_READING',
        questionText: 'わたしは、どうして バスで 学校へ 行きますか。',
        options: [
          '自転車が ありませんから',
          '妹と 同じ 学校ですから',
          'バスで 十分ですから',
          '学校が 家から 遠いですから'
        ],
        correctIndex: 3,
        explanationKo:
          '화자의 학교는 멀어서 버스로 간다고 「わたしの学校は遠いので」에 이유가 명시되어 있습니다. 자전거가 없어서가 아니며 여동생과 같은 학교인지 또는 버스로 10분인지도 제시되지 않았습니다. 10분은 여동생의 자전거 이동 시간입니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['인물 정보', '이유', '통학'],
        passage:
          '妹は 自転車で 学校へ 行きます。学校は 家から 近くて、自転車で 十分です。わたしの 学校は 遠いので、バスで 行きます。わたしも 自転車が ありますが、学校へ 行く ときは 使いません。'
      }
    },
    {
      draftId: 'JLP-261-n5-reading-10-draft1',
      sha256:
        '3149642e6c8b01efed305d84e6a3b7e899f6f5dfc8f6b797844c8c3122ab6a3a',
      registration: {
        id: 'n5-reading-10',
        level: 'N5',
        subject: 'READING',
        questionType: 'INFO_RETRIEVAL',
        questionText: '日曜日に プールへ 行きます。正しい ものは どれですか。',
        options: [
          '午前十時からで、帽子を 持っていきます',
          '午前九時からで、帽子を 持っていきます',
          '午前九時からで、帽子を 百円で 借ります',
          '午前十時からで、タオルを 持っていっては いけません'
        ],
        correctIndex: 1,
        explanationKo:
          '일요일은 주말 시간인 오전 9시부터이며 모자를 가져오라고 했으므로 두 조건이 맞는 보기1이 정답입니다. 100엔 대여는 모자가 아니라 수건이며 수건을 가져오면 안 된다는 금지는 없습니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['정보 검색', '운영시간 준비물', '수영장'],
        passage:
          'プールの お知らせ。月曜日から 金曜日は 午前十時から 午後八時までです。土曜日と 日曜日は 午前九時から 午後六時までです。帽子を 持ってきて ください。タオルは 百円で 借りる ことが できます。'
      }
    },
    {
      draftId: 'JLP-261-n5-reading-11-draft1',
      sha256:
        'ad7e83f9d6375cc87353460af967145506e060453c645780a840587542358f2d',
      registration: {
        id: 'n5-reading-11',
        level: 'N5',
        subject: 'READING',
        questionType: 'INFO_RETRIEVAL',
        questionText: '金曜日は 雨です。二年生は、いつ、どこへ 行きますか。',
        options: [
          '九時に、教室へ',
          '九時に、体育館へ',
          '九時半に、体育館へ',
          '九時半に、庭へ'
        ],
        correctIndex: 2,
        explanationKo:
          '2학년 시각은 9시 반이며 비가 오면 장소만 체육관으로 바꾸고 시각은 바꾸지 않는다고 명시했습니다. 따라서 2학년은 9시 반에 체육관에 갑니다.',
        explanationJa: null,
        difficulty: 'NORMAL',
        tags: ['정보 검색', '조건별 장소', '학년 시간'],
        passage:
          '学校の お知らせ。金曜日に 写真を とります。一年生は 九時に 教室へ 来て ください。二年生は 九時半に 庭へ 来て ください。雨の 日は、場所を 体育館に かえます。時間は かえません。一年生は 九時、二年生は 九時半です。'
      }
    }
  ],
  qaPass: 5,
  registered: 0,
  externalEducatorReview: false
} as const

// clientItemId is a logical content ID. Import returns newly allocated database IDs.
// Keep that returned mapping for subsequent review/publish and frontend parity.
export const createApprovedReadingBatch6Import = () =>
  validateQuestionImportRequestSchema.parse({
    items: approvedReadingBatch6.items.map(({ registration }) => ({
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
