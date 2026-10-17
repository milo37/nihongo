import { afterEach, describe, expect, it } from 'vitest'
import { isApiError } from '@api/config'
import { signInUser } from '@api/auth/signInUser'
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
    await signInUser({ email: 'user@example.com', password: 'Demo-user-2026!' })
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
  })

  it('세션에 속하지 않은 답안은 검증 오류로 분류한다', async () => {
    await signInUser({ email: 'user@example.com', password: 'Demo-user-2026!' })
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
