import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import { WrongNoteDetailContent } from '@app/wrong-note/detail/page'
import { appI18n } from '@/i18n/config'

const createDetail = (
  reviewAvailability: 'ARCHIVED' | 'AVAILABLE',
  explanationJa: string | null = null
): WrongNoteDetailView => ({
  wrongNote: {
    questionId: crypto.randomUUID(),
    wrongCount: 1,
    correctStreak: 0,
    status: 'NEW',
    lastWrongAt: '2026-08-21T00:00:00.000Z',
    lastReviewedAt: null,
    nextReviewAt: '2026-08-22T00:00:00.000Z',
    reviewAvailability
  },
  question: {
    id: crypto.randomUUID(),
    questionVersionId: crypto.randomUUID(),
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    passage: null,
    questionText: '「山」の読み方を選んでください。',
    options: [
      { id: crypto.randomUUID(), label: '1', text: 'やま', isCorrect: true },
      { id: crypto.randomUUID(), label: '2', text: 'かわ', isCorrect: false }
    ],
    explanationKo: '山은 やま라고 읽습니다.',
    explanationJa,
    difficulty: 'EASY',
    tags: ['한자']
  },
  memo: null,
  currentReviewQuestionVersionId: crypto.randomUUID(),
  canRetry: false,
  canUpdateMemo: false
})

const renderDetail = (data: WrongNoteDetailView): void => {
  const router = createMemoryRouter(
    [
      {
        path: '/wrong-notes/:questionId',
        element: <WrongNoteDetailContent data={data} />
      },
      { path: '/practice', element: <h1>학습 설정</h1> }
    ],
    { initialEntries: [`/wrong-notes/${data.question.id}`] }
  )
  render(<RouterProvider router={router} />)
}

describe('canonical wrong-note detail', () => {
  it('일본어 원문을 표시하고 payload에 일본어 해설이 없으면 한국어 fallback만 제공한다', () => {
    renderDetail(createDetail('AVAILABLE'))

    expect(
      screen.getByText('「山」の読み方を選んでください。')
    ).toHaveAttribute('lang', 'ja')
    expect(screen.getByText('1. やま')).toHaveAttribute('lang', 'ja')
    expect(screen.getByText('山은 やま라고 읽습니다.')).toHaveAttribute(
      'lang',
      'ko'
    )
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(
      screen.getByText('일본어 해설이 없어 한국어 해설을 표시합니다.')
    ).toBeVisible()
  })

  it('일본어 해설이 있을 때도 한국어를 기본으로 두고 명시적 선택 뒤 전환한다', async () => {
    const user = userEvent.setup()
    renderDetail(createDetail('AVAILABLE', '「山」は「やま」と読みます。'))

    expect(screen.getByRole('tab', { name: '한국어' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(
      screen.queryByText('「山」は「やま」と読みます。')
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '日本語' }))
    expect(screen.getByText('「山」は「やま」と読みます。')).toHaveAttribute(
      'lang',
      'ja'
    )

    await act(async () => appI18n.changeLanguage('ja'))

    expect(
      screen.getByRole('heading', { name: '最後に間違えた問題の詳細' })
    ).toBeVisible()
    expect(screen.getByRole('tab', { name: '日本語' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByText('「山」は「やま」と読みます。')).toBeVisible()
  })

  it('cache된 다른 문제 route로 이동하면 해설 선택을 한국어 기본으로 초기화한다', async () => {
    const user = userEvent.setup()
    const first = createDetail('AVAILABLE', '最初の日本語解説')
    const second = createDetail('AVAILABLE', '次の日本語解説')
    const router = createMemoryRouter(
      [
        {
          path: '/first',
          element: <WrongNoteDetailContent data={first} />
        },
        {
          path: '/second',
          element: <WrongNoteDetailContent data={second} />
        }
      ],
      { initialEntries: ['/first'] }
    )
    render(<RouterProvider router={router} />)

    await user.click(screen.getByRole('tab', { name: '日本語' }))
    expect(screen.getByText('最初の日本語解説')).toBeVisible()

    await act(async () => {
      await router.navigate('/second')
    })

    expect(screen.getByRole('tab', { name: '한국어' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByText('山은 やま라고 읽습니다.')).toHaveAttribute(
      'lang',
      'ko'
    )
    expect(screen.queryByText('次の日本語解説')).not.toBeInTheDocument()
  })

  it('마지막 오답 snapshot과 현재 복습 가능 상태를 분리해 알린다', () => {
    renderDetail(createDetail('AVAILABLE'))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(
      screen.getByText(/마지막으로 틀렸을 때 고정된 문제 버전/u)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/현재 출제 가능한 문제 버전으로 단일 복습/u)
    ).toBeInTheDocument()
  })

  it('보관된 문제는 재출제 불가 상태를 텍스트로 알린다', () => {
    renderDetail(createDetail('ARCHIVED'))

    expect(screen.getByRole('status')).toHaveTextContent(
      '보관된 문제: 현재 출제 가능한 문제 버전이 없습니다.'
    )
    expect(screen.queryByText(/단일 복습을 시작/u)).not.toBeInTheDocument()
  })
})
