import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Table, TableSortHeader } from '@common/components/Table'

describe('Table', () => {
  it('가로 스크롤 영역과 표 caption을 각각 접근 가능한 이름으로 노출한다', () => {
    render(
      <Table caption="학습 기록" scrollLabel="학습 기록 표 가로 스크롤">
        <thead>
          <tr>
            <th scope="col">날짜</th>
            <th scope="col">정답률</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2026-09-28</td>
            <td>80%</td>
          </tr>
        </tbody>
      </Table>
    )

    expect(
      screen.getByRole('region', { name: '학습 기록 표 가로 스크롤' })
    ).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('table', { name: '학습 기록' })).toBeVisible()
  })

  it('active sort에만 aria-sort를 두고 모든 정렬 방향을 비색상 기호로 알린다', async () => {
    const user = userEvent.setup()
    const onSortDate = vi.fn()
    const onSortRate = vi.fn()

    render(
      <Table caption="학습 기록">
        <thead>
          <tr>
            <TableSortHeader
              direction="descending"
              sortLabel="날짜, 최근순 정렬됨"
              onSort={onSortDate}
            >
              날짜
            </TableSortHeader>
            <TableSortHeader
              sortLabel="정답률, 높은 순으로 정렬"
              onSort={onSortRate}
            >
              정답률
            </TableSortHeader>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2026-09-28</td>
            <td>80%</td>
          </tr>
        </tbody>
      </Table>
    )

    const activeHeader = screen.getByRole('columnheader', {
      name: '날짜'
    })
    const inactiveHeader = screen.getByRole('columnheader', {
      name: '정답률'
    })

    expect(activeHeader).toHaveAttribute('aria-sort', 'descending')
    expect(activeHeader).toHaveTextContent('↓')
    expect(inactiveHeader).not.toHaveAttribute('aria-sort')
    expect(inactiveHeader).toHaveTextContent('↕')

    await user.click(
      screen.getByRole('button', { name: '정답률, 높은 순으로 정렬' })
    )
    expect(onSortRate).toHaveBeenCalledTimes(1)
    expect(onSortDate).not.toHaveBeenCalled()
  })
})
