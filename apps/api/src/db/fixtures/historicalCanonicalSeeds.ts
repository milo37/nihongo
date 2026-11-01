import {
  buildQuestionAggregateSeed,
  type QuestionAggregateSeed
} from '../../../prisma/seed-data/buildQuestionSeed.js'
import { toStableSeedUuid } from '../../../prisma/seed-data/id.js'
import { createOriginalQuestion } from '../../../prisma/seed-data/questions/createQuestion.js'

// Historical Phase 6 inputs from 58a36c11dacb0c40818993585465093eaa006018.
// n5.ts blob 8ca0ccab29bb0a9b1023f7b982526c92ff563db2; SHA256 bf2003b93b431d84087641fd84bdb9d1a20e22e3aa186c320357bea8bb773a86.
const n5Questions = [
  createOriginalQuestion({
    id: 'n5-vocabulary-01',
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    questionText: '「川」の 読み方は どれですか。',
    options: ['かわ', 'やま', 'うみ', 'そら'],
    correctIndex: 0,
    explanationKo: '「川」는 물이 흐르는 강을 뜻하며 「かわ」라고 읽습니다.',
    explanationJa: '「川」は「かわ」と読みます。',
    difficulty: 'EASY',
    tags: ['한자 읽기', '자연']
  }),
  createOriginalQuestion({
    id: 'n5-vocabulary-02',
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'CONTEXT_VOCABULARY',
    questionText: 'わたしは 毎朝 七時に（　）。',
    options: ['あそびます', 'おきます', 'ねます', 'あらいます'],
    correctIndex: 1,
    explanationKo:
      '아침 7시에 하는 동작으로 자연스러운 것은 「おきます(일어납니다)」입니다.',
    difficulty: 'EASY',
    tags: ['일상', '동사']
  }),
  createOriginalQuestion({
    id: 'n5-vocabulary-03',
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'PARAPHRASE',
    questionText: 'この へやは とても「しずか」です。近い 意味は どれですか。',
    options: ['とても 明るい', '少し せまい', '音が 小さい', '人が 多い'],
    correctIndex: 2,
    explanationKo:
      '「しずか」는 소리나 움직임이 적어 조용하다는 뜻이므로 「音が小さい」가 가장 가깝습니다.',
    difficulty: 'EASY',
    tags: ['유의어', '형용동사']
  }),
  createOriginalQuestion({
    id: 'n5-vocabulary-04',
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'ORTHOGRAPHY',
    questionText: '「がっこう」を 漢字で 書くと どれですか。',
    options: ['学生', '会社', '教室', '学校'],
    correctIndex: 3,
    explanationKo:
      '「がっこう」의 한자 표기는 「学校」입니다. 「学生」은 학생, 「教室」는 교실입니다.',
    difficulty: 'EASY',
    tags: ['한자 표기', '학교']
  }),
  createOriginalQuestion({
    id: 'n5-vocabulary-05',
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'WORD_USAGE',
    questionText: '「あたらしい」の 使い方が 正しいものは どれですか。',
    options: [
      'きのう、あたらしい くつを 買いました。',
      '雨が あたらしく ふっています。',
      '駅まで あたらしく 歩きます。',
      'この 水は あたらしいですから、つめたいです。'
    ],
    correctIndex: 0,
    explanationKo:
      '「あたらしい」는 새 물건이나 새 상태를 나타내는 い형용사로, 새 신발을 샀다는 문장이 자연스럽습니다.',
    difficulty: 'NORMAL',
    tags: ['단어 용법', 'い형용사']
  }),
  createOriginalQuestion({
    id: 'n5-grammar-01',
    level: 'N5',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '図書館（　）本を 読みます。',
    options: ['と', 'で', 'を', 'へ'],
    correctIndex: 1,
    explanationKo:
      '행동이 일어나는 장소에는 조사 「で」를 사용합니다. 도서관에서 책을 읽는다는 뜻입니다.',
    difficulty: 'EASY',
    tags: ['조사', '장소']
  }),
  createOriginalQuestion({
    id: 'n5-grammar-02',
    level: 'N5',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: 'つくえの 上に 本（　）あります。',
    options: ['で', 'から', 'が', 'を'],
    correctIndex: 2,
    explanationKo:
      '무생물의 존재를 나타내는 「あります」 앞에서 존재하는 대상을 조사 「が」로 표시합니다.',
    difficulty: 'EASY',
    tags: ['존재문', '조사']
  }),
  createOriginalQuestion({
    id: 'n5-grammar-03',
    level: 'N5',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: 'いっしょに 映画を 見（　）か。',
    options: ['ない', 'ませんでした', 'なく', 'ません'],
    correctIndex: 3,
    explanationKo:
      '상대에게 함께 하자고 권할 때 동사의 ます형 어간에 「ませんか」를 붙입니다.',
    difficulty: 'EASY',
    tags: ['권유', '동사 활용']
  }),
  createOriginalQuestion({
    id: 'n5-grammar-04',
    level: 'N5',
    subject: 'GRAMMAR',
    questionType: 'TEXT_GRAMMAR',
    questionText: '今日は さむいです（　）、コートを 着ます。',
    options: ['から', 'まで', 'でも', 'しか'],
    correctIndex: 0,
    explanationKo:
      '앞 문장이 뒤 행동의 이유이므로 이유를 나타내는 접속 조사 「から」가 알맞습니다.',
    difficulty: 'NORMAL',
    tags: ['이유', '접속']
  }),
  createOriginalQuestion({
    id: 'n5-grammar-05',
    level: 'N5',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText:
      '「日本語を 少し 話すことが できます。」と 同じ 意味の 文は どれですか。',
    options: [
      '日本語は わたしを 少し します。',
      'わたしは 日本語が 少し できます。',
      'わたしが 日本語を 少し あります。',
      'わたしは 少し 日本語に います。'
    ],
    correctIndex: 1,
    explanationKo:
      '능력을 나타내는 「できます」는 가능한 대상을 보통 조사 「が」로 받습니다.',
    difficulty: 'NORMAL',
    tags: ['가능 표현', '어순']
  }),
  createOriginalQuestion({
    id: 'n5-reading-01',
    level: 'N5',
    subject: 'READING',
    questionType: 'SHORT_READING',
    passage:
      '田中さんへ。今日は 五時まで 仕事を します。六時に 駅の 前で 会いましょう。山田',
    questionText: '二人は どこで 会いますか。',
    options: ['田中さんの 家', '山田さんの 学校', '駅の 前', '会社の 中'],
    correctIndex: 2,
    explanationKo:
      '지문에 「六時に駅の前で会いましょう」라고 명시되어 있습니다. 회사는 일하는 장소일 뿐 만남의 장소가 아닙니다.',
    difficulty: 'EASY',
    tags: ['짧은 글', '약속']
  }),
  createOriginalQuestion({
    id: 'n5-reading-02',
    level: 'N5',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    passage:
      'パン屋「こむぎ」営業時間：朝八時から 午後六時まで。月曜日は 休みです。',
    questionText: 'パンを 買うことが できるのは いつですか。',
    options: [
      '月曜日の 午前十時',
      '水曜日の 午後七時',
      '日曜日の 午前七時',
      '火曜日の 午前九時'
    ],
    correctIndex: 3,
    explanationKo:
      '화요일 오전 9시는 영업시간인 오전 8시~오후 6시 안입니다. 월요일은 휴무이고 나머지 시간은 영업시간 밖입니다.',
    difficulty: 'EASY',
    tags: ['정보 찾기', '시간표']
  }),
  createOriginalQuestion({
    id: 'n5-reading-03',
    level: 'N5',
    subject: 'READING',
    questionType: 'SHORT_READING',
    passage:
      'きのうは 雨でしたから、うちで 本を 読みました。今日は 晴れです。午後、友だちと 公園へ 行きます。',
    questionText: '「わたし」は 今日の 午後、何を しますか。',
    options: [
      '友だちと 公園へ 行きます。',
      'うちで 本を 読みます。',
      '一人で 買い物を します。',
      '雨の 中を 歩きます。'
    ],
    correctIndex: 0,
    explanationKo:
      '오늘 오후에는 친구와 공원에 간다고 했습니다. 집에서 책을 읽은 것은 비가 온 어제의 일입니다.',
    difficulty: 'NORMAL',
    tags: ['짧은 글', '시제']
  })
]

const n4Questions = [
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

const n3Questions = [
  createOriginalQuestion({
    id: 'n3-vocabulary-01',
    level: 'N3',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    questionText: '天気は 売り上げに「影響」を 与える。',
    options: ['かんきょう', 'じょうきょう', 'えいきょう', 'えいぎょう'],
    correctIndex: 2,
    explanationKo:
      '「影響」는 다른 것에 작용해 변화를 주는 것을 뜻하며 「えいきょう」라고 읽습니다.',
    difficulty: 'NORMAL',
    tags: ['한자 읽기', '추상 명사']
  }),
  createOriginalQuestion({
    id: 'n3-vocabulary-02',
    level: 'N3',
    subject: 'VOCABULARY',
    questionType: 'CONTEXT_VOCABULARY',
    questionText:
      '申し込みの 内容に 間違いが ないか、もう一度（　）してください。',
    options: ['発見', '決定', '理解', '確認'],
    correctIndex: 3,
    explanationKo:
      '내용에 틀림이 없는지 다시 살펴보는 행동은 「確認する(확인하다)」입니다.',
    difficulty: 'NORMAL',
    tags: ['업무', '동작성 명사']
  }),
  createOriginalQuestion({
    id: 'n3-vocabulary-03',
    level: 'N3',
    subject: 'VOCABULARY',
    questionType: 'PARAPHRASE',
    questionText:
      '忙しかったので、友だちの 誘いを「断った」。近い 意味は どれですか。',
    options: [
      '行けないと 伝えた',
      '喜んで 引き受けた',
      '時間を 変更した',
      '別の 人を 誘った'
    ],
    correctIndex: 0,
    explanationKo:
      '「断る」는 요청이나 권유를 받아들이지 않는다는 뜻이므로 갈 수 없다고 전한 것이 가깝습니다.',
    difficulty: 'NORMAL',
    tags: ['유의 표현', '의사 전달']
  }),
  createOriginalQuestion({
    id: 'n3-vocabulary-04',
    level: 'N3',
    subject: 'VOCABULARY',
    questionType: 'WORD_USAGE',
    questionText: '「たまたま」の 使い方が 正しいものは どれですか。',
    options: [
      '必ず たまたま 連絡してください。',
      '駅で たまたま 昔の 友人に 会った。',
      '毎朝 たまたま 七時に 起きる。',
      '計画どおりに たまたま 作業した。'
    ],
    correctIndex: 1,
    explanationKo:
      '「たまたま」는 의도하지 않은 우연을 나타냅니다. 역에서 옛 친구를 우연히 만났다는 문장이 자연스럽습니다.',
    difficulty: 'NORMAL',
    tags: ['부사', '우연']
  }),
  createOriginalQuestion({
    id: 'n3-vocabulary-05',
    level: 'N3',
    subject: 'VOCABULARY',
    questionType: 'ORTHOGRAPHY',
    questionText: 'この町では 外国人の 住民が「ぞうか」している。',
    options: ['追加', '上昇', '増加', '増大'],
    correctIndex: 2,
    explanationKo:
      '수나 양이 늘어남을 뜻하는 「ぞうか」의 표기는 「増加」입니다.',
    difficulty: 'NORMAL',
    tags: ['한자 표기', '변화']
  }),
  createOriginalQuestion({
    id: 'n3-grammar-01',
    level: 'N3',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: 'この 建物では、夜十時以降は 入れない（　）。',
    options: [
      'ことにしている',
      'ようになりたい',
      'はずがない',
      'ことになっている'
    ],
    correctIndex: 3,
    explanationKo:
      '시설의 정해진 규칙을 설명하므로 객관적인 결정·규칙을 나타내는 「ことになっている」가 알맞습니다.',
    difficulty: 'NORMAL',
    tags: ['규칙', 'ことになる']
  }),
  createOriginalQuestion({
    id: 'n3-grammar-02',
    level: 'N3',
    subject: 'GRAMMAR',
    questionType: 'TEXT_GRAMMAR',
    questionText:
      '田中さんは さっき 昼ご飯を 食べた（　）なのに、もう おなかが すいたそうだ。',
    options: ['ばかり', 'ほど', 'だけ', 'しか'],
    correctIndex: 0,
    explanationKo:
      '행동이 끝난 지 얼마 되지 않았음을 나타내는 「たばかり」가 문맥에 맞습니다.',
    difficulty: 'NORMAL',
    tags: ['직후', 'ばかり']
  }),
  createOriginalQuestion({
    id: 'n3-grammar-03',
    level: 'N3',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '地域（　）、ごみの 分け方が 違います。',
    options: ['に対して', 'によって', 'にとって', 'について'],
    correctIndex: 1,
    explanationKo:
      '지역에 따라 방법이 달라진다는 기준·차이를 나타내므로 「によって」를 사용합니다.',
    difficulty: 'NORMAL',
    tags: ['기준', 'によって']
  }),
  createOriginalQuestion({
    id: 'n3-grammar-04',
    level: 'N3',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '日本で 働く（　）、毎日 日本語を 勉強しています。',
    options: ['ばかりに', 'ところに', 'ために', 'そうに'],
    correctIndex: 2,
    explanationKo:
      '일본에서 일한다는 목적을 위해 공부하므로 목적을 나타내는 「ために」가 알맞습니다.',
    difficulty: 'NORMAL',
    tags: ['목적', 'ために']
  }),
  createOriginalQuestion({
    id: 'n3-grammar-05',
    level: 'N3',
    subject: 'GRAMMAR',
    questionType: 'TEXT_GRAMMAR',
    questionText: '高い 料理が いつも おいしい（　）。',
    options: [
      'に決まっています',
      'ことがあります',
      'はずでした',
      'わけではありません'
    ],
    correctIndex: 3,
    explanationKo:
      '가격이 비싸다고 해서 언제나 맛있는 것은 아니라는 부분 부정을 나타내므로 「わけではない」가 맞습니다.',
    difficulty: 'HARD',
    tags: ['부분 부정', 'わけではない']
  }),
  createOriginalQuestion({
    id: 'n3-reading-01',
    level: 'N3',
    subject: 'READING',
    questionType: 'SHORT_READING',
    passage:
      '会社では 来月から 紙の コップを やめ、各自が 自分の コップを 使うことになった。ごみを 減らすためだ。忘れた 人には コップを 貸すが、使用後は 自分で 洗う 必要がある。',
    questionText: '会社が 紙の コップを やめる 目的は 何ですか。',
    options: [
      'ごみを 減らすため',
      'コップを 売るため',
      '洗う 時間を 減らすため',
      '社員を 増やすため'
    ],
    correctIndex: 0,
    explanationKo:
      '둘째 문장에 종이컵을 없애는 이유가 쓰레기를 줄이기 위해서라고 명시되어 있습니다. 대여나 세척은 운영 방법일 뿐 목적이 아닙니다.',
    difficulty: 'NORMAL',
    tags: ['설명문', '목적 파악']
  }),
  createOriginalQuestion({
    id: 'n3-reading-02',
    level: 'N3',
    subject: 'READING',
    questionType: 'MEDIUM_READING',
    passage:
      '最近、昼休みに 短い 散歩を するようになった。以前は 机で 食事を して、そのまま 仕事を 続けていた。しかし、午後になると 集中できないことが 多かった。十分ほど 外を 歩くと、気持ちを 切り替えやすくなり、午後の 作業も 進むようになった。',
    questionText: '筆者は 散歩を 始めて、どう 変わりましたか。',
    options: [
      '散歩に 一時間 かけるようになった',
      '午後の 作業に 集中しやすくなった',
      '昼ご飯を 食べなくなった',
      '午前の 仕事が 減った'
    ],
    correctIndex: 1,
    explanationKo:
      '10분 정도 걸은 뒤 기분 전환이 쉬워지고 오후 작업도 잘 진행된다고 했습니다. 식사를 거르거나 한 시간 걷는다는 내용은 없습니다.',
    difficulty: 'NORMAL',
    tags: ['중문 독해', '변화 파악']
  }),
  createOriginalQuestion({
    id: 'n3-reading-03',
    level: 'N3',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    passage:
      '料理教室のお知らせ：Aコースは 水曜午後七時、初心者向け。Bコースは 土曜午前十時、経験者向け。どちらも 四回で 料金は同じです。申し込みは 開始日の 一週間前までです。',
    questionText: '料理の 経験が ない 人が 申し込むなら、どれが 適切ですか。',
    options: [
      'Aコースに 土曜日の 朝 参加する',
      'Bコースに 水曜日の 夜 参加する',
      'Aコースに 開始日の 一週間前までに 申し込む',
      'Bコースに 開始した 後で 申し込む'
    ],
    correctIndex: 2,
    explanationKo:
      '초보자는 수요일 오후 7시의 A코스가 적합하며 시작 일주일 전까지 신청해야 합니다. B코스는 경험자용입니다.',
    difficulty: 'NORMAL',
    tags: ['정보 검색', '강좌 안내']
  })
]

const n2Questions = [
  createOriginalQuestion({
    id: 'n2-vocabulary-01',
    level: 'N2',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    questionText: 'この 判断は「妥当」だと 思います。',
    options: ['だどう', 'たとう', 'たどう', 'だとう'],
    correctIndex: 3,
    explanationKo:
      '「妥当」는 사정에 잘 맞아 적절하다는 뜻이며 「だとう」라고 읽습니다.',
    difficulty: 'NORMAL',
    tags: ['한자 읽기', '평가']
  }),
  createOriginalQuestion({
    id: 'n2-vocabulary-02',
    level: 'N2',
    subject: 'VOCABULARY',
    questionType: 'CONTEXT_VOCABULARY',
    questionText: '市は 自転車の 利用を（　）するため、駐輪場を 増やした。',
    options: ['促進', '防止', '中断', '制限'],
    correctIndex: 0,
    explanationKo:
      '주차장을 늘린 목적은 자전거 이용을 활발하게 만드는 것이므로 「促進する(촉진하다)」가 맞습니다.',
    difficulty: 'NORMAL',
    tags: ['정책', '추상 동사']
  }),
  createOriginalQuestion({
    id: 'n2-vocabulary-03',
    level: 'N2',
    subject: 'VOCABULARY',
    questionType: 'PARAPHRASE',
    questionText:
      '来年度は 利用者の 増加を「見込んでいる」。近い 意味は どれですか。',
    options: [
      '増加を 心配していない',
      '増えると 予想している',
      '減らすと 決定している',
      'すでに 確認している'
    ],
    correctIndex: 1,
    explanationKo:
      '「見込む」는 앞으로 그렇게 될 것이라고 예상한다는 뜻입니다.',
    difficulty: 'NORMAL',
    tags: ['유의 표현', '예측']
  }),
  createOriginalQuestion({
    id: 'n2-vocabulary-04',
    level: 'N2',
    subject: 'VOCABULARY',
    questionType: 'WORD_USAGE',
    questionText: '「踏まえる」の 使い方が 正しいものは どれですか。',
    options: [
      '朝食を 踏まえて、会社へ 行った。',
      '音楽を 踏まえて、静かに 聞いた。',
      '調査結果を 踏まえて、計画を 見直した。',
      '階段を 踏まえて、駅に 着いた。'
    ],
    correctIndex: 2,
    explanationKo:
      '「〜を踏まえて」는 어떤 사실이나 결과를 근거로 삼는다는 뜻으로, 조사 결과를 바탕으로 계획을 재검토했다는 문장이 자연스럽습니다.',
    difficulty: 'HARD',
    tags: ['단어 용법', '업무 표현']
  }),
  createOriginalQuestion({
    id: 'n2-vocabulary-05',
    level: 'N2',
    subject: 'VOCABULARY',
    questionType: 'ORTHOGRAPHY',
    questionText: '新しい 制度には 費用面の「けねん」が 残る。',
    options: ['権限', '概念', '懇願', '懸念'],
    correctIndex: 3,
    explanationKo: '걱정되는 점을 뜻하는 「けねん」은 「懸念」으로 표기합니다.',
    difficulty: 'NORMAL',
    tags: ['한자 표기', '우려']
  }),
  createOriginalQuestion({
    id: 'n2-grammar-01',
    level: 'N2',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '強い 雨（　）、多くの 人が 会場に 集まった。',
    options: ['にもかかわらず', 'にしたがって', 'に加えて', 'に比べて'],
    correctIndex: 0,
    explanationKo:
      '강한 비라는 예상 밖의 조건에도 사람들이 모였다는 역접이므로 「にもかかわらず」가 알맞습니다.',
    difficulty: 'NORMAL',
    tags: ['역접', 'にもかかわらず']
  }),
  createOriginalQuestion({
    id: 'n2-grammar-02',
    level: 'N2',
    subject: 'GRAMMAR',
    questionType: 'TEXT_GRAMMAR',
    questionText: '電車が 止まったので、会議を 延期せ（　）。',
    options: [
      'るわけがなかった',
      'ざるを得なかった',
      'ずにはおかなかった',
      'ないこともなかった'
    ],
    correctIndex: 1,
    explanationKo:
      '외부 사정 때문에 어쩔 수 없이 연기했다는 의미에는 「ざるを得ない」를 사용합니다.',
    difficulty: 'HARD',
    tags: ['불가피', 'ざるを得ない']
  }),
  createOriginalQuestion({
    id: 'n2-grammar-03',
    level: 'N2',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '窓が 開いていた（　）、誰かが 入った 可能性がある。',
    options: ['ことには', 'ことだから', 'ことから', 'ことなく'],
    correctIndex: 2,
    explanationKo:
      '창문이 열려 있었다는 사실을 판단의 근거로 삼으므로 「ことから」가 맞습니다.',
    difficulty: 'NORMAL',
    tags: ['근거', 'ことから']
  }),
  createOriginalQuestion({
    id: 'n2-grammar-04',
    level: 'N2',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '契約を 結ぶ（　）、内容を 十分に 確認してください。',
    options: ['に反して', 'に応じて', 'に代わって', 'に際して'],
    correctIndex: 3,
    explanationKo:
      '계약을 맺는 중요한 시점에 해야 할 일을 말하므로 「に際して」가 적절합니다.',
    difficulty: 'NORMAL',
    tags: ['시점', '격식 표현']
  }),
  createOriginalQuestion({
    id: 'n2-grammar-05',
    level: 'N2',
    subject: 'GRAMMAR',
    questionType: 'TEXT_GRAMMAR',
    questionText: '実物を 見（　）、買うか どうか 決められない。',
    options: ['ないことには', 'ないばかりか', 'ないものでも', 'ないまでも'],
    correctIndex: 0,
    explanationKo:
      '실물을 보는 것이 판단을 위한 필수 조건이므로 「ないことには〜ない」 구문이 맞습니다.',
    difficulty: 'HARD',
    tags: ['필수 조건', 'ないことには']
  }),
  createOriginalQuestion({
    id: 'n2-reading-01',
    level: 'N2',
    subject: 'READING',
    questionType: 'MEDIUM_READING',
    passage:
      '便利な 道具が 増えると、作業時間は 短くなる。しかし、空いた 時間に 別の 作業を 詰め込めば、忙しさは 変わらない。大切なのは、効率化で 生まれた 時間を 何に 使うかを あらかじめ 決めておくことだ。',
    questionText: '筆者が 最も 言いたいことは 何ですか。',
    options: [
      '作業時間を 短くすることは 不可能だ',
      '効率化で 生まれた 時間の 使い方を 決めるべきだ',
      '便利な 道具は 使わないほうがよい',
      '空いた 時間には 必ず 別の 仕事をするべきだ'
    ],
    correctIndex: 1,
    explanationKo:
      '필자는 효율화 자체보다 생긴 시간을 무엇에 쓸지 미리 정하는 것이 중요하다고 결론 내립니다. 도구를 부정하거나 추가 업무를 권하지 않습니다.',
    difficulty: 'NORMAL',
    tags: ['주장 파악', '업무 효율']
  }),
  createOriginalQuestion({
    id: 'n2-reading-02',
    level: 'N2',
    subject: 'READING',
    questionType: 'MEDIUM_READING',
    passage:
      '店で 商品を 選ぶとき、選択肢が 多いほど 満足できると 思われがちだ。ところが、数が 多すぎると 比較に 疲れ、選ぶこと自体を やめる 人もいる。店側には、品数を 増やすだけでなく、違いを 分かりやすく 示す 工夫が 求められる。',
    questionText: '店側に 必要だと 筆者が 考えていることは 何ですか。',
    options: [
      '選択肢を 無条件に 増やし続けること',
      '客が 比較するのを 禁止すること',
      '商品の 違いを 分かりやすく 伝えること',
      'すべての 商品を 同じ 値段にすること'
    ],
    correctIndex: 2,
    explanationKo:
      '마지막 문장에서 상품 수를 늘리는 것뿐 아니라 차이를 알기 쉽게 보여주는 궁리가 필요하다고 했습니다. 가격 통일이나 비교 금지는 언급하지 않았습니다.',
    difficulty: 'HARD',
    tags: ['논지 파악', '소비 행동']
  }),
  createOriginalQuestion({
    id: 'n2-reading-03',
    level: 'N2',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    passage:
      '研究発表会：午前の部は 九時半開始で、受付は 九時まで。午後の部は 一時半開始で、受付は 一時まで。発表者は 開始三十分前の 打ち合わせに 必ず 参加すること。一般参加者は 当日受付も可能。',
    questionText:
      '午後の部で 発表する 人は、遅くとも 何時までに 来る 必要がありますか。',
    options: ['午後一時半', '正午', '午後二時', '午後一時'],
    correctIndex: 3,
    explanationKo:
      '오후 부 시작은 1시 30분이고 발표자는 30분 전 회의에 반드시 참석해야 하므로 늦어도 1시까지 와야 합니다.',
    difficulty: 'NORMAL',
    tags: ['정보 검색', '행사 안내']
  })
]

const n1Questions = [
  createOriginalQuestion({
    id: 'n1-vocabulary-01',
    level: 'N1',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    questionText: 'その 結果は 重要な 可能性を「示唆」している。',
    options: ['しさ', 'ししゃ', 'じさ', 'じしゃ'],
    correctIndex: 0,
    explanationKo:
      '「示唆」는 직접 말하지 않고 암시해 알게 한다는 뜻이며 「しさ」라고 읽습니다.',
    difficulty: 'NORMAL',
    tags: ['한자 읽기', '논문 표현']
  }),
  createOriginalQuestion({
    id: 'n1-vocabulary-02',
    level: 'N1',
    subject: 'VOCABULARY',
    questionType: 'CONTEXT_VOCABULARY',
    questionText: '新しい 制度は、従来の 方針を ほぼ（　）している。',
    options: ['転換', '踏襲', '撤回', '排除'],
    correctIndex: 1,
    explanationKo:
      '기존 방침을 거의 그대로 이어받았다는 문맥이므로 「踏襲する(답습하다)」가 맞습니다.',
    difficulty: 'HARD',
    tags: ['정책', '고급 어휘']
  }),
  createOriginalQuestion({
    id: 'n1-vocabulary-03',
    level: 'N1',
    subject: 'VOCABULARY',
    questionType: 'PARAPHRASE',
    questionText:
      '小さな 変化を「見過ごして」は ならない。近い 意味は どれですか。',
    options: [
      '大きく 評価して',
      '事前に 予測して',
      '気づいても そのままにして',
      '細かく 記録して'
    ],
    correctIndex: 2,
    explanationKo:
      '「見過ごす」는 보았거나 알아차리고도 문제 삼지 않고 넘긴다는 뜻입니다.',
    difficulty: 'NORMAL',
    tags: ['유의 표현', '판단']
  }),
  createOriginalQuestion({
    id: 'n1-vocabulary-04',
    level: 'N1',
    subject: 'VOCABULARY',
    questionType: 'ORTHOGRAPHY',
    questionText: '需要が 急増し、在庫が「ひっぱく」している。',
    options: ['切迫', '圧迫', '緊迫', '逼迫'],
    correctIndex: 3,
    explanationKo:
      '여유가 없어 바짝 닥친 상태를 뜻하는 「ひっぱく」은 「逼迫」으로 표기합니다. 「切迫」는 보통 사태나 기한이 임박한 경우에 씁니다.',
    difficulty: 'HARD',
    tags: ['한자 표기', '수급']
  }),
  createOriginalQuestion({
    id: 'n1-vocabulary-05',
    level: 'N1',
    subject: 'VOCABULARY',
    questionType: 'WORD_USAGE',
    questionText: '「乖離」の 使い方が 正しいものは どれですか。',
    options: [
      '計画と 実際の 結果に 乖離が 生じた。',
      '会議で 意見を 乖離して 発表した。',
      '駅まで 道を 乖離して 歩いた。',
      '資料を 乖離に 並べておいた。'
    ],
    correctIndex: 0,
    explanationKo:
      '「乖離」는 서로 밀접해야 할 두 대상이 어긋나 떨어지는 것을 뜻하므로 계획과 실제 결과의 차이에 사용한 문장이 맞습니다.',
    difficulty: 'HARD',
    tags: ['단어 용법', '차이']
  }),
  createOriginalQuestion({
    id: 'n1-grammar-01',
    level: 'N1',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '東京公演（　）、全国十都市で 上演される。',
    options: ['をもって', 'を皮切りに', 'をよそに', 'を限りに'],
    correctIndex: 1,
    explanationKo:
      '도쿄 공연을 시작으로 전국 공연이 이어진다는 뜻이므로 「を皮切りに」가 맞습니다.',
    difficulty: 'HARD',
    tags: ['시작점', 'を皮切りに']
  }),
  createOriginalQuestion({
    id: 'n1-grammar-02',
    level: 'N1',
    subject: 'GRAMMAR',
    questionType: 'TEXT_GRAMMAR',
    questionText:
      '専門家に 聞く（　）、この 数字だけでも 問題の 深刻さは 分かる。',
    options: ['にかたくなく', 'べからず', 'までもなく', 'にたえず'],
    correctIndex: 2,
    explanationKo:
      '전문가에게 물을 필요조차 없이 알 수 있다는 뜻이므로 「までもなく」가 적절합니다.',
    difficulty: 'HARD',
    tags: ['불필요', 'までもなく']
  }),
  createOriginalQuestion({
    id: 'n1-grammar-03',
    level: 'N1',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: 'この 繊細な 技術は、長年 経験を 積んだ 職人（　）のものだ。',
    options: ['たるもの', 'にひきかえ', 'をおいて', 'ならでは'],
    correctIndex: 3,
    explanationKo:
      '숙련된 장인에게만 가능한 고유한 기술이라는 긍정적 평가에는 「ならでは」를 사용합니다.',
    difficulty: 'HARD',
    tags: ['고유함', 'ならでは']
  }),
  createOriginalQuestion({
    id: 'n1-grammar-04',
    level: 'N1',
    subject: 'GRAMMAR',
    questionType: 'TEXT_GRAMMAR',
    questionText: '新しい 技術は、社会の 需要と（　）、急速に 広がった。',
    options: ['相まって', '相違して', '先立って', '即して'],
    correctIndex: 0,
    explanationKo:
      '새 기술과 사회적 수요가 서로 작용해 확산을 이끌었다는 뜻이므로 「と相まって」가 맞습니다.',
    difficulty: 'HARD',
    tags: ['상호 작용', '相まって']
  }),
  createOriginalQuestion({
    id: 'n1-grammar-05',
    level: 'N1',
    subject: 'GRAMMAR',
    questionType: 'GRAMMAR_SELECT',
    questionText: '研究チームは 原因を 解明す（　）、追加調査を 始めた。',
    options: ['なくして', 'べく', 'ごとく', 'まじく'],
    correctIndex: 1,
    explanationKo:
      '원인을 규명하려는 목적을 나타내므로 문어적인 목적 표현 「べく」가 적절합니다.',
    difficulty: 'HARD',
    tags: ['목적', '문어체']
  }),
  createOriginalQuestion({
    id: 'n1-reading-01',
    level: 'N1',
    subject: 'READING',
    questionType: 'LONG_READING',
    passage:
      '失敗を 共有する 仕組みを 作っても、報告した 人が 不利益を 受ける 組織では 情報は 集まらない。重要なのは、報告件数の 多さを 問題視するのではなく、そこから 何を 学び、次の 行動を どう 変えたかを 評価することだ。失敗の 少なさだけを 目標にすると、失敗そのものではなく 報告だけが 減る おそれがある。',
    questionText: '筆者が 組織に 必要だと 考えている 姿勢は どれですか。',
    options: [
      '報告した 人に 責任を 集中させる',
      '小さな 失敗は 記録しない',
      '失敗から 得た 学びと 改善を 評価する',
      '失敗の 報告件数を ゼロにする'
    ],
    correctIndex: 2,
    explanationKo:
      '필자는 보고 건수보다 실패에서 무엇을 배우고 행동을 어떻게 바꿨는지를 평가해야 한다고 주장합니다. 보고를 줄이거나 보고자에게 불이익을 주는 태도는 오히려 정보 공유를 막습니다.',
    difficulty: 'HARD',
    tags: ['논리 독해', '조직 문화']
  }),
  createOriginalQuestion({
    id: 'n1-reading-02',
    level: 'N1',
    subject: 'READING',
    questionType: 'LONG_READING',
    passage:
      '数字は 客観的に 見えるため、議論を 整理するうえで 有効だ。ただし、測りやすいものだけを 指標にすると、本来 重視すべき 価値が 見えなくなることがある。指標は 目的そのものではなく、目的に 近づいているかを 確かめる 手段である。したがって、状況の 変化に 応じて 指標自体も 見直さなければならない。',
    questionText: '指標について、筆者の 考えに 合うものは どれですか。',
    options: [
      '測定しやすさだけで 選ぶべきだ',
      '一度 決めたら 状況が 変わっても 維持すべきだ',
      '数字は 客観的ではないので 使うべきではない',
      '目的との 関係を 確認し、必要なら 見直すべきだ'
    ],
    correctIndex: 3,
    explanationKo:
      '지표는 목적 달성 여부를 확인하는 수단이므로 목적과의 관계를 살피고 상황 변화에 맞춰 재검토해야 한다는 것이 핵심입니다. 숫자 자체를 부정하는 글은 아닙니다.',
    difficulty: 'HARD',
    tags: ['논리 독해', '지표']
  }),
  createOriginalQuestion({
    id: 'n1-reading-03',
    level: 'N1',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    passage:
      '専門セミナー申込規定：早期申込は 九月十日までで、参加費の 一割を 割り引く。九月十一日以降は 通常料金。資料の 郵送を 希望する 場合は、開催日の 十日前までに 申し込み、住所を 登録すること。オンライン参加者には 資料を 電子配布する。',
    questionText:
      '九月十五日開催の セミナーで、紙の 資料を 郵送してほしい 人は どうすればよいですか。',
    options: [
      '九月五日までに 住所を 登録して 申し込む',
      '九月十日までに 住所なしで 申し込む',
      '九月十五日に 会場で 郵送を 頼む',
      '開催後に オンライン参加へ 変更する'
    ],
    correctIndex: 0,
    explanationKo:
      '종이 자료 우편 발송은 개최 10일 전까지 신청하고 주소를 등록해야 합니다. 9월 15일 개최이므로 9월 5일까지가 기한입니다. 조기 할인 기한은 우편 조건과 별개입니다.',
    difficulty: 'HARD',
    tags: ['정보 검색', '조건 비교']
  })
]

export const buildHistoricalCanonicalSeeds =
  (): readonly QuestionAggregateSeed[] =>
    [
      ...n5Questions,
      ...n4Questions,
      ...n3Questions,
      ...n2Questions,
      ...n1Questions
    ].map((seed) => buildQuestionAggregateSeed(seed, toStableSeedUuid))
