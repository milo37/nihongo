import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { WrongNoteDetailContent } from '@app/wrong-note/detail/page'
import { originalQuestions } from '@mocks/data/questions'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { ToastProvider } from '@common/components/Toast'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

describe('wrong-note memo workflow', () => {
  it('dirty 이탈을 막고 저장 성공 후 확정값으로 reset한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const question = originalQuestions.find(
      ({ id }) => id === 'n5-vocabulary-01'
    )
    const wrongOption = question?.options.find(({ isCorrect }) => !isCorrect)
    expect(question).toBeDefined()
    expect(wrongOption).toBeDefined()
    if (!question || !wrongOption) {
      return
    }

    const { session } = mockDatabase.createStudySession({
      level: question.level,
      subject: question.subject,
      mode: 'RANDOM',
      count: 1,
      questionIds: [question.id]
    })
    mockDatabase.submitStudySession({
      sessionId: session.id,
      answers: [
        {
          questionId: question.id,
          selectedOptionId: wrongOption.id,
          elapsedSec: 4
        }
      ],
      durationSec: 4
    })
    const data = mockDatabase.getWrongNote(currentUser.id, question.id)
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    const router = createMemoryRouter(
      [
        {
          path: '/wrong-notes/:questionId',
          element: <WrongNoteDetailContent data={data} />
        },
        {
          path: '/next',
          element: <h1>다음 화면</h1>
        }
      ],
      { initialEntries: ['/wrong-notes/' + question.id] }
    )

    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    )

    const textarea = screen.getByRole('textbox', { name: '나의 메모' })
    const saveButton = screen.getByRole('button', { name: '메모 저장' })
    const retryButton = screen.getByRole('button', {
      name: '이 문제 다시 풀기'
    })
    expect(saveButton).toBeDisabled()

    await user.type(textarea, '동사 활용을 다시 확인')
    expect(saveButton).toBeEnabled()
    expect(retryButton).toBeDisabled()
    expect(
      screen.getByText('저장하지 않은 변경사항이 있습니다.')
    ).toBeInTheDocument()

    const beforeUnloadEvent = new Event('beforeunload', {
      cancelable: true
    })
    window.dispatchEvent(beforeUnloadEvent)
    expect(beforeUnloadEvent.defaultPrevented).toBe(true)

    act(() => {
      void router.navigate('/next')
    })
    expect(
      await screen.findByRole('heading', {
        name: '저장하지 않은 메모를 버리시겠습니까?'
      })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '계속 작성' }))
    expect(router.state.location.pathname).toContain('/wrong-notes/')

    await user.click(saveButton)
    expect(await screen.findByText('메모를 저장했습니다.')).toBeInTheDocument()
    expect(saveButton).toBeDisabled()
    expect(retryButton).toBeEnabled()
    expect(
      mockDatabase.getWrongNote(currentUser.id, question.id).wrongNote.memo
    ).toBe('동사 활용을 다시 확인')

    await act(async () => {
      await router.navigate('/next')
    })
    expect(
      await screen.findByRole('heading', { name: '다음 화면' })
    ).toBeInTheDocument()
  })

  it('저장 중 중복 제출을 막고 실패 후 입력과 dirty 상태를 유지한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const question = originalQuestions.find(
      ({ id }) => id === 'n5-vocabulary-01'
    )
    const wrongOption = question?.options.find(({ isCorrect }) => !isCorrect)
    expect(question).toBeDefined()
    expect(wrongOption).toBeDefined()
    if (!question || !wrongOption) {
      return
    }

    const { session } = mockDatabase.createStudySession({
      level: question.level,
      subject: question.subject,
      mode: 'RANDOM',
      count: 1,
      questionIds: [question.id]
    })
    mockDatabase.submitStudySession({
      sessionId: session.id,
      answers: [
        {
          questionId: question.id,
          selectedOptionId: wrongOption.id,
          elapsedSec: 4
        }
      ],
      durationSec: 4
    })
    const data = mockDatabase.getWrongNote(currentUser.id, question.id)
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    const router = createMemoryRouter(
      [
        {
          path: '/wrong-notes/:questionId',
          element: <WrongNoteDetailContent data={data} />
        }
      ],
      { initialEntries: ['/wrong-notes/' + question.id] }
    )
    let requestCount = 0
    let releaseRequest = (): void => undefined
    const requestPending = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    mockServer.use(
      http.put(`*/api/wrong-note/${question.id}/memo`, async () => {
        requestCount += 1
        await requestPending
        return HttpResponse.json(
          { message: 'temporary memo error' },
          { status: 500 }
        )
      })
    )

    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    )

    const textarea = screen.getByRole('textbox', { name: '나의 메모' })
    const saveButton = screen.getByRole('button', { name: '메모 저장' })
    await user.type(textarea, '실패해도 남아야 하는 메모')
    await user.click(saveButton)

    expect(screen.getByText('메모를 저장하고 있습니다…')).toBeInTheDocument()
    expect(textarea).toBeDisabled()
    expect(saveButton).toBeDisabled()
    await waitFor(() => expect(requestCount).toBe(1))
    await user.click(saveButton)
    expect(requestCount).toBe(1)
    releaseRequest()
    await waitFor(() => expect(saveButton).toBeEnabled())
    expect(textarea).toHaveValue('실패해도 남아야 하는 메모')
    expect(
      screen.getByText('저장하지 않은 변경사항이 있습니다.')
    ).toBeInTheDocument()
  })
})
