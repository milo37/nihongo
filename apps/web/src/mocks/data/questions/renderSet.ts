import { createOriginalQuestion } from '@mocks/data/questions/createQuestion'

/**
 * Dev-mock render fixtures only (JLP-833): fifteen more N5 vocabulary items
 * so a member can start a 20-question set on the dev server. Loaded only
 * with VITE_MOCK_RENDER_SET=1; never in tests or production.
 */
const words: readonly [string, string, string, string, string][] = [
  ['山', 'やま', 'かわ', 'うみ', 'そら'],
  ['水', 'みず', 'ひ', 'き', 'つち'],
  ['花', 'はな', 'くさ', 'き', 'もり'],
  ['雨', 'あめ', 'ゆき', 'かぜ', 'くも'],
  ['空', 'そら', 'うみ', 'やま', 'いけ'],
  ['手', 'て', 'あし', 'め', 'みみ'],
  ['目', 'め', 'くち', 'はな', 'て'],
  ['口', 'くち', 'め', 'みみ', 'あし'],
  ['車', 'くるま', 'みち', 'えき', 'いえ'],
  ['駅', 'えき', 'みせ', 'まち', 'むら'],
  ['店', 'みせ', 'いえ', 'へや', 'えき'],
  ['魚', 'さかな', 'とり', 'いぬ', 'ねこ'],
  ['犬', 'いぬ', 'ねこ', 'とり', 'うし'],
  ['朝', 'あさ', 'よる', 'ひる', 'ゆうがた'],
  ['夜', 'よる', 'あさ', 'ひる', 'まいにち']
]

export const renderSetQuestions = words.map(
  ([kanji, reading, ...others], index) => {
    const correctIndex = (index % 4) as 0 | 1 | 2 | 3
    const options = [...others]
    options.splice(correctIndex, 0, reading)
    return createOriginalQuestion({
      id: `render-n5-vocabulary-${String(index + 1).padStart(2, '0')}`,
      level: 'N5',
      subject: 'VOCABULARY',
      questionType: 'KANJI_READING',
      questionText: `「${kanji}」の 読み方は どれですか。`,
      options: options as [string, string, string, string],
      correctIndex,
      explanationKo: `「${kanji}」는 「${reading}」라고 읽습니다.`,
      difficulty: 'EASY',
      tags: ['한자 읽기']
    })
  }
)
