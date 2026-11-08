import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import type { ReactElement } from 'react'
import {
  TOAST_ANNOUNCER_ID,
  ToastProvider,
  useToast
} from '@nihongo/browser/common/components/Toast'
import type { ToastInput } from '@nihongo/browser/common/components/Toast'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'

let add: (toast: ToastInput) => string = () => ''
const Capture = ({
  onReady
}: {
  onReady: (addToast: typeof add) => void
}): ReactElement => {
  const { addToast } = useToast()
  useEffect(() => onReady(addToast), [addToast, onReady])
  return (
    <main tabIndex={-1}>
      <button type="button">작업</button>
    </main>
  )
}
const setAdd = (addToast: typeof add): void => {
  add = addToast
}
const renderToasts = () =>
  render(
    <I18nProvider>
      <ToastProvider>
        <Capture onReady={setAdd} />
      </ToastProvider>
    </I18nProvider>
  )
const cards = () =>
  within(screen.getByRole('region', { name: '알림' })).queryAllByRole('article')

describe('Toast (U12 §3)', () => {
  afterEach(() => vi.useRealTimers())

  it('항상 있는 live region으로 읽고, 카드에는 live role이 없다', () => {
    renderToasts()
    const announcer = document.getElementById(TOAST_ANNOUNCER_ID)
    expect(announcer).toHaveAttribute('aria-live', 'polite')
    expect(announcer).toBeEmptyDOMElement()
    act(() => {
      add({ title: '책갈피에 저장했어요.', variant: 'success' })
    })
    expect(announcer).toHaveTextContent('성공: 책갈피에 저장했어요.')
    const [card] = cards()
    expect(card).not.toHaveAttribute('role')
    expect(card).not.toHaveAttribute('aria-live')
    // No all-sides border utility, or it would hide the 4px tone strip.
    expect(card!.className.split(' ')).not.toContain('border')
    expect(card!.className.split(' ')).not.toContain('border-line')
    expect(screen.getByRole('button', { name: '알림 닫기' })).toBeVisible()
  })

  it('성공·안내는 5초, 행동 버튼이 있으면 8초, 오프라인은 닫을 때까지 남는다', () => {
    vi.useFakeTimers()
    renderToasts()
    act(() => {
      add({ title: '저장', variant: 'success' })
      add({
        title: '로그인 필요',
        action: { label: '로그인', onClick: () => undefined }
      })
      add({ title: '오프라인', variant: 'warning', persistent: true })
    })
    expect(cards()).toHaveLength(3)
    act(() => vi.advanceTimersByTime(5_000))
    expect(cards().map((card) => card.textContent)).toEqual([
      expect.stringContaining('오프라인'),
      expect.stringContaining('로그인 필요')
    ])
    act(() => vi.advanceTimersByTime(3_000))
    expect(cards()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(60_000))
    expect(cards()).toHaveLength(1)
  })

  it('같은 키는 하나만 두고 시간을 다시 센다', () => {
    vi.useFakeTimers()
    renderToasts()
    act(() => {
      add({ key: 'bookmark', title: '책갈피에 저장했어요.' })
    })
    act(() => vi.advanceTimersByTime(4_000))
    act(() => {
      add({ key: 'bookmark', title: '책갈피에서 뺐어요.' })
    })
    expect(cards()).toHaveLength(1)
    expect(cards()[0]).toHaveTextContent('책갈피에서 뺐어요.')
    act(() => vi.advanceTimersByTime(4_000))
    expect(cards()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.queryByRole('region', { name: '알림' })).toBeNull()
  })

  it('최대 3개, 오프라인은 맨 위에 고정되고 오래된 것부터 닫힌다', () => {
    renderToasts()
    act(() => {
      add({ title: '오프라인', variant: 'warning', persistent: true })
      add({ title: '첫째' })
      add({ title: '둘째' })
      add({ title: '셋째' })
    })
    expect(cards().map((card) => card.textContent)).toEqual([
      expect.stringContaining('오프라인'),
      expect.stringContaining('둘째'),
      expect.stringContaining('셋째')
    ])
  })

  it('행동 버튼은 외곽선 버튼이고, 토스트 안 Esc는 닫고 띄운 버튼으로 초점을 돌린다', async () => {
    const user = userEvent.setup()
    renderToasts()
    const opener = screen.getByRole('button', { name: '작업' })
    opener.focus()
    const onClick = vi.fn()
    act(() => {
      add({ title: '로그인 필요', action: { label: '로그인', onClick } })
    })
    // The toast does not take focus.
    expect(opener).toHaveFocus()
    const action = screen.getByRole('button', { name: '로그인' })
    expect(action.className).toContain('border')
    await user.click(action)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: '알림' })).toBeNull()

    act(() => {
      add({ title: '저장' })
    })
    screen.getByRole('button', { name: '알림 닫기' }).focus()
    fireEvent.keyDown(cards()[0]!, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: '알림' })).toBeNull()
    expect(screen.getByRole('main')).toHaveFocus()
  })
})
