import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from '@common/components/Tabs'

const tabs = [
  { id: 'summary', label: '요약', panel: <p>요약 내용</p> },
  { id: 'history', label: '기록', panel: <p>기록 내용</p> },
  { id: 'disabled', label: '비활성', panel: <p>비활성 내용</p>, disabled: true }
] as const

describe('Tabs', () => {
  it('클릭으로 활성 tab과 panel을 함께 바꾼다', async () => {
    const user = userEvent.setup()
    render(<Tabs label="학습 정보" tabs={tabs} />)

    expect(screen.getByRole('tab', { name: '요약' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tabpanel')).toHaveTextContent('요약 내용')

    await user.click(screen.getByRole('tab', { name: '기록' }))

    expect(screen.getByRole('tab', { name: '기록' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tabpanel')).toHaveTextContent('기록 내용')
  })

  it('방향키로 disabled tab을 건너뛰며 포커스와 선택을 이동한다', async () => {
    const user = userEvent.setup()
    render(<Tabs label="학습 정보" tabs={tabs} />)

    const summaryTab = screen.getByRole('tab', { name: '요약' })
    const historyTab = screen.getByRole('tab', { name: '기록' })
    summaryTab.focus()

    await user.keyboard('{ArrowLeft}')
    expect(historyTab).toHaveFocus()
    expect(historyTab).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Home}')
    expect(summaryTab).toHaveFocus()
    expect(summaryTab).toHaveAttribute('aria-selected', 'true')
  })

  it('manual mode에서는 방향키가 roving focus만 옮기고 Enter가 선택을 확정한다', async () => {
    const user = userEvent.setup()
    render(<Tabs activationMode="manual" label="학습 정보" tabs={tabs} />)

    const summaryTab = screen.getByRole('tab', { name: '요약' })
    const historyTab = screen.getByRole('tab', { name: '기록' })
    summaryTab.focus()

    await user.keyboard('{ArrowRight}')

    expect(historyTab).toHaveFocus()
    expect(historyTab).toHaveAttribute('tabindex', '0')
    expect(summaryTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('요약 내용')

    await user.keyboard('{Enter}')

    expect(historyTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('기록 내용')
  })

  it('선택 상태에 shared indicator hook과 aria-selected를 함께 노출한다', () => {
    render(<Tabs label="학습 정보" tabs={tabs} />)

    const selectedTab = screen.getByRole('tab', { name: '요약' })
    const inactiveTab = screen.getByRole('tab', { name: '기록' })

    expect(selectedTab).toHaveClass('ui-tab')
    expect(selectedTab).toHaveAttribute('aria-selected', 'true')
    expect(inactiveTab).toHaveAttribute('aria-selected', 'false')
  })
})
