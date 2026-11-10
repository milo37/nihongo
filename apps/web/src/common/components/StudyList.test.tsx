import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import {
  StudyList,
  StudyListHeader,
  StudyListRow
} from '@common/components/StudyList'

describe('StudyList (ux2 §1)', () => {
  it('링크 행은 행 전체가 링크 하나이고, 아닌 행은 끝 칸 버튼만 누른다', () => {
    render(
      <MemoryRouter>
        <StudyList header={<StudyListHeader count="2문제" aside="담은 순" />}>
          <StudyListRow
            meta="N2 · 문법"
            text="強い 雨（　）、多くの 人が 来た。"
            sub="1번 틀림"
            end={<span>새 오답</span>}
            to="/wrong-notes/q1"
            label="해설 보기: 強い 雨"
          />
          <StudyListRow
            meta="N5 · 어휘"
            text="きょうは いい 天気です。"
            end={<button type="button">책갈피 빼기</button>}
          />
        </StudyList>
      </MemoryRouter>
    )
    expect(screen.getByText('2문제')).toBeVisible()
    expect(screen.getByText('담은 순')).toBeVisible()
    const [linkRow, plainRow] = screen.getAllByRole('listitem')
    const link = within(linkRow!).getByRole('link', {
      name: '해설 보기: 強い 雨'
    })
    expect(link).toHaveAttribute('href', '/wrong-notes/q1')
    expect(within(linkRow!).queryByRole('button')).toBeNull()
    expect(within(linkRow!).getByText(/強い 雨/)).toHaveAttribute('lang', 'ja')
    expect(within(plainRow!).queryByRole('link')).toBeNull()
    expect(
      within(plainRow!).getByRole('button', { name: '책갈피 빼기' })
    ).toBeVisible()
  })
})
