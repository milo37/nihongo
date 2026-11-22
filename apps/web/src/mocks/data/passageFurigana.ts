import type { FuriganaSegment } from '@nihongo/contracts/question/get-question'

// #1182 mock: reviewed readings for a few passages; every other passage
// has none, which shows the switch disabled. Each pair is found in order.
const READINGS: ReadonlyArray<
  readonly [string, ReadonlyArray<readonly [string, string]>]
> = [
  [
    '田中さんへ。今日は 五時まで 仕事を します。六時に 駅の 前で 会いましょう。山田',
    [
      ['田中', 'たなか'],
      ['今日', 'きょう'],
      ['五時', 'ごじ'],
      ['仕事', 'しごと'],
      ['六時', 'ろくじ'],
      ['駅', 'えき'],
      ['前', 'まえ'],
      ['会', 'あ'],
      ['山田', 'やまだ']
    ]
  ],
  [
    '図書館の お知らせ\n本を 返す 場所\n図書館が 開いている とき：一階の カウンター\n図書館が 閉まっている とき：入り口の 横の 箱\nCDは 箱に 入れないで ください。カウンターで 返して ください。',
    [
      ['図書館', 'としょかん'],
      ['知', 'し'],
      ['本', 'ほん'],
      ['返', 'かえ'],
      ['場所', 'ばしょ'],
      ['図書館', 'としょかん'],
      ['開', 'あ'],
      ['一階', 'いっかい'],
      ['図書館', 'としょかん'],
      ['閉', 'し'],
      ['入', 'い'],
      ['口', 'ぐち'],
      ['横', 'よこ'],
      ['箱', 'はこ'],
      ['箱', 'はこ'],
      ['入', 'い'],
      ['返', 'かえ']
    ]
  ],
  [
    'わたしは 先月から 自転車で 会社へ 通っています。電車より 少し 時間が かかりますが、朝の 運動になるので 気に入っています。雨の 日だけは 電車に 乗ります。',
    [
      ['先月', 'せんげつ'],
      ['自転車', 'じてんしゃ'],
      ['会社', 'かいしゃ'],
      ['通', 'かよ'],
      ['電車', 'でんしゃ'],
      ['少', 'すこ'],
      ['時間', 'じかん'],
      ['朝', 'あさ'],
      ['運動', 'うんどう'],
      ['気', 'き'],
      ['入', 'い'],
      ['雨', 'あめ'],
      ['日', 'ひ'],
      ['電車', 'でんしゃ'],
      ['乗', 'の']
    ]
  ]
]

const toSegments = (
  passage: string,
  pairs: ReadonlyArray<readonly [string, string]>
): FuriganaSegment[] => {
  let at = 0
  return pairs.map(([base, reading]) => {
    const index = passage.indexOf(base, at)
    at = index + base.length
    return {
      start: Array.from(passage.slice(0, index)).length,
      length: Array.from(base).length,
      reading
    }
  })
}

const BY_PASSAGE = new Map(
  READINGS.map(([passage, pairs]) => [passage, toSegments(passage, pairs)])
)

export const mockPassageFurigana = (
  passage: string | null
): FuriganaSegment[] | null => (passage && BY_PASSAGE.get(passage)) || null
