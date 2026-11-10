import { afterEach, describe, expect, it } from 'vitest'
import { submitStudyAnswers } from '@/test/studySubmission'
import { isApiError } from '@nihongo/browser/api/config'
import { signInMockAccount } from '@/test/auth'
import { createBookmark } from '@api/bookmark/createBookmark'
import { createReport } from '@api/report/createReport'
import { listBookmark } from '@api/bookmark/listBookmark'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { setMockSsoAccountForTesting } from '@mocks/handlers/authHandlers'
import { getCurrentUser } from '@nihongo/browser/api/auth/getCurrentUser/index'
import { logoutUser } from '@api/auth/logoutUser'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import type { SubmitStudySessionV2Request } from '@api/study/submitStudySessionV2/schema'
import { listReviewList } from '@api/wrong-note/listReviewList'

/** Every saved wrong note, in both review states. */
const listSavedWrongNotes = async () => {
  const pages = await Promise.all(
    (['TO_REVIEW', 'REVIEWED'] as const).map((state) =>
      listReviewList({ state, pageSize: 100 })
    )
  )
  return { items: pages.flatMap((page) => page.items) }
}

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
    const reportedQuestion = result.items[0]?.question
    if (!reportedQuestion?.questionVersionId)
      throw new Error('Reportable question fixture required')
    const reportRequest = {
      kind: 'QUESTION' as const,
      location: 'result#1',
      questionId: reportedQuestion.id,
      questionVersionId: reportedQuestion.questionVersionId,
      description: '학습자 문제 신고 화면 상태를 확인합니다.'
    }
    const report = await createReport(reportRequest)
    expect(report).toMatchObject({ status: 'RECEIVED' })
    await expect(createReport(reportRequest)).rejects.toMatchObject({
      code: 'QUESTION_REPORT_DUPLICATE',
      status: 409
    })
    await createReport({
      kind: 'APP_ERROR',
      location: 'result',
      description: '앱 오류 제보 흐름을 확인합니다.'
    })
    // The per-reporter limit is five requests, counting rejected ones.
    for (const _ of [1, 2])
      await expect(createReport(reportRequest)).rejects.toMatchObject({
        code: 'QUESTION_REPORT_DUPLICATE'
      })
    await expect(createReport(reportRequest)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429
    })
    const wrongNotes = await listSavedWrongNotes()
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
    const otherWrongNotes = await listSavedWrongNotes()
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
      (await listSavedWrongNotes()).items.map(({ questionId }) => questionId)
    ).toEqual(wrongNotes.items.map(({ questionId }) => questionId))
    expect(
      (await listBookmark({ page: 1, pageSize: 100 })).items.some(
        ({ questionId }) => questionId === bookmarked
      )
    ).toBe(true)
  })

  it('방금 틀린 문제로 바로 복습(DAILY_REVIEW)을 시작한다', async () => {
    await signInMockAccount()
    const {
      data: { session, questions }
    } = await createStudySessionV2({
      level: 'N4',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 3
    })
    const draft = (await getStudyDraftAnswers(session.id)).data
    await submitStudySessionV2(
      session.id,
      {
        answers: draft.answers,
        durationSec: 0,
        expectedDraftRevision: draft.revision
      },
      crypto.randomUUID()
    )
    // Like the server (#789): NEW and AGAIN notes are due at once.
    const { data: review } = await createStudySessionV2({
      level: 'N4',
      subject: 'GRAMMAR',
      mode: 'DAILY_REVIEW',
      count: 10
    })
    const wrongIds = new Set(questions.map(({ question }) => question.id))
    expect(review.session.actualCount).toBe(questions.length)
    expect(
      review.questions.every(({ question }) => wrongIds.has(question.id))
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
        // JLP-792: no draft comparison; the answer itself is refused.
        expect(error.code).toBe('ANSWER_NOT_IN_SESSION')
        expect(error.isValidationError).toBe(true)
        expect(error.isServerError).toBe(false)
      }
    }
  })

  it('제출은 누락·추가·다른 세션과 잘못된 보기를 거부하고 세션을 보존한다', async () => {
    await signInMockAccount()
    const input = {
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 2
    } as const
    const { data: source } = await createStudySessionV2(input)
    const { data: foreign } = await createStudySessionV2(input)
    const first = source.questions[0]
    const second = source.questions[1]
    const other = foreign.questions[0]
    if (!first || !second || !other) throw new Error('Study fixture required')
    const answer = (
      studySessionQuestionId: string
    ): SubmitStudySessionV2Request['answers'][number] => ({
      studySessionQuestionId,
      selectedOptionId: null,
      elapsedSec: 0
    })
    const firstAnswer = answer(first.sessionQuestionId)
    const secondAnswer = answer(second.sessionQuestionId)
    const submit = async (answers: SubmitStudySessionV2Request['answers']) =>
      submitStudyAnswers(source.session.id, answers, 0)

    for (const answers of [
      [firstAnswer],
      [firstAnswer, secondAnswer, answer(crypto.randomUUID())],
      [firstAnswer, answer(other.sessionQuestionId)]
    ]) {
      await expect(submit(answers)).rejects.toMatchObject({
        code: 'ANSWER_NOT_IN_SESSION',
        status: 422
      })
    }
    await expect(
      submit([
        { ...firstAnswer, selectedOptionId: crypto.randomUUID() },
        secondAnswer
      ])
    ).rejects.toMatchObject({ code: 'OPTION_NOT_IN_VERSION', status: 422 })
    const { data: result } = await submit([firstAnswer, secondAnswer])
    expect(result.totalCount).toBe(2)
    expect(result.incorrectCount).toBe(2)
  })

  it('신고는 로그인과 알려진 문제 버전이 필요하다', async () => {
    const reportRequest = {
      kind: 'QUESTION' as const,
      location: 'result#1',
      questionId: '019d0000-0000-7000-8000-000000000002',
      questionVersionId: '019d0000-0000-7000-8000-000000000001',
      description: '학습자 신고 상태를 확인합니다.'
    }

    await expect(createReport(reportRequest)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      status: 401
    })
    await signInMockAccount()
    await expect(createReport(reportRequest)).rejects.toMatchObject({
      code: 'QUESTION_NOT_AVAILABLE'
    })
    const untrusted = await fetch(`${window.location.origin}/api/v1/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://untrusted.example',
        'Sec-Fetch-Site': 'cross-site'
      },
      body: JSON.stringify(reportRequest)
    })
    expect(untrusted.status).toBe(403)
    expect(await untrusted.json()).toMatchObject({ code: 'UNTRUSTED_ORIGIN' })
  })

  it('제출 경계에서 중복 답안과 잘못된 시간을 거부한다', async () => {
    await signInMockAccount()
    const { data } = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const draft = (await getStudyDraftAnswers(data.session.id)).data
    const answer = draft.answers[0]
    if (!answer) throw new Error('Study answer fixture required')
    const submit = (answers: typeof draft.answers, durationSec: number) =>
      fetch(
        `${window.location.origin}/api/v1/study-sessions/${data.session.id}/submission`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
            'X-Nihongo-Practice-Contract': '2',
            Origin: window.location.origin
          },
          body: JSON.stringify({
            answers,
            durationSec,
            expectedDraftRevision: draft.revision
          })
        }
      )

    const duplicate = await submit([answer, answer], 0)
    expect(duplicate.status).toBe(422)
    expect(await duplicate.json()).toMatchObject({ code: 'DUPLICATE_ANSWER' })
    const duration = await submit([answer], -1)
    expect(duration.status).toBe(422)
    expect(await duration.json()).toMatchObject({ code: 'INVALID_DURATION' })
  })
})
