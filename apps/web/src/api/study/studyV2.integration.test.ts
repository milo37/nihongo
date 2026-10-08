import { describe, expect, it, vi } from 'vitest'
import { apiClient } from '@api/config'
import type { HttpResponseWithMetadata } from '@api/http'
import { cancelStudySession } from '@api/study/cancelStudySession'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { getStudySessionV2 } from '@api/study/getStudySessionV2'
import { listResumableStudySessions } from '@api/study/listResumableStudySessions'
import { saveStudyDraftAnswers } from '@api/study/saveStudyDraftAnswers'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const createSession = () =>
  createStudySessionV2({
    count: 2,
    level: 'N5',
    mode: 'RANDOM',
    subject: 'VOCABULARY'
  })

const expectJsonMetadata = (
  response: HttpResponseWithMetadata<unknown>,
  status: number
): void => {
  expect(response.status).toBe(status)
  expect(response.headers).toMatchObject({
    'cache-control': 'private, no-store',
    'idempotency-replayed': null,
    location: null,
    'x-nihongo-practice-contract': '2'
  })
  expect(response.headers['content-type']).toMatch(/^application\/json/u)
}

describe('practice contract v2 endpoint adapters', () => {
  it('validates create, get, draft, resumable, save, and cancellation metadata', async () => {
    mockDatabase.loginAs('USER')
    const created = await createSession()
    expectJsonMetadata(created, 201)

    const sessionId = created.data.session.id
    const session = await getStudySessionV2(sessionId)
    expectJsonMetadata(session, 200)
    expect(session.data.session.practiceContractVersion).toBe(2)

    const initialDraft = await getStudyDraftAnswers(sessionId)
    expectJsonMetadata(initialDraft, 200)
    expect(initialDraft.data.revision).toBe(0)

    const resumable = await listResumableStudySessions({
      page: 1,
      pageSize: 20,
      status: 'IN_PROGRESS'
    })
    expectJsonMetadata(resumable, 200)
    expect(resumable.data.items.map(({ id }) => id)).toContain(sessionId)

    const saved = await saveStudyDraftAnswers(
      sessionId,
      {
        answers: initialDraft.data.answers.map((answer, index) => ({
          ...answer,
          elapsedSec: index + 1
        })),
        currentOrdinal: 2,
        expectedRevision: 0
      },
      crypto.randomUUID()
    )
    expectJsonMetadata(saved, 200)
    expect(saved.data).toMatchObject({ currentOrdinal: 2, revision: 1 })

    const cancelled = await cancelStudySession(sessionId)
    expect(cancelled).toEqual({
      data: undefined,
      headers: {
        'cache-control': 'private, no-store',
        'content-type': null,
        'idempotency-replayed': null,
        location: null,
        'x-nihongo-practice-contract': '2'
      },
      status: 204
    })
  })

  it('submits the exact saved draft revision through the v2 adapter', async () => {
    mockDatabase.loginAs('USER')
    const created = await createSession()
    const draft = await getStudyDraftAnswers(created.data.session.id)
    const answers = draft.data.answers.map((answer) => ({
      ...answer,
      elapsedSec: 2
    }))
    const saved = await saveStudyDraftAnswers(
      created.data.session.id,
      {
        answers,
        currentOrdinal: 1,
        expectedRevision: 0
      },
      crypto.randomUUID()
    )

    const submitted = await submitStudySessionV2(
      created.data.session.id,
      {
        answers: saved.data.answers,
        durationSec: 4,
        expectedDraftRevision: saved.data.revision
      },
      crypto.randomUUID()
    )

    expectJsonMetadata(submitted, 201)
    expect(submitted.data).toMatchObject({
      durationSec: 4,
      totalCount: 2
    })
  })

  it('rejects malformed idempotency keys before any transport call', async () => {
    const put = vi.spyOn(apiClient, 'put')
    const post = vi.spyOn(apiClient, 'post')
    const sessionId = crypto.randomUUID()
    const answer = {
      elapsedSec: 0,
      selectedOptionId: null,
      studySessionQuestionId: crypto.randomUUID()
    }

    expect(() =>
      saveStudyDraftAnswers(
        sessionId,
        { answers: [answer], currentOrdinal: 1, expectedRevision: 0 },
        'not-a-uuid'
      )
    ).toThrow()
    expect(() =>
      submitStudySessionV2(
        sessionId,
        {
          answers: [answer],
          durationSec: 0,
          expectedDraftRevision: 0
        },
        'not-a-uuid'
      )
    ).toThrow()

    expect(put).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })
})
