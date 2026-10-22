import { describe, expect, it } from 'vitest'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import { getStudySessionV1 } from '@api/study/getStudySessionV1'
import { submitStudySessionV1 } from '@api/study/submitStudySessionV1'
import { mockDatabase } from '@mocks/repository/mockDatabase'

describe('canonical study endpoint adapters', () => {
  it('creates, reads, submits, replays, and reads a RANDOM result through shared contracts', async () => {
    mockDatabase.loginAs('USER')
    const created = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 2
    })
    const fetched = await getStudySessionV1(created.session.id)
    const body = {
      answers: fetched.questions.map((item) => ({
        studySessionQuestionId: item.sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      })),
      durationSec: 9
    }
    const idempotencyKey = crypto.randomUUID()
    const submitted = await submitStudySessionV1(
      created.session.id,
      body,
      idempotencyKey
    )
    const replayed = await submitStudySessionV1(
      created.session.id,
      body,
      idempotencyKey
    )
    const result = await getStudyResultV1(created.session.id)

    expect(fetched).toEqual(created)
    expect(fetched.questions.every((item) => item.ordinal > 0)).toBe(true)
    expect(fetched.questions[0]?.question).not.toHaveProperty('correctOptionId')
    expect(fetched.questions[0]?.question.options[0]).not.toHaveProperty(
      'isCorrect'
    )
    expect(submitted).toEqual(replayed)
    expect(result).toEqual(submitted)
    expect(result.incorrectCount).toBe(result.totalCount)
  })

  it('rejects invalid IDs and idempotency keys before transport', () => {
    expect(() => getStudySessionV1('not-a-uuid')).toThrow()
    expect(() => getStudyResultV1('not-a-uuid')).toThrow()
    expect(() =>
      submitStudySessionV1(
        crypto.randomUUID(),
        {
          answers: [
            {
              studySessionQuestionId: crypto.randomUUID(),
              selectedOptionId: null,
              elapsedSec: 0
            }
          ],
          durationSec: 0
        },
        'not-a-uuid'
      )
    ).toThrow()
  })
})
