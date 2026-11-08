import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AccountRecommendations } from '@app/account/components/study/AccountRecommendations'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'

const renderRecommendation = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  const router = createMemoryRouter(
    [
      {
        path: '/account',
        element: (
          <ProtectedRouteProvider>
            <AccountRecommendations />
          </ProtectedRouteProvider>
        )
      }
    ],
    { initialEntries: ['/account'] }
  )
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  )
  return { client, router }
}

it('이용이 제한된 계정이 추천 학습을 시작하면 제한 안내를 보여 준다', async () => {
  const restricted = mockDatabase.loginAs('USER')
  mockDatabase.setAccountRestricted(restricted.id, true)
  const { client, router } = renderRecommendation()
  await userEvent
    .setup()
    .click(
      (
        await screen.findAllByRole('button', { name: /시작$/u })
      )[0] as HTMLElement
    )
  expect(
    await screen.findByText(
      '임시로 이용이 제한된 계정이에요. 새 학습과 신고는 제한이 풀린 뒤 이용할 수 있어요.'
    )
  ).toBeVisible()
  expect(
    screen.queryByText(/추천 학습을 시작하지 못했습니다/u)
  ).not.toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/account')
  client.clear()
})

// Two wrong answers on one question make the mock recommend a single review.
const answerAllWrong = async (mode: 'RANDOM' | 'WRONG_NOTE') => {
  const { data: session } = await createStudySessionV2({
    level: 'N5',
    subject: 'VOCABULARY',
    mode,
    count: 1
  })
  const draft = (await getStudyDraftAnswers(session.session.id)).data
  await submitStudySessionV2(
    session.session.id,
    {
      answers: draft.answers,
      durationSec: 0,
      expectedDraftRevision: draft.revision
    },
    crypto.randomUUID()
  )
}

it('이용이 제한된 계정이 추천 단일 복습을 시작하면 제한 안내를 보여 준다', async () => {
  const restricted = mockDatabase.loginAs('USER')
  await answerAllWrong('RANDOM')
  await answerAllWrong('WRONG_NOTE')
  mockDatabase.setAccountRestricted(restricted.id, true)
  const { client, router } = renderRecommendation()
  await userEvent
    .setup()
    .click(
      (
        await screen.findAllByRole('button', { name: /시작$/u })
      )[0] as HTMLElement
    )
  expect(
    await screen.findByText(
      '임시로 이용이 제한된 계정이에요. 새 학습과 신고는 제한이 풀린 뒤 이용할 수 있어요.'
    )
  ).toBeVisible()
  expect(
    screen.queryByText(/단일 복습을 시작하지 못했습니다/u)
  ).not.toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/account')
  client.clear()
})
