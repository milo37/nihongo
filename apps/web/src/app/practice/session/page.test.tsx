import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createStudySession } from '@api/study/createStudySession'
import { submitStudySession } from '@api/study/submitStudySession'
import { PracticeSessionPage } from '@app/practice/session/page'
import { queryClient } from '@libs/queryClient'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'

describe('PracticeSessionPage', () => {
  it('숫자 키와 클릭 선택이 같은 답안 상태와 radio 상태를 갱신한다', async () => {
    const user = userEvent.setup()
    const sessionPayload = await createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 5
    })
    const firstQuestion = sessionPayload.questions[0]

    expect(firstQuestion).toBeDefined()
    if (!firstQuestion) {
      return
    }

    useAppStore
      .getState()
      .beginPractice(
        sessionPayload.session.id,
        sessionPayload.session.startedAt
      )

    const router = createMemoryRouter(
      [
        {
          path: '/practice/session/:sessionId',
          element: (
            <ProtectedRouteProvider>
              <PracticeSessionPage />
            </ProtectedRouteProvider>
          )
        }
      ],
      {
        initialEntries: [`/practice/session/${sessionPayload.session.id}`]
      }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const firstOption = await screen.findByRole('radio', {
      name: `1. ${firstQuestion.options[0]?.text}`
    })
    const secondOption = screen.getByRole('radio', {
      name: `2. ${firstQuestion.options[1]?.text}`
    })

    fireEvent.keyDown(window, { key: '2' })
    expect(secondOption).toBeChecked()
    expect(useAppStore.getState().selectedAnswers[firstQuestion.id]).toBe(
      firstQuestion.options[1]?.id
    )

    await user.click(firstOption)
    expect(firstOption).toBeChecked()
    expect(secondOption).not.toBeChecked()
    expect(useAppStore.getState().selectedAnswers[firstQuestion.id]).toBe(
      firstQuestion.options[0]?.id
    )

    fireEvent.keyDown(firstOption, { key: '2' })
    expect(secondOption).toBeChecked()
    expect(useAppStore.getState().selectedAnswers[firstQuestion.id]).toBe(
      firstQuestion.options[1]?.id
    )
  })

  it('제출 Dialog가 열리면 배경 문제의 숫자 단축키를 비활성화한다', async () => {
    const user = userEvent.setup()
    const sessionPayload = await createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const question = sessionPayload.questions[0]

    expect(question).toBeDefined()
    if (!question) {
      return
    }

    useAppStore
      .getState()
      .beginPractice(
        sessionPayload.session.id,
        sessionPayload.session.startedAt
      )
    const router = createMemoryRouter(
      [
        {
          path: '/practice/session/:sessionId',
          element: (
            <ProtectedRouteProvider>
              <PracticeSessionPage />
            </ProtectedRouteProvider>
          )
        }
      ],
      { initialEntries: [`/practice/session/${sessionPayload.session.id}`] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const firstOption = await screen.findByRole('radio', {
      name: `1. ${question.options[0]?.text}`
    })
    const secondOption = screen.getByRole('radio', {
      name: `2. ${question.options[1]?.text}`
    })
    await user.click(firstOption)
    await user.click(screen.getByRole('button', { name: '답안 제출' }))
    expect(
      screen.getByRole('heading', { name: '답안을 제출하시겠습니까?' })
    ).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '2' })
    expect(firstOption).toBeChecked()
    expect(secondOption).not.toBeChecked()
  })

  it('이미 제출한 세션으로 돌아오면 결과 경로로 이동한다', async () => {
    const sessionPayload = await createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    await submitStudySession(sessionPayload.session.id, {
      answers: [],
      durationSec: 5
    })
    const router = createMemoryRouter(
      [
        {
          path: '/practice/session/:sessionId',
          element: (
            <ProtectedRouteProvider>
              <PracticeSessionPage />
            </ProtectedRouteProvider>
          )
        },
        {
          path: '/practice/result/:sessionId',
          element: <p>제출 결과 도착</p>
        }
      ],
      { initialEntries: [`/practice/session/${sessionPayload.session.id}`] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(await screen.findByText('제출 결과 도착')).toBeInTheDocument()
  })
})
