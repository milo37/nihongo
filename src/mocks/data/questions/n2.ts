import { createOriginalQuestion } from '@mocks/data/questions/createQuestion'

export const n2Questions = [
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
