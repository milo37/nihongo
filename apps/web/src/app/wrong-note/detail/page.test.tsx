import { render, screen } from '@testing-library/react'
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
