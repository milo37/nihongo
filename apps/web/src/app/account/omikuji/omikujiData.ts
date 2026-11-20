// #1055 omikuji text, copied as is from the planner's content.json
// (research omikuji-1055; content.md is the source and content-build.cjs
// makes the json). Do not edit the text here: change content.md, rebuild
// the json, then copy it over this file's two lists.

export type OmikujiText = { ko: string; ja: string }

export type OmikujiFortune = {
  key: string
  /** The fortune in kanji, shown as is in both languages. */
  label: string
  /** Percent; the six add up to 100. */
  weight: number
  messages: OmikujiText[]
}

export type OmikujiExpression = {
  id: number
  group: number
  text: string
  reading: string
  meaning: OmikujiText
  example: string
  /** Shown on the Korean screen only. */
  exampleKo: string
}

export const FORTUNES: OmikujiFortune[] = [
  {
    key: 'daikichi',
    label: '大吉',
    weight: 10,
    messages: [
      {
        ko: '반가운 소식이 찾아올 것 같은 날이에요.',
        ja: 'うれしい知らせが届きそうな一日です。'
      },
      {
        ko: '하고 싶던 일을 시작하기 좋은 날이에요.',
        ja: 'やってみたかったことを始めるのにいい日です。'
      },
      {
        ko: '마음먹은 일이 술술 풀리는 날이에요.',
        ja: '思っていたことが、すらすら進む日です。'
      },
      {
        ko: '오늘 만나는 사람과 좋은 인연이 생겨요.',
        ja: '今日会う人と、いいご縁がありそうです。'
      },
      {
        ko: '작은 일에도 웃을 일이 많은 하루예요.',
        ja: '小さなことにも笑顔になれる一日です。'
      }
    ]
  },
  {
    key: 'kichi',
    label: '吉',
    weight: 30,
    messages: [
      {
        ko: '평소처럼 지내면 좋은 일이 따라와요.',
        ja: 'いつもどおりに過ごせば、いいことがついてきます。'
      },
      {
        ko: '따뜻한 차 한 잔이 기분을 바꿔 줄 거예요.',
        ja: '温かいお茶一杯で、気分が変わりそうです。'
      },
      {
        ko: '미뤄 둔 일을 하나 끝내기 좋은 날이에요.',
        ja: '後回しにしていたことを、ひとつ片づけるのにいい日です。'
      },
      {
        ko: '누군가에게 고맙다고 말하면 더 좋은 날이 돼요.',
        ja: '誰かに「ありがとう」と伝えると、もっといい日になります。'
      },
      {
        ko: '새로 알게 된 것 하나가 오늘을 밝혀 줘요.',
        ja: '新しく知ったことがひとつ、今日を明るくしてくれます。'
      }
    ]
  },
  {
    key: 'chukichi',
    label: '中吉',
    weight: 25,
    messages: [
      {
        ko: '서두르지 않으면 차근차근 잘 풀려요.',
        ja: 'あせらなければ、少しずつうまくいきます。'
      },
      {
        ko: '좋아하는 노래를 들으며 걸어 보세요.',
        ja: '好きな歌を聞きながら、歩いてみてください。'
      },
      {
        ko: '오늘의 작은 선택이 내일을 편하게 해요.',
        ja: '今日の小さな選択が、明日を楽にします。'
      },
      {
        ko: '생각보다 일이 가볍게 끝나는 날이에요.',
        ja: '思ったより、すんなり片づく日です。'
      },
      {
        ko: '창밖을 한번 보면 기분이 맑아져요.',
        ja: '窓の外を一度見ると、気持ちが晴れます。'
      }
    ]
  },
  {
    key: 'shokichi',
    label: '小吉',
    weight: 18,
    messages: [
      {
        ko: '작은 기쁨을 하나 찾을 수 있는 날이에요.',
        ja: '小さなうれしいことが、ひとつ見つかる日です。'
      },
      {
        ko: '맛있는 것을 먹으면 힘이 나요.',
        ja: 'おいしいものを食べると、元気が出ます。'
      },
      {
        ko: '늘 다니던 길에서 새로운 것을 발견해요.',
        ja: 'いつもの道で、新しい発見がありそうです。'
      },
      {
        ko: '조금 일찍 쉬면 내일이 가벼워요.',
        ja: '少し早めに休むと、明日が楽になります。'
      },
      {
        ko: '한 가지만 해내도 충분히 좋은 하루예요.',
        ja: 'ひとつできれば、十分いい一日です。'
      }
    ]
  },
  {
    key: 'suekichi',
    label: '末吉',
    weight: 13,
    messages: [
      {
        ko: '오후부터 조금씩 좋아지는 날이에요.',
        ja: '午後から少しずつよくなる日です。'
      },
      {
        ko: '기다리던 일은 조금 뒤에 찾아와요.',
        ja: '待っていたことは、もう少しあとにやってきます。'
      },
      {
        ko: '오늘 뿌린 씨앗은 천천히 자라요.',
        ja: '今日まいた種は、ゆっくり育ちます。'
      },
      {
        ko: '늦게 핀 꽃이 더 오래 가요.',
        ja: '遅く咲いた花ほど、長く咲きます。'
      },
      {
        ko: '저녁이 될수록 마음이 편해지는 하루예요.',
        ja: '夕方になるほど、気持ちが楽になる一日です。'
      }
    ]
  },
  {
    key: 'kyo',
    label: '凶',
    weight: 4,
    messages: [
      {
        ko: '오늘은 천천히 가도 괜찮아요.',
        ja: '今日はゆっくりでも大丈夫です。'
      },
      { ko: '쉬어 가는 날도 꼭 필요해요.', ja: '休む日も、ちゃんと必要です。' },
      {
        ko: '작은 것 하나만 해도 충분해요.',
        ja: '小さなことひとつで、十分です。'
      },
      {
        ko: '따뜻하게 하고 일찍 자면 내일은 새로운 날이에요.',
        ja: 'あたたかくして早めに寝れば、明日はまた新しい日です。'
      },
      {
        ko: '오늘 안 풀린 일은 내일에 맡겨도 돼요.',
        ja: '今日うまくいかなかったことは、明日に任せてもいいですよ。'
      }
    ]
  }
]

export const EXPRESSIONS: OmikujiExpression[] = [
  {
    id: 1,
    group: 1,
    text: 'お疲れさまです',
    reading: 'おつかれさまです',
    meaning: { ko: '수고 많으세요', ja: '相手のがんばりをねぎらう言葉' },
    example: '今日も一日お疲れさまでした。',
    exampleKo: '오늘도 하루 수고 많으셨어요.'
  },
  {
    id: 2,
    group: 1,
    text: '久しぶり',
    reading: 'ひさしぶり',
    meaning: { ko: '오랜만이야', ja: '長いあいだ会っていなかった人に言う言葉' },
    example: '久しぶり！元気だった？',
    exampleKo: '오랜만이야! 잘 지냈어?'
  },
  {
    id: 3,
    group: 1,
    text: 'お元気ですか',
    reading: 'おげんきですか',
    meaning: { ko: '잘 지내세요?', ja: '相手が元気かどうかたずねる言葉' },
    example: '先生、お元気ですか。またお会いしたいです。',
    exampleKo: '선생님, 잘 지내세요? 또 뵙고 싶어요.'
  },
  {
    id: 4,
    group: 1,
    text: 'おかげさまで',
    reading: 'おかげさまで',
    meaning: {
      ko: '덕분에요',
      ja: 'うまくいったことを、まわりに感謝して言う言葉'
    },
    example: '「試験どうだった？」「おかげさまで合格しました。」',
    exampleKo: '"시험 어땠어?" "덕분에 합격했어요."'
  },
  {
    id: 5,
    group: 1,
    text: 'よろしくお願いします',
    reading: 'よろしくおねがいします',
    meaning: { ko: '잘 부탁드려요', ja: 'これからのことをお願いするあいさつ' },
    example: '今日から入りました。よろしくお願いします。',
    exampleKo: '오늘부터 들어왔어요. 잘 부탁드려요.'
  },
  {
    id: 6,
    group: 1,
    text: 'お邪魔します',
    reading: 'おじゃまします',
    meaning: {
      ko: '실례하겠습니다(남의 집에 들어갈 때)',
      ja: '人の家や部屋に入るときのあいさつ'
    },
    example: '「どうぞ、上がって。」「お邪魔します。」',
    exampleKo: '"어서 들어와." "실례할게요."'
  },
  {
    id: 7,
    group: 1,
    text: 'またね',
    reading: 'またね',
    meaning: { ko: '또 봐', ja: '友だちと別れるときの軽いあいさつ' },
    example: 'じゃあ、またね。気をつけて帰ってね。',
    exampleKo: '그럼 또 봐. 조심히 들어가.'
  },
  {
    id: 8,
    group: 1,
    text: 'お先に失礼します',
    reading: 'おさきにしつれいします',
    meaning: {
      ko: '먼저 가 보겠습니다',
      ja: '先に帰るとき、まわりの人に言うあいさつ'
    },
    example: '今日はこれで、お先に失礼します。',
    exampleKo: '오늘은 이만 먼저 가 보겠습니다.'
  },
  {
    id: 9,
    group: 2,
    text: 'なるほど',
    reading: 'なるほど',
    meaning: { ko: '그렇구나, 과연', ja: '話を聞いて、よくわかったときの言葉' },
    example: 'なるほど、そういう意味だったんだ。',
    exampleKo: '그렇구나, 그런 뜻이었구나.'
  },
  {
    id: 10,
    group: 2,
    text: 'たしかに',
    reading: 'たしかに',
    meaning: { ko: '맞아, 확실히', ja: '相手の話に「本当にそうだ」と思う言葉' },
    example: 'たしかに、この店のほうが安いね。',
    exampleKo: '맞아, 이 가게가 더 싸네.'
  },
  {
    id: 11,
    group: 2,
    text: 'そうなんだ',
    reading: 'そうなんだ',
    meaning: { ko: '그렇구나', ja: 'はじめて知ったことに軽く答える言葉' },
    example: '「明日休みだって。」「そうなんだ、知らなかった。」',
    exampleKo: '"내일 쉰대." "그렇구나, 몰랐어."'
  },
  {
    id: 12,
    group: 2,
    text: 'それな',
    reading: 'それな',
    meaning: {
      ko: '그거 완전 맞아(친구끼리)',
      ja: '「本当にそのとおり」という、友だちどうしの言葉'
    },
    example: '「月曜の朝ってつらいよね。」「それな。」',
    exampleKo: '"월요일 아침은 힘들지." "완전 그거야."'
  },
  {
    id: 13,
    group: 2,
    text: 'まあまあ',
    reading: 'まあまあ',
    meaning: { ko: '그럭저럭', ja: 'よくも悪くもない、ふつうぐらい' },
    example: '「テストどうだった？」「まあまあかな。」',
    exampleKo: '"시험 어땠어?" "그럭저럭?"'
  },
  {
    id: 14,
    group: 2,
    text: 'もちろん',
    reading: 'もちろん',
    meaning: { ko: '물론이지', ja: '「言うまでもなく、そうだ」という返事' },
    example: '「一緒に行く？」「もちろん！」',
    exampleKo: '"같이 갈래?" "물론이지!"'
  },
  {
    id: 15,
    group: 2,
    text: 'さすが',
    reading: 'さすが',
    meaning: { ko: '역시(대단해)', ja: '思ったとおりすごい、とほめる言葉' },
    example: '一回で覚えたの？さすがだね。',
    exampleKo: '한 번에 외웠어? 역시 대단하다.'
  },
  {
    id: 16,
    group: 2,
    text: '本当に？',
    reading: 'ほんとうに',
    meaning: { ko: '정말?', ja: '信じられないときや、たしかめたいときの言葉' },
    example: '「くじで一等が当たった。」「本当に？」',
    exampleKo: '"제비뽑기에서 1등 됐어." "정말?"'
  },
  {
    id: 17,
    group: 3,
    text: 'がんばって',
    reading: 'がんばって',
    meaning: { ko: '힘내', ja: '相手を応援する言葉' },
    example: '明日の面接、がんばってね。',
    exampleKo: '내일 면접 힘내.'
  },
  {
    id: 18,
    group: 3,
    text: '無理しないで',
    reading: 'むりしないで',
    meaning: {
      ko: '무리하지 마',
      ja: '体や気持ちを大事にしてほしいときの言葉'
    },
    example: '忙しいと思うけど、無理しないでね。',
    exampleKo: '바쁘겠지만 무리하지 마.'
  },
  {
    id: 19,
    group: 3,
    text: '大丈夫だよ',
    reading: 'だいじょうぶだよ',
    meaning: { ko: '괜찮아', ja: '心配している人を安心させる言葉' },
    example: '一回まちがえても大丈夫だよ。',
    exampleKo: '한 번 틀려도 괜찮아.'
  },
  {
    id: 20,
    group: 3,
    text: 'ドンマイ',
    reading: 'どんまい',
    meaning: {
      ko: '괜찮아, 신경 쓰지 마',
      ja: '失敗した人に「気にしないで」と言う言葉'
    },
    example: '「シュート外しちゃった。」「ドンマイ！次があるよ。」',
    exampleKo: '"슛 빗나갔어." "괜찮아! 다음이 있어."'
  },
  {
    id: 21,
    group: 3,
    text: '応援してるよ',
    reading: 'おうえんしてるよ',
    meaning: { ko: '응원할게', ja: '相手のことを応援していると伝える言葉' },
    example: '新しい仕事、応援してるよ。',
    exampleKo: '새 일, 응원할게.'
  },
  {
    id: 22,
    group: 3,
    text: '一緒にがんばろう',
    reading: 'いっしょにがんばろう',
    meaning: {
      ko: '같이 힘내자',
      ja: '自分も相手といっしょにがんばるという言葉'
    },
    example: '引っ越しの準備、一緒にがんばろう。',
    exampleKo: '이사 준비, 같이 힘내자.'
  },
  {
    id: 23,
    group: 3,
    text: 'よくできました',
    reading: 'よくできました',
    meaning: { ko: '잘했어요', ja: '上手にできたことをほめる言葉' },
    example: '全部正解！よくできました。',
    exampleKo: '다 맞았네! 잘했어요.'
  },
  {
    id: 24,
    group: 3,
    text: 'その調子',
    reading: 'そのちょうし',
    meaning: { ko: '그대로 좋아', ja: '今のやり方でいい、とはげます言葉' },
    example: 'いいね、その調子で続けて。',
    exampleKo: '좋아, 그대로 계속해.'
  },
  {
    id: 25,
    group: 3,
    text: '気にしないで',
    reading: 'きにしないで',
    meaning: { ko: '신경 쓰지 마', ja: '心配しなくていい、と伝える言葉' },
    example: '遅れたのは気にしないで。私も今来たところ。',
    exampleKo: '늦은 건 신경 쓰지 마. 나도 방금 왔어.'
  },
  {
    id: 26,
    group: 3,
    text: 'ゆっくりでいいよ',
    reading: 'ゆっくりでいいよ',
    meaning: { ko: '천천히 해도 돼', ja: '急がなくていい、と伝える言葉' },
    example: '返事はゆっくりでいいよ。',
    exampleKo: '답장은 천천히 해도 돼.'
  },
  {
    id: 27,
    group: 4,
    text: 'うれしい',
    reading: 'うれしい',
    meaning: { ko: '기쁘다', ja: 'いいことがあって、楽しい気持ち' },
    example: '手紙をもらって、すごくうれしい。',
    exampleKo: '편지를 받아서 정말 기뻐.'
  },
  {
    id: 28,
    group: 4,
    text: 'ほっとする',
    reading: 'ほっとする',
    meaning: { ko: '안심되다', ja: '心配がなくなって、気持ちが楽になる' },
    example: '電車に間に合って、ほっとした。',
    exampleKo: '전철 시간에 늦지 않아서 안심했어.'
  },
  {
    id: 29,
    group: 4,
    text: 'わくわくする',
    reading: 'わくわくする',
    meaning: { ko: '설레다', ja: '楽しみで、気持ちが高まる' },
    example: '明日から旅行で、わくわくする。',
    exampleKo: '내일부터 여행이라 설레.'
  },
  {
    id: 30,
    group: 4,
    text: 'なつかしい',
    reading: 'なつかしい',
    meaning: {
      ko: '그립다, 반갑다',
      ja: '昔のことを思い出して、いい気持ちになる'
    },
    example: 'この歌、なつかしいね。高校のころよく聞いた。',
    exampleKo: '이 노래 옛날 생각나네. 고등학교 때 자주 들었어.'
  },
  {
    id: 31,
    group: 4,
    text: 'もったいない',
    reading: 'もったいない',
    meaning: { ko: '아깝다', ja: '大事なものがむだになって、残念' },
    example: 'まだ食べられるのに、捨てるのはもったいない。',
    exampleKo: '아직 먹을 수 있는데 버리기 아까워.'
  },
  {
    id: 32,
    group: 4,
    text: 'びっくりした',
    reading: 'びっくりした',
    meaning: { ko: '깜짝 놀랐어', ja: '急なことにおどろいた' },
    example: '急に後ろから呼ばれて、びっくりした。',
    exampleKo: '갑자기 뒤에서 불러서 깜짝 놀랐어.'
  },
  {
    id: 33,
    group: 4,
    text: 'すっきりした',
    reading: 'すっきりした',
    meaning: {
      ko: '개운하다, 후련하다',
      ja: 'いやな気持ちがなくなって、気持ちいい'
    },
    example: '部屋を片づけたら、すっきりした。',
    exampleKo: '방을 치웠더니 개운해.'
  },
  {
    id: 34,
    group: 4,
    text: '楽しみ',
    reading: 'たのしみ',
    meaning: { ko: '기대돼', ja: 'これからのことを待つのがうれしい' },
    example: '週末の映画、楽しみだね。',
    exampleKo: '주말 영화 기대된다.'
  },
  {
    id: 35,
    group: 5,
    text: 'いい天気ですね',
    reading: 'いいてんきですね',
    meaning: { ko: '날씨 좋네요', ja: '晴れて気持ちのいい日のあいさつ' },
    example: 'いい天気ですね。散歩に行きたくなります。',
    exampleKo: '날씨 좋네요. 산책 가고 싶어져요.'
  },
  {
    id: 36,
    group: 5,
    text: '寒くなりましたね',
    reading: 'さむくなりましたね',
    meaning: { ko: '추워졌네요', ja: '冬が近づいたころのあいさつ' },
    example: '朝晩、寒くなりましたね。',
    exampleKo: '아침저녁으로 추워졌네요.'
  },
  {
    id: 37,
    group: 5,
    text: '蒸し暑い',
    reading: 'むしあつい',
    meaning: { ko: '후덥지근하다', ja: '暑くて、空気がじめじめしている' },
    example: '今日は蒸し暑くて、すぐ汗が出る。',
    exampleKo: '오늘은 후덥지근해서 금방 땀이 나.'
  },
  {
    id: 38,
    group: 5,
    text: '梅雨',
    reading: 'つゆ',
    meaning: { ko: '장마', ja: '6月ごろの、雨が多い時期' },
    example: '梅雨に入って、毎日傘が手放せない。',
    exampleKo: '장마가 시작돼서 매일 우산을 챙겨야 해.'
  },
  {
    id: 39,
    group: 5,
    text: '花見',
    reading: 'はなみ',
    meaning: { ko: '꽃구경', ja: '桜の花を見て楽しむこと' },
    example: '週末、公園で花見をしよう。',
    exampleKo: '주말에 공원에서 꽃구경하자.'
  },
  {
    id: 40,
    group: 5,
    text: '紅葉',
    reading: 'こうよう',
    meaning: { ko: '단풍', ja: '秋に葉が赤や黄色になること' },
    example: '山の紅葉が、今ちょうどきれいだよ。',
    exampleKo: '산 단풍이 지금 딱 예뻐.'
  },
  {
    id: 41,
    group: 5,
    text: '夕立',
    reading: 'ゆうだち',
    meaning: { ko: '여름 오후의 소나기', ja: '夏の午後に急に降る強い雨' },
    example: '帰り道で夕立にあって、びしょぬれになった。',
    exampleKo: '집에 가는 길에 소나기를 만나서 흠뻑 젖었어.'
  },
  {
    id: 42,
    group: 5,
    text: '日が長くなりましたね',
    reading: 'ひがながくなりましたね',
    meaning: {
      ko: '해가 길어졌네요',
      ja: '明るい時間が長くなったころのあいさつ'
    },
    example: '日が長くなりましたね。6時でもまだ明るいです。',
    exampleKo: '해가 길어졌네요. 6시인데도 아직 밝아요.'
  },
  {
    id: 43,
    group: 6,
    text: 'いただきます',
    reading: 'いただきます',
    meaning: { ko: '잘 먹겠습니다', ja: '食べる前のあいさつ' },
    example: 'みんなそろったね。いただきます！',
    exampleKo: '다 모였네. 잘 먹겠습니다!'
  },
  {
    id: 44,
    group: 6,
    text: 'ごちそうさまでした',
    reading: 'ごちそうさまでした',
    meaning: { ko: '잘 먹었습니다', ja: '食べ終わったあとのあいさつ' },
    example: 'とてもおいしかったです。ごちそうさまでした。',
    exampleKo: '정말 맛있었어요. 잘 먹었습니다.'
  },
  {
    id: 45,
    group: 6,
    text: 'おなかすいた',
    reading: 'おなかすいた',
    meaning: { ko: '배고파', ja: '何か食べたい気持ち' },
    example: 'おなかすいた。何か食べに行かない？',
    exampleKo: '배고파. 뭐 먹으러 안 갈래?'
  },
  {
    id: 46,
    group: 6,
    text: 'おなかいっぱい',
    reading: 'おなかいっぱい',
    meaning: { ko: '배불러', ja: 'たくさん食べて、もう入らない' },
    example: 'おなかいっぱいで、もう動けない。',
    exampleKo: '배불러서 이제 못 움직이겠어.'
  },
  {
    id: 47,
    group: 6,
    text: 'おすすめは何ですか',
    reading: 'おすすめはなんですか',
    meaning: {
      ko: '추천 메뉴가 뭐예요?',
      ja: '店でいちばんいいものをたずねる言葉'
    },
    example: 'すみません、おすすめは何ですか。',
    exampleKo: '저기요, 추천 메뉴가 뭐예요?'
  },
  {
    id: 48,
    group: 6,
    text: 'お会計お願いします',
    reading: 'おかいけいおねがいします',
    meaning: { ko: '계산해 주세요', ja: '店でお金を払いたいときの言葉' },
    example: 'すみません、お会計お願いします。',
    exampleKo: '저기요, 계산해 주세요.'
  },
  {
    id: 49,
    group: 6,
    text: '乾杯',
    reading: 'かんぱい',
    meaning: { ko: '건배', ja: 'みんなでグラスを合わせて飲むときの言葉' },
    example: '合格おめでとう！乾杯！',
    exampleKo: '합격 축하해! 건배!'
  },
  {
    id: 50,
    group: 6,
    text: '味見',
    reading: 'あじみ',
    meaning: { ko: '맛보기', ja: '料理の味を少し食べてたしかめること' },
    example: 'スープの味見をしてみて。ちょっと薄いかな。',
    exampleKo: '수프 맛 좀 봐 봐. 좀 싱거운가?'
  },
  {
    id: 51,
    group: 7,
    text: '行ってきます',
    reading: 'いってきます',
    meaning: { ko: '다녀오겠습니다', ja: '家を出るときのあいさつ' },
    example: '行ってきます。夕方には帰るね。',
    exampleKo: '다녀올게. 저녁때는 돌아올게.'
  },
  {
    id: 52,
    group: 7,
    text: 'ただいま',
    reading: 'ただいま',
    meaning: { ko: '다녀왔어요', ja: '家に帰ったときのあいさつ' },
    example: 'ただいま。今日は寒かったよ。',
    exampleKo: '다녀왔어. 오늘 추웠어.'
  },
  {
    id: 53,
    group: 7,
    text: 'おかえり',
    reading: 'おかえり',
    meaning: {
      ko: '어서 와(돌아온 사람에게)',
      ja: '帰ってきた人をむかえる言葉'
    },
    example: 'おかえり。ごはんできてるよ。',
    exampleKo: '어서 와. 밥 다 됐어.'
  },
  {
    id: 54,
    group: 7,
    text: 'ひと休み',
    reading: 'ひとやすみ',
    meaning: { ko: '잠깐 쉬기', ja: '少しのあいだ休むこと' },
    example: 'ちょっとひと休みして、お茶にしよう。',
    exampleKo: '잠깐 쉬면서 차 마시자.'
  },
  {
    id: 55,
    group: 7,
    text: 'おやすみなさい',
    reading: 'おやすみなさい',
    meaning: { ko: '안녕히 주무세요', ja: '寝る前のあいさつ' },
    example: '明日も早いから、おやすみなさい。',
    exampleKo: '내일도 일찍 일어나야 하니까, 잘 자요.'
  },
  {
    id: 56,
    group: 7,
    text: '寝坊',
    reading: 'ねぼう',
    meaning: { ko: '늦잠', ja: '起きる時間をすぎて寝てしまうこと' },
    example: '寝坊して、バスに乗り遅れた。',
    exampleKo: '늦잠 자서 버스를 놓쳤어.'
  },
  {
    id: 57,
    group: 7,
    text: '二度寝',
    reading: 'にどね',
    meaning: { ko: '깼다가 다시 잠들기', ja: '一度起きたあと、また寝ること' },
    example: '日曜日はつい二度寝しちゃう。',
    exampleKo: '일요일엔 나도 모르게 다시 자 버려.'
  },
  {
    id: 58,
    group: 7,
    text: 'のんびり',
    reading: 'のんびり',
    meaning: { ko: '느긋하게', ja: '急がないで、ゆっくり過ごす様子' },
    example: '休みの日は家でのんびりしたい。',
    exampleKo: '쉬는 날엔 집에서 느긋하게 지내고 싶어.'
  },
  {
    id: 59,
    group: 7,
    text: '気分転換',
    reading: 'きぶんてんかん',
    meaning: {
      ko: '기분 전환',
      ja: 'いつもとちがうことをして、気持ちを新しくすること'
    },
    example: '気分転換に、少し散歩してくる。',
    exampleKo: '기분 전환하러 잠깐 산책하고 올게.'
  },
  {
    id: 60,
    group: 7,
    text: 'お風呂に入る',
    reading: 'おふろにはいる',
    meaning: {
      ko: '목욕하다(욕조에 몸 담그기)',
      ja: '湯船につかって、体を温める'
    },
    example: '寒い日は、早くお風呂に入りたい。',
    exampleKo: '추운 날엔 빨리 욕조에 몸 담그고 싶어.'
  },
  {
    id: 61,
    group: 8,
    text: '七転び八起き',
    reading: 'ななころびやおき',
    meaning: {
      ko: '넘어져도 다시 일어남',
      ja: '何度失敗しても、また立ち上がること'
    },
    example: 'テストはだめだったけど、七転び八起きでまたがんばろう。',
    exampleKo: '시험은 잘 안 됐지만, 넘어져도 일어나서 다시 힘내자.'
  },
  {
    id: 62,
    group: 8,
    text: '石の上にも三年',
    reading: 'いしのうえにもさんねん',
    meaning: {
      ko: '참고 꾸준히 하면 결국 이루어짐',
      ja: 'がまんして続ければ、いつかうまくいく'
    },
    example: '毎日10分でも続けよう。石の上にも三年だよ。',
    exampleKo: '매일 10분이라도 계속하자. 꾸준히 하면 돼.'
  },
  {
    id: 63,
    group: 8,
    text: '継続は力なり',
    reading: 'けいぞくはちからなり',
    meaning: { ko: '계속하는 것이 곧 힘', ja: '続けることが力になる' },
    example: '継続は力なり。今日も少しだけ読もう。',
    exampleKo: '계속이 힘이야. 오늘도 조금만 읽자.'
  },
  {
    id: 64,
    group: 8,
    text: '塵も積もれば山となる',
    reading: 'ちりもつもればやまとなる',
    meaning: { ko: '티끌 모아 태산', ja: '小さなことも集まれば大きくなる' },
    example: '一日5つの単語でも、塵も積もれば山となる。',
    exampleKo: '하루 다섯 단어라도 티끌 모아 태산이야.'
  },
  {
    id: 65,
    group: 8,
    text: '急がば回れ',
    reading: 'いそがばまわれ',
    meaning: {
      ko: '급할수록 돌아가라',
      ja: '急ぐときほど、確かな道を行くほうがいい'
    },
    example: '急がば回れ。まず基本の文法から見直そう。',
    exampleKo: '급할수록 돌아가자. 먼저 기본 문법부터 다시 보자.'
  },
  {
    id: 66,
    group: 8,
    text: '笑う門には福来る',
    reading: 'わらうかどにはふくきたる',
    meaning: {
      ko: '웃는 집에 복이 온다',
      ja: 'いつも笑っている人のところに幸せが来る'
    },
    example: '笑う門には福来る。今日も笑顔でいこう。',
    exampleKo: '웃으면 복이 온대. 오늘도 웃으면서 가자.'
  },
  {
    id: 67,
    group: 8,
    text: '習うより慣れよ',
    reading: 'ならうよりなれよ',
    meaning: {
      ko: '배우기보다 몸에 익혀라',
      ja: '教わるより、何度もやって慣れるほうが身につく'
    },
    example: '習うより慣れよと思って、毎日日本語で日記を書いている。',
    exampleKo:
      '배우기보다 익숙해지자는 생각으로, 매일 일본어로 일기를 쓰고 있어.'
  },
  {
    id: 68,
    group: 8,
    text: '好きこそ物の上手なれ',
    reading: 'すきこそもののじょうずなれ',
    meaning: {
      ko: '좋아하면 잘하게 된다',
      ja: '好きなことは、自然に上手になる'
    },
    example: 'アニメで覚えた言葉が多いのは、好きこそ物の上手なれだね。',
    exampleKo: '애니로 외운 말이 많은 건, 좋아하니까 잘하게 된 거네.'
  },
  {
    id: 69,
    group: 8,
    text: '千里の道も一歩から',
    reading: 'せんりのみちもいっぽから',
    meaning: {
      ko: '천 리 길도 한 걸음부터',
      ja: '大きなことも、小さな一歩から始まる'
    },
    example: '千里の道も一歩から。まずは1セット解いてみよう。',
    exampleKo: '천 리 길도 한 걸음부터. 우선 한 세트 풀어 보자.'
  },
  {
    id: 70,
    group: 8,
    text: '案ずるより産むが易し',
    reading: 'あんずるよりうむがやすし',
    meaning: {
      ko: '걱정하기보다 해 보면 쉽다',
      ja: '心配するより、やってみると意外に簡単'
    },
    example: '初めての会話練習も、案ずるより産むが易しだった。',
    exampleKo: '처음 회화 연습도 걱정보다 해 보니 쉬웠어.'
  },
  {
    id: 71,
    group: 8,
    text: '雨降って地固まる',
    reading: 'あめふってじかたまる',
    meaning: {
      ko: '비 온 뒤에 땅이 굳는다',
      ja: 'もめごとのあとで、かえって前よりよくなる'
    },
    example: 'けんかしたけど、雨降って地固まるで前より仲良くなった。',
    exampleKo: '싸웠지만 비 온 뒤 땅이 굳듯 전보다 친해졌어.'
  },
  {
    id: 72,
    group: 8,
    text: '早起きは三文の徳',
    reading: 'はやおきはさんもんのとく',
    meaning: {
      ko: '일찍 일어나면 좋은 일이 있다',
      ja: '朝早く起きると、何かいいことがある'
    },
    example: '早起きは三文の徳。朝の15分で単語を覚えた。',
    exampleKo: '일찍 일어나면 득이 있다더니, 아침 15분에 단어를 외웠어.'
  }
]
