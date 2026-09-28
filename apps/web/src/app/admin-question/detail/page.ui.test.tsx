import { render, screen, within } from '@testing-library/react'
import type { DiffQuestionVersionResponse } from '@nihongo/contracts/admin/phase7'
import { describe, expect, it } from 'vitest'
import { Phase7QuestionVersionDiff } from '@app/admin-question/detail/page'

const diff: DiffQuestionVersionResponse = {
  baseVersionId: 'base-version',
  targetVersionId: 'target-version',
  changedFields: ['QUESTION_TEXT', 'OPTIONS', 'TAGS'],
  changes: [
    {
      field: 'QUESTION_TEXT',
      kind: 'SCALAR',
      before: '변경 전 문제',
      after: '변경 후 문제'
    },
    {
      field: 'OPTIONS',
      kind: 'OPTIONS',
      before: [
        { ordinal: 1, text: '이전 하나', isCorrect: true },
        { ordinal: 2, text: '이전 둘', isCorrect: false },
        { ordinal: 3, text: '이전 셋', isCorrect: false },
        { ordinal: 4, text: '이전 넷', isCorrect: false }
      ],
      after: [
        { ordinal: 1, text: '이후 하나', isCorrect: false },
        { ordinal: 2, text: '이후 둘', isCorrect: true },
        { ordinal: 3, text: '이후 셋', isCorrect: false },
        { ordinal: 4, text: '이후 넷', isCorrect: false }
      ]
    },
    {
      field: 'TAGS',
      kind: 'TAGS',
      before: [
        { id: 'tag-before', label: '이전 태그', normalizedName: '이전 태그' }
      ],
      after: [
        { id: 'tag-after', label: '이후 태그', normalizedName: '이후 태그' }
      ]
    }
  ]
}

describe('Phase7QuestionVersionDiff', () => {
  it('renders scalar, option, answer, and tag values in labelled before/after regions', () => {
    render(<Phase7QuestionVersionDiff value={diff} />)

    const questionBefore = screen.getByRole('region', {
      name: '문제 문장 변경 전'
    })
    const questionAfter = screen.getByRole('region', {
      name: '문제 문장 변경 후'
    })
    expect(within(questionBefore).getByText('변경 전 문제')).toBeVisible()
    expect(within(questionAfter).getByText('변경 후 문제')).toBeVisible()

    const optionsBefore = screen.getByRole('region', {
      name: '선택지와 정답 변경 전'
    })
    const optionsAfter = screen.getByRole('region', {
      name: '선택지와 정답 변경 후'
    })
    expect(within(optionsBefore).getByText('1. 이전 하나 (정답)')).toBeVisible()
    expect(within(optionsAfter).getByText('2. 이후 둘 (정답)')).toBeVisible()

    expect(
      within(screen.getByRole('region', { name: '태그 변경 전' })).getByText(
        '이전 태그'
      )
    ).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: '태그 변경 후' })).getByText(
        '이후 태그'
      )
    ).toBeVisible()
  })
})
