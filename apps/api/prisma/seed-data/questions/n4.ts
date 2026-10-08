import { createOriginalQuestion } from './createQuestion.js'

export const n4Questions = [
  createOriginalQuestion({
    id: 'n4-vocabulary-01',
    level: 'N4',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    questionText: '来週の「予定」を 教えてください。',
    options: ['ようじ', 'よてい', 'よやく', 'ようい'],
    correctIndex: 1,
    explanationKo:
      '「予定」는 앞으로 할 일이나 일정을 뜻하며 「よてい」라고 읽습니다.',
    explanationJa: '「予定」は「よてい」と読みます。',
    difficulty: 'EASY',
    tags: ['한자 읽기', '일정']
  }),
  createOriginalQuestion({
    id: 'n4-vocabulary-02',
    level: 'N4',
    subject: 'VOCABULARY',
    questionType: 'CONTEXT_VOCABULARY',
    questionText: '車を（　）ときは、よく 前を 見てください。',
    options: ['準備する', '説明する', '運転する', '案内する'],
    correctIndex: 2,
    explanationKo:
      '자동차와 직접 결합해 운전한다는 뜻을 만드는 동사는 「運転する」입니다.',
    difficulty: 'EASY',
    tags: ['교통', '동사']
  }),
  createOriginalQuestion({
    id: 'n4-vocabulary-03',
    level: 'N4',
    subject: 'VOCABULARY',
    questionType: 'PARAPHRASE',
    questionText: '急げば 電車に「間に合います」。近い 意味は どれですか。',
    options: [
      '電車を 長く 待ちます',
      '電車に 乗りません',
      '駅から 帰ります',
      '電車が 出る 前に 着きます'
    ],
    correctIndex: 3,
    explanationKo:
      '「間に合う」는 정해진 시각에 늦지 않게 도착한다는 뜻입니다.',
    difficulty: 'NORMAL',
    tags: ['유의 표현', '시간']
  }),
  createOriginalQuestion({
    id: 'n4-vocabulary-04',
    level: 'N4',
    subject: 'VOCABULARY',
    questionType: 'WORD_USAGE',
    questionText: '「連絡」の 使い方が 正しいものは どれですか。',
    options: [
      '着く 時間が 分かったら、連絡してください。',
      'この 荷物を 連絡して ください。',
      '朝ごはんを 連絡しました。',
      '道を 連絡して 駅へ 行きます。'
    ],
    correctIndex: 0,
    explanationKo:
      '「連絡する」는 정보를 상대에게 알린다는 뜻이므로 도착 시간을 알려 달라는 문장이 자연스럽습니다.',
    difficulty: 'NORMAL',
    tags: ['단어 용법', '연락']
  }),
  createOriginalQuestion({
    id: 'n4-vocabulary-05',
    level: 'N4',
    subject: 'VOCABULARY',
    questionType: 'ORTHOGRAPHY',
    questionText: '旅行の「じゅんび」を しています。正しい 漢字は どれですか。',
    options: ['支度', '準備', '順番', '用意'],
    correctIndex: 1,
    explanationKo:
      '「じゅんび」의 한자 표기는 「準備」입니다. 「用意」「支度」도 비슷한 뜻이지만 해당 읽기의 표기는 아닙니다.',
    difficulty: 'NORMAL',
    tags: ['한자 표기', '여행']
  }),
  createOriginalQuestion({
    id: 'n4-grammar-01',
    level: 'N4',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '毎日 練習して、漢字が 読める（　）なりました。',
    options: ['ために', 'ところに', 'ように', 'そうに'],
    correctIndex: 2,
    explanationKo:
      '능력이나 상태의 변화를 나타낼 때 가능형 뒤에 「ようになる」를 사용합니다.',
    difficulty: 'NORMAL',
    tags: ['상태 변화', '가능형']
  }),
  createOriginalQuestion({
    id: 'n4-grammar-02',
    level: 'N4',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '音楽を 聞き（　）、料理を しました。',
    options: ['まで', 'しか', 'など', 'ながら'],
    correctIndex: 3,
    explanationKo:
      '두 행동을 동시에 할 때 동사 ます형 어간에 「ながら」를 붙입니다.',
    difficulty: 'NORMAL',
    tags: ['동시 동작', 'ながら']
  }),
  createOriginalQuestion({
    id: 'n4-grammar-03',
    level: 'N4',
    subject: 'GRAMMAR',
    questionType: 'TEXT_GRAMMAR',
    questionText: '大切な かさを 電車に 忘れて（　）。',
    options: ['しまいました', 'ありました', 'おきました', 'みました'],
    correctIndex: 0,
    explanationKo:
      '유감스럽게 행동이 완료된 상황에는 「てしまう」를 사용합니다. 우산을 두고 내린 아쉬움을 나타냅니다.',
    difficulty: 'NORMAL',
    tags: ['완료', '유감']
  }),
  createOriginalQuestion({
    id: 'n4-grammar-04',
    level: 'N4',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '日曜日は 家族と 動物園へ 行く（　）です。',
    options: ['場合', '予定', '経験', '必要'],
    correctIndex: 1,
    explanationKo:
      '앞으로 정해진 계획은 동사 기본형에 「予定です」를 붙여 나타냅니다.',
    difficulty: 'EASY',
    tags: ['계획', '予定']
  }),
  createOriginalQuestion({
    id: 'n4-grammar-05',
    level: 'N4',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '空が 暗いので、もうすぐ 雨が 降る（　）。',
    options: [
      'ほうがいいです',
      'つもりです',
      'かもしれません',
      'ことができます'
    ],
    correctIndex: 2,
    explanationKo:
      '확실하지 않은 가능성을 나타낼 때 「かもしれません」을 사용합니다.',
    difficulty: 'NORMAL',
    tags: ['추측', '가능성']
  }),
  createOriginalQuestion({
    id: 'n4-reading-01',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING',
    passage:
      '佐藤さん、会議は 二時から 三時に 変わりました。部屋は 前と 同じ 301号室です。資料を 十部 持ってきてください。',
    questionText: '佐藤さんが しなければならないことは 何ですか。',
    options: [
      '二時に 部屋を 変える',
      '三時に 301号室を 予約する',
      '新しい 部屋を 探す',
      '資料を 十部 持っていく'
    ],
    correctIndex: 3,
    explanationKo:
      '마지막 문장에서 자료 10부를 가져오라고 요청했습니다. 회의 시각만 바뀌었고 방은 이전과 같습니다.',
    difficulty: 'NORMAL',
    tags: ['업무 메모', '정보 확인']
  }),
  createOriginalQuestion({
    id: 'n4-reading-02',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    passage:
      '市民プール：平日は 午前十時から 午後八時まで。土日は 午前九時から 午後六時まで。毎月 第一火曜日は 清掃のため 休み。',
    questionText: 'プールを 利用できないのは いつですか。',
    options: [
      '第一火曜日の 午後三時',
      '水曜日の 午後七時',
      '土曜日の 午前十時',
      '日曜日の 午後五時'
    ],
    correctIndex: 0,
    explanationKo:
      '매달 첫째 화요일은 청소로 휴관합니다. 나머지 선택지는 각각 평일·주말 운영시간 안입니다.',
    difficulty: 'NORMAL',
    tags: ['안내문', '운영시간']
  }),
  createOriginalQuestion({
    id: 'n4-reading-03',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING',
    passage:
      'わたしは 先月から 自転車で 会社へ 通っています。電車より 少し 時間が かかりますが、朝の 運動になるので 気に入っています。雨の 日だけは 電車に 乗ります。',
    questionText: '「わたし」が 自転車で 通う 理由は 何ですか。',
    options: [
      '会社が とても 遠いから',
      '朝の 運動に なるから',
      '電車より 早いから',
      '雨の 日が 好きだから'
    ],
    correctIndex: 1,
    explanationKo:
      '자전거는 전철보다 시간이 조금 더 걸리지만 아침 운동이 되어 마음에 든다고 했습니다. 빠르기 때문은 아닙니다.',
    difficulty: 'NORMAL',
    tags: ['생활문', '이유 파악']
  })
]
