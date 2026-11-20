// #1055 omikuji text, shipped with the app (no server). The planner writes
// the messages and the everyday expressions; until they land, the messages
// and the first expression are placeholders and only the 12 proverbs
// (scenario K-2a 8) are final.

export const FORTUNES = ['大吉', '吉', '中吉', '小吉', '末吉', '凶'] as const
export type Fortune = (typeof FORTUNES)[number]

/** Percent per fortune, in FORTUNES order (K-2, operator 11/19). */
export const FORTUNE_WEIGHTS: Record<Fortune, number> = {
  大吉: 10,
  吉: 30,
  中吉: 25,
  小吉: 18,
  末吉: 13,
  凶: 4
}

export type OmikujiText = { ko: string; ja: string }

export type OmikujiExpression = {
  expression: string
  reading: string
  meaning: OmikujiText
  example: string
  /** Shown on the Korean screen only. */
  exampleKo: string
}

const placeholder = (fortune: Fortune): OmikujiText[] =>
  Array.from({ length: 5 }, (_, index) => ({
    ko: `${fortune} 한마디 ${index + 1} (자리표시)`,
    ja: `${fortune}のひとこと${index + 1}（仮）`
  }))

/** Five per fortune. */
export const MESSAGES: Record<Fortune, OmikujiText[]> = {
  大吉: placeholder('大吉'),
  吉: placeholder('吉'),
  中吉: placeholder('中吉'),
  小吉: placeholder('小吉'),
  末吉: placeholder('末吉'),
  凶: placeholder('凶')
}

export const EXPRESSIONS: OmikujiExpression[] = [
  {
    expression: 'なるほど',
    reading: 'なるほど',
    meaning: { ko: '그렇구나', ja: 'そういうことか' },
    example: 'なるほど、そういうことか。',
    exampleKo: '그렇구나, 그런 거였어.'
  },
  {
    expression: '七転び八起き',
    reading: 'ななころびやおき',
    meaning: {
      ko: '넘어져도 다시 일어남',
      ja: '何度失敗しても、また立ち上がること'
    },
    example: 'テストはだめだったけど、七転び八起きでまたがんばろう。',
    exampleKo: '시험은 잘 안 됐지만, 넘어져도 일어나서 다시 힘내자.'
  },
  {
    expression: '石の上にも三年',
    reading: 'いしのうえにもさんねん',
    meaning: {
      ko: '참고 꾸준히 하면 결국 이루어짐',
      ja: 'がまんして続ければ、いつかうまくいく'
    },
    example: '毎日10分でも続けよう。石の上にも三年だよ。',
    exampleKo: '매일 10분이라도 계속하자. 꾸준히 하면 돼.'
  },
  {
    expression: '継続は力なり',
    reading: 'けいぞくはちからなり',
    meaning: { ko: '계속하는 것이 곧 힘', ja: '続けることが力になる' },
    example: '継続は力なり。今日も少しだけ読もう。',
    exampleKo: '계속이 힘이야. 오늘도 조금만 읽자.'
  },
  {
    expression: '塵も積もれば山となる',
    reading: 'ちりもつもればやまとなる',
    meaning: { ko: '티끌 모아 태산', ja: '小さなことも集まれば大きくなる' },
    example: '一日5つの単語でも、塵も積もれば山となる。',
    exampleKo: '하루 다섯 단어라도 티끌 모아 태산이야.'
  },
  {
    expression: '急がば回れ',
    reading: 'いそがばまわれ',
    meaning: {
      ko: '급할수록 돌아가라',
      ja: '急ぐときほど、確かな道を行くほうがいい'
    },
    example: '急がば回れ。まず基本の文法から見直そう。',
    exampleKo: '급할수록 돌아가자. 먼저 기본 문법부터 다시 보자.'
  },
  {
    expression: '笑う門には福来る',
    reading: 'わらうかどにはふくきたる',
    meaning: {
      ko: '웃는 집에 복이 온다',
      ja: 'いつも笑っている人のところに幸せが来る'
    },
    example: '笑う門には福来る。今日も笑顔でいこう。',
    exampleKo: '웃으면 복이 온대. 오늘도 웃으면서 가자.'
  },
  {
    expression: '習うより慣れよ',
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
    expression: '好きこそ物の上手なれ',
    reading: 'すきこそもののじょうずなれ',
    meaning: {
      ko: '좋아하면 잘하게 된다',
      ja: '好きなことは、自然に上手になる'
    },
    example: 'アニメで覚えた言葉が多いのは、好きこそ物の上手なれだね。',
    exampleKo: '애니로 외운 말이 많은 건, 좋아하니까 잘하게 된 거네.'
  },
  {
    expression: '千里の道も一歩から',
    reading: 'せんりのみちもいっぽから',
    meaning: {
      ko: '천 리 길도 한 걸음부터',
      ja: '大きなことも、小さな一歩から始まる'
    },
    example: '千里の道も一歩から。まずは1セット解いてみよう。',
    exampleKo: '천 리 길도 한 걸음부터. 우선 한 세트 풀어 보자.'
  },
  {
    expression: '案ずるより産むが易し',
    reading: 'あんずるよりうむがやすし',
    meaning: {
      ko: '걱정하기보다 해 보면 쉽다',
      ja: '心配するより、やってみると意外に簡単'
    },
    example: '初めての会話練習も、案ずるより産むが易しだった。',
    exampleKo: '처음 회화 연습도 걱정보다 해 보니 쉬웠어.'
  },
  {
    expression: '雨降って地固まる',
    reading: 'あめふってじかたまる',
    meaning: {
      ko: '비 온 뒤에 땅이 굳는다',
      ja: 'もめごとのあとで、かえって前よりよくなる'
    },
    example: 'けんかしたけど、雨降って地固まるで前より仲良くなった。',
    exampleKo: '싸웠지만 비 온 뒤 땅이 굳듯 전보다 친해졌어.'
  },
  {
    expression: '早起きは三文の徳',
    reading: 'はやおきはさんもんのとく',
    meaning: {
      ko: '일찍 일어나면 좋은 일이 있다',
      ja: '朝早く起きると、何かいいことがある'
    },
    example: '早起きは三文の徳。朝の15分で単語を覚えた。',
    exampleKo: '일찍 일어나면 득이 있다더니, 아침 15분에 단어를 외웠어.'
  }
]
