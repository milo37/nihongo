import { afterEach, describe, expect, it } from 'vitest'
import { isApiError } from '@api/config'
import { signInMockAccount } from '@/test/auth'
import { createBookmark } from '@api/bookmark/createBookmark'
import { listBookmark } from '@api/bookmark/listBookmark'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { setMockSsoAccountForTesting } from '@mocks/handlers/authHandlers'
import { getCurrentUser } from '@api/auth/getCurrentUser'
import { logoutUser } from '@api/auth/logoutUser'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import { listWrongNotesV1 } from '@api/wrong-note/listWrongNotesV1'

describe('MSW 학습 API 흐름', () => {
  afterEach(async () => {
    await logoutUser()
  })

  it('로그인 후 세션을 제출하면 오답노트에 저장한다', async () => {
    await signInMockAccount()
    const user = await getCurrentUser()
    const {
      data: { session, questions }
    } = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 5
    })
    expect(user?.role).toBe('USER')
    expect(session.actualCount).toBeGreaterThan(0)
    expect(questions).toHaveLength(session.actualCount)
    for (const { question } of questions) {
      expect(question).not.toHaveProperty('explanationKo')
      expect(question).not.toHaveProperty('explanationJa')
      expect(question).not.toHaveProperty('correctOptionId')
      for (const option of question.options)
        expect(option).not.toHaveProperty('isCorrect')
    }
    const draft = (await getStudyDraftAnswers(session.id)).data
    const { data: result } = await submitStudySessionV2(
      session.id,
      {
        answers: draft.answers,
        durationSec: 0,
        expectedDraftRevision: draft.revision
      },
      crypto.randomUUID()
    )
    expect(result.correctCount).toBe(0)
    expect(result.incorrectCount).toBe(session.actualCount)
    const wrongNotes = await listWrongNotesV1({ pageSize: 100 })
    const savedQuestionIds = new Set(
      wrongNotes.items.map(({ questionId }) => questionId)
    )
    for (const { question } of questions)
      expect(savedQuestionIds.has(question.id)).toBe(true)
    const bookmarked = questions[0]?.question.id
    if (!bookmarked) throw new Error('Question fixture required')
    await createBookmark(bookmarked)
    await logoutUser()
    setMockSsoAccountForTesting('apple', DEMO_ADMIN_ID)
    await signInMockAccount('apple')
    const otherWrongNotes = await listWrongNotesV1({ pageSize: 100 })
    expect(
      otherWrongNotes.items.every(
        ({ questionId }) => !savedQuestionIds.has(questionId)
      )
    ).toBe(true)
    expect(
      (await listBookmark({ page: 1, pageSize: 100 })).items.some(
        ({ questionId }) => questionId === bookmarked
      )
    ).toBe(false)
    await logoutUser()
    await signInMockAccount('google')
    expect((await getCurrentUser())?.id).toBe(user?.id)
    expect(
      (await listWrongNotesV1({ pageSize: 100 })).items.map(
        ({ questionId }) => questionId
      )
    ).toEqual(wrongNotes.items.map(({ questionId }) => questionId))
    expect(
      (await listBookmark({ page: 1, pageSize: 100 })).items.some(
        ({ questionId }) => questionId === bookmarked
      )
    ).toBe(true)
  })

  it('세션에 속하지 않은 답안은 검증 오류로 분류한다', async () => {
    await signInMockAccount()
    const input = {
      level: 'N5',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 1
    } as const
    const { data: source } = await createStudySessionV2(input)
    const { data: foreign } = await createStudySessionV2(input)
    const foreignQuestion = foreign.questions[0]
    if (!foreignQuestion)
      throw new Error('Canonical foreign session question required')
    const draft = (await getStudyDraftAnswers(source.session.id)).data
    try {
      await submitStudySessionV2(
        source.session.id,
        {
          answers: [
            {
              studySessionQuestionId: foreignQuestion.sessionQuestionId,
              selectedOptionId: null,
              elapsedSec: 0
            }
          ],
          durationSec: 0,
          expectedDraftRevision: draft.revision
        },
        crypto.randomUUID()
      )
      expect.unreachable('검증 오류가 발생해야 합니다.')
    } catch (error: unknown) {
      expect(isApiError(error)).toBe(true)
      if (isApiError(error)) {
        expect(error.status).toBe(422)
        // V2 checks equality with the persisted draft before accepting answers.
        expect(error.code).toBe('DRAFT_SUBMIT_MISMATCH')
        expect(error.isValidationError).toBe(true)
        expect(error.isServerError).toBe(false)
      }
    }
  })
})
