import { render } from '@testing-library/react'
import { JaText } from '@common/components/JaText'

const html = (node: Parameters<typeof render>[0]) =>
  render(node).container.innerHTML

describe('JaText ruby (#1182)', () => {
  it('renders as before without readings', () => {
    const text = '「東京」へ行く。'
    expect(html(<JaText ruby={[]} text={text} />)).toBe(
      html(<JaText text={text} />)
    )
  })

  it('puts the readings over their groups', () => {
    const { container } = render(
      <JaText
        ruby={[
          { from: 0, to: 2, reading: 'きょう' },
          { from: 3, to: 4, reading: 'あめ' }
        ]}
        text="今日は雨です"
      />
    )
    expect(
      [...container.querySelectorAll('ruby')].map((ruby) => ruby.innerHTML)
    ).toEqual(['今日<rt>きょう</rt>', '雨<rt>あめ</rt>'])
    expect(container.textContent).toBe('今日きょうは雨あめです')
  })

  it('keeps a whole reading inside a held bracket piece', () => {
    const { container } = render(
      <JaText
        ruby={[{ from: 1, to: 3, reading: 'とうきょう' }]}
        text="「東京」へ"
      />
    )
    const held = container.querySelectorAll('span.whitespace-nowrap')
    // 「東 is held with its bracket; the piece grows to hold 東京, and 京」
    // joins it, so the reading never splits.
    expect([...held].map((span) => span.innerHTML)).toEqual([
      '「<ruby>東京<rt>とうきょう</rt></ruby>」'
    ])
  })
})
