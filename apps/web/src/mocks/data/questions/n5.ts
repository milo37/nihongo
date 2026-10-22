import { createOriginalQuestion } from '@mocks/data/questions/createQuestion'

export const n5Questions = [
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
    questionText:
      '母が「朝ですよ。ふとんから 出て ください」と 言いました。わたしは「はい、今（　）」と 答えて、ふとんから 出ました。',
    options: ['あそびます', 'おきます', 'ねます', 'あらいます'],
    correctIndex: 1,
    explanationKo:
      '어머니가 이불 밖으로 나오라고 하자, 화자가 응답하고 이불 밖으로 나왔습니다. 이 요청에 맞는 응답은 「今 おきます(지금 일어날게요)」입니다. 「あそびます」는 놀다, 「ねます」는 자다, 「あらいます」는 씻다라는 뜻으로, 이불에서 일어나라는 요청에 답하는 동작과 다릅니다.',
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
    questionText:
      'A「明日、いっしょに 映画を 見（　）か。」\nB「いいですね。いっしょに 行きましょう。」',
    options: ['ました', 'ませんでした', 'なく', 'ません'],
    correctIndex: 3,
    explanationKo:
      '내일 함께 영화를 보자는 권유에 B가 좋다며 함께 가자고 응답합니다. 따라서 「見ませんか」가 알맞습니다. 「見ましたか」와 「見ませんでしたか」는 과거에 보았는지 또는 보지 않았는지를 묻는 표현으로, 내일의 초대와 맞지 않습니다. 「見なくか」는 이 문장에서 올바른 의문문 형태가 아닙니다.',
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
      'A「英語が できますか。」\nB「いいえ、英語は できません。でも、日本語（　）少し できます。」',
    options: ['を', 'が', 'に', 'で'],
    correctIndex: 1,
    explanationKo:
      'A는 영어를 할 수 있는지 언어 능력을 묻고 있습니다. B는 영어는 못하지만 일본어는 조금 할 수 있다고 답하므로, 가능한 언어의 대상인 「日本語」에 「が」를 붙입니다. 정답은 「日本語が 少し できます」입니다. 「で」는 어떤 일을 일본어로 한다는 수단, 「に」는 무언가를 일본어로 바꾸는 결과를 나타낼 수 있지만 이 대화에는 그런 과제가 없습니다. 두 조사가 다른 문맥에서도 틀린 것은 아닙니다.',
    difficulty: 'NORMAL',
    tags: ['가능 표현', '조사']
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
