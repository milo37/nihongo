import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog } from '@common/components/Dialog'

describe('Dialog', () => {
  it('Tab과 Shift+Tab 포커스를 활성 대화상자 안에서 순환시킨다', async () => {
    const user = userEvent.setup()
    render(
      <Dialog
        open
        title="포커스 순환"
        preventClose
        footer={
          <>
            <button type="button">첫 작업</button>
            <button type="button">마지막 작업</button>
          </>
        }
        onOpenChange={() => undefined}
      />
    )

    const heading = screen.getByRole('heading', { name: '포커스 순환' })
    const firstAction = screen.getByRole('button', { name: '첫 작업' })
    const lastAction = screen.getByRole('button', { name: '마지막 작업' })

    await waitFor(() => expect(heading).toHaveFocus())
    await user.tab()
    expect(firstAction).toHaveFocus()
    await user.tab()
    expect(lastAction).toHaveFocus()
    await user.tab()
    expect(firstAction).toHaveFocus()
    await user.tab({ shift: true })
    expect(lastAction).toHaveFocus()
  })

  it('열기 trigger DOM이 교체돼도 같은 ID의 요소로 포커스를 복원한다', async () => {
    const user = userEvent.setup()
    const Harness = (): ReactElement => {
      const [generation, setGeneration] = useState(0)
      const [open, setOpen] = useState(false)

      return (
        <>
          <button
            key={generation}
            id="dialog-trigger"
            type="button"
            onClick={() => setOpen(true)}
          >
            대화상자 열기
          </button>
          <Dialog
            open={open}
            title="교체 후 복원"
            footer={
              <button
                type="button"
                onClick={() => {
                  setGeneration((current) => current + 1)
                  setOpen(false)
                }}
              >
                적용하기
              </button>
            }
            onOpenChange={setOpen}
          />
        </>
      )
    }
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: '대화상자 열기' }))
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: '교체 후 복원' })
      ).toHaveFocus()
    )
    await user.click(screen.getByRole('button', { name: '적용하기' }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '대화상자 열기' })
      ).toHaveFocus()
    )
  })

  it('명시한 복귀 대상이 분리됐으면 현재 trigger로 포커스를 복원한다', async () => {
    const user = userEvent.setup()
    const Harness = (): ReactElement => {
      const staleReturnFocusRef = useRef<HTMLElement | null>(null)
      const [showOldTrigger, setShowOldTrigger] = useState(true)
      const [open, setOpen] = useState(false)

      return (
        <>
          {showOldTrigger ? (
            <button
              type="button"
              onClick={(event) => {
                staleReturnFocusRef.current = event.currentTarget
                setShowOldTrigger(false)
              }}
            >
              이전 문항 선택
            </button>
          ) : (
            <button type="button" onClick={() => setOpen(true)}>
              현재 문항에서 충돌 열기
            </button>
          )}
          <Dialog
            open={open}
            returnFocusRef={staleReturnFocusRef}
            title="현재 문항 충돌"
            footer={
              <button type="button" onClick={() => setOpen(false)}>
                충돌 해결
              </button>
            }
            onOpenChange={setOpen}
          />
        </>
      )
    }
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: '이전 문항 선택' }))
    const currentTrigger = screen.getByRole('button', {
      name: '현재 문항에서 충돌 열기'
    })
    await user.click(currentTrigger)
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: '현재 문항 충돌' })
      ).toHaveFocus()
    )
    await user.click(screen.getByRole('button', { name: '충돌 해결' }))

    await waitFor(() => expect(currentTrigger).toHaveFocus())
  })

  it('열기 trigger와 같은 ID의 대체 요소가 모두 사라지면 fallback으로 포커스를 복원한다', async () => {
    const user = userEvent.setup()
    const Harness = (): ReactElement => {
      const fallbackFocusRef = useRef<HTMLHeadingElement>(null)
      const [showTrigger, setShowTrigger] = useState(true)
      const [open, setOpen] = useState(false)

      return (
        <>
          <h2 ref={fallbackFocusRef} tabIndex={-1}>
            남은 세션
          </h2>
          {showTrigger ? (
            <button type="button" onClick={() => setOpen(true)}>
              세션 취소 열기
            </button>
          ) : null}
          <Dialog
            open={open}
            fallbackFocusRef={fallbackFocusRef}
            title="세션 취소"
            footer={
              <button
                type="button"
                onClick={() => {
                  setShowTrigger(false)
                  setOpen(false)
                }}
              >
                취소 완료
              </button>
            }
            onOpenChange={setOpen}
          />
        </>
      )
    }
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: '세션 취소 열기' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '세션 취소' })).toHaveFocus()
    )
    await user.click(screen.getByRole('button', { name: '취소 완료' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '남은 세션' })).toHaveFocus()
    )
  })
})
