import { createOriginalQuestion } from './createQuestion.js'

export const n1Questions = [
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
