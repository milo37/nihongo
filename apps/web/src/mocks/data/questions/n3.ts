import { createOriginalQuestion } from '@mocks/data/questions/createQuestion'

export const n3Questions = [
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
    questionText:
      '利用規則には「入館は 夜十時まで」と 書いてあります。利用者である 私は、自分の 希望に 関係なく、この 規則によって 夜十時以降は 建物に 入ることが できない（　）。',
    options: [
      'ことにしている',
      'ようになりたい',
      'はずがない',
      'ことになっている'
    ],
    correctIndex: 3,
    explanationKo:
      '입장 규칙은 밤 10시까지이며, 이용자인 화자는 자신의 희망과 관계없이 이 규칙 때문에 이후에는 건물에 들어갈 수 없다고 설명합니다. 정해진 규칙을 나타내는 「ことになっている」가 맞습니다. 「入ることができない」로 출입 가능 여부를 명시했으므로 관리자가 사람을 들이지 않는 「入れる」의 부정으로 읽지 않습니다. 「ことにしている」는 스스로 정한 방침이나 그렇게 취급하는 결정에 쓰지만 여기서는 화자의 결정이 아닙니다.',
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
    passage:
      '先週、高い店で食事をしましたが、料理はあまりおいしくありませんでした。昨日は安い店に行きましたが、料理はとてもおいしかったです。このように、値段が高い料理がいつもおいしい（　）。店を選ぶときは、値段だけでなく、食べた人の感想も参考にしたいと思います。',
    questionText: '文章を読んで、（　）に入る最もよいものを選んでください。',
    options: [
      'に決まっています',
      'ことがあります',
      'はずでした',
      'わけではありません'
    ],
    correctIndex: 3,
    explanationKo:
      '비싼 식당의 음식은 별로 맛있지 않았고 싼 식당의 음식은 맛있었다는 두 사례입니다. 「このように」 뒤에는 그 사례를 바탕으로 ‘가격이 비싸다고 언제나 맛있는 것은 아니다’라는 결론이 이어집니다. 따라서 「わけではありません」가 알맞습니다. 비싼 음식 전체가 맛없다는 뜻은 아닙니다. 뒤의 가격 외에 다른 사람의 감상도 참고하겠다는 문장 역시 이 결론을 지지합니다.',
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
