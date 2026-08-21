import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import { WrongNoteDetailContent } from '@app/wrong-note/detail/page'

const createDetail = (
  reviewAvailability: 'ARCHIVED' | 'AVAILABLE'
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
    explanationJa: null,
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
  it('현재 문제는 직접 ID 재출제 대신 canonical 모드 설정으로 안내한다', async () => {
    const user = userEvent.setup()
    renderDetail(createDetail('AVAILABLE'))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(
      screen.getByText(/현재 canonical API에서는 메모 작성과 수정을 지원하지/u)
    ).toBeInTheDocument()
    const practiceLink = screen.getByRole('link', {
      name: '학습 설정으로 이동'
    })
    expect(practiceLink).toHaveAttribute('href', '/practice')
    await user.click(practiceLink)
    expect(
      await screen.findByRole('heading', { name: '학습 설정' })
    ).toBeInTheDocument()
  })

  it('보관된 문제는 재출제 불가 상태를 텍스트로 알린다', () => {
    renderDetail(createDetail('ARCHIVED'))

    expect(screen.getByRole('status')).toHaveTextContent(
      '보관된 문제: 현재 출제 가능한 문제 버전이 없습니다.'
    )
    expect(
      screen.queryByRole('link', { name: '학습 설정으로 이동' })
    ).not.toBeInTheDocument()
  })
})
