import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { submitStudySessionCommand } from '@app/practice/commands/submitStudySessionCommand'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { studyResultQueries } from '@app/practice/queries/studyResultQueries'
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'
import {
  getOrCreateCanonicalSubmissionAttempt,
  getSubmissionAttemptStorageKey
} from '@app/practice/submissionAttempt'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

vi.mock('@libs/apiMode', () => ({
  apiMode: 'real',
  isMockApiMode: false,
  isRealApiMode: true
}))

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })

const expectAttemptStored = (sessionId: string): void => {
  expect(
    window.sessionStorage.getItem(getSubmissionAttemptStorageKey(sessionId))
  ).not.toBeNull()
}

const expectAttemptCleared = (sessionId: string): void => {
  expect(
    window.sessionStorage.getItem(getSubmissionAttemptStorageKey(sessionId))
  ).toBeNull()
}

describe('canonical submission attempt observation lifecycle', () => {
  it('clears a response-loss attempt after observing SUBMITTED or a ready result', async () => {
    mockDatabase.loginAs('USER')
    const client = createClient()
    const created = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const session = await client.fetchQuery(
      studySessionQueries.session(created.session.id)
    )

    await submitStudySessionCommand({
      sessionId: session.session.id,
      input: { answers: [], durationSec: 4 },
      getCachedSession: () => session
    })
    expectAttemptStored(session.session.id)

    client.removeQueries({
      queryKey: studySessionQueries.session(session.session.id).queryKey
    })
    const submittedSession = await client.fetchQuery(
      studySessionQueries.session(session.session.id)
    )
    expect(submittedSession.session.status).toBe('SUBMITTED')
    expectAttemptCleared(session.session.id)

    getOrCreateCanonicalSubmissionAttempt(
      session.session.id,
      { answers: [], durationSec: 4 },
      session
    )
    expectAttemptStored(session.session.id)
    await client.fetchQuery(studyResultQueries.result(session.session.id))
    expectAttemptCleared(session.session.id)
  })

  it.each(['EXPIRED', 'CANCELLED'] as const)(
    'clears an attempt after observing %s',
    async (status) => {
      mockDatabase.loginAs('USER')
      const rawSession = await createStudySessionV1({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      })
      const sessionId = crypto.randomUUID()
      const terminalSession = {
        ...rawSession,
        session: {
          ...rawSession.session,
          id: sessionId,
          practiceContractVersion: 1 as const,
          status
        }
      }
      const sessionView = toCanonicalStudySessionView(terminalSession)
      getOrCreateCanonicalSubmissionAttempt(
        sessionId,
        { answers: [], durationSec: 4 },
        sessionView
      )
      expectAttemptStored(sessionId)
      mockServer.use(
        http.get('*/api/v1/study-sessions/:sessionId', ({ params }) =>
          params.sessionId === sessionId
            ? HttpResponse.json(terminalSession, {
                headers: {
                  'Cache-Control': 'private, no-store',
                  'X-Nihongo-Practice-Contract': '1'
                }
              })
            : undefined
        )
      )

      const observed = await createClient().fetchQuery(
        studySessionQueries.session(sessionId)
      )
      expect(observed.session.status).toBe(status)
      expectAttemptCleared(sessionId)
    }
  )

  it('clears an unrecoverable attempt when the canonical session is missing', async () => {
    mockDatabase.loginAs('USER')
    const rawSession = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionView = toCanonicalStudySessionView(rawSession)
    getOrCreateCanonicalSubmissionAttempt(
      rawSession.session.id,
      { answers: [], durationSec: 4 },
      sessionView
    )
    expectAttemptStored(rawSession.session.id)
    mockServer.use(
      http.get('*/api/v1/study-sessions/:sessionId', () =>
        HttpResponse.json(
          { code: 'RESOURCE_NOT_FOUND', message: 'missing' },
          { status: 404 }
        )
      )
    )

    await expect(
      createClient().fetchQuery(
        studySessionQueries.session(rawSession.session.id)
      )
    ).rejects.toThrow()
    expectAttemptCleared(rawSession.session.id)
  })
})
