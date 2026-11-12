import { passageParagraphs } from '@app/practice/session/passageParagraphs'

describe('passageParagraphs (JLP-865)', () => {
  it('makes one block per line and indents prose lines only', () => {
    expect(
      passageParagraphs(
        '社員各位\n総務部\n時差出勤制度の試行について\n来月一日から三か月間、試行します。\n1．出勤時刻は、7時30分・8時30分から選んでください。\n・申し込みは受付でしてください。\n■料金：500円'
      )
    ).toMatchObject([
      { text: '社員各位', indent: false },
      { text: '総務部', indent: false },
      { text: '時差出勤制度の試行について', indent: false },
      { text: '来月一日から三か月間、試行します。', indent: true },
      {
        text: '1．出勤時刻は、7時30分・8時30分から選んでください。',
        indent: false
      },
      { text: '・申し込みは受付でしてください。', indent: false },
      { text: '■料金：500円', indent: false }
    ])
  })

  it('does not indent circled numbers, brackets or notes', () => {
    expect(
      passageParagraphs(
        '① 料理教室です。\n【一回利用】1回です。\n※タオルを持ってきてください。'
      ).map((paragraph) => paragraph.indent)
    ).toEqual([false, false, false])
  })

  it('keeps a one-line passage as one indented paragraph', () => {
    expect(passageParagraphs('はじめまして。キムです。')).toEqual([
      {
        text: 'はじめまして。キムです。',
        indent: true,
        segments: ['はじめまして。キムです。']
      }
    ])
  })

  it('splits out each fill-in blank with its 。 or 、', () => {
    expect(
      passageParagraphs('水を 飲む（\u3000）。前より いいです。')[0]?.segments
    ).toEqual(['水を 飲む', '（\u3000）。', '前より いいです。'])
    expect(
      passageParagraphs('膝の痛み（\u3000）、雨の日（\u3000）以外は')[0]
        ?.segments
    ).toEqual(['膝の痛み', '（\u3000）、', '雨の日', '（\u3000）', '以外は'])
  })
})
