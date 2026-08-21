import { QueryClient } from '@tanstack/react-query'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import { submitStudySessionCommand } from '@app/practice/commands/submitStudySessionCommand'
import { studyResultQueries } from '@app/practice/queries/studyResultQueries'
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })

describe('Phase 4 canonical UI cutover', () => {
  it('uses only canonical v1 routes in mock mode for the practice and learning read flow', async () => {
    const observedPaths: string[] = []
    const captureRequest = ({ request }: { request: Request }): void => {
      observedPaths.push(new URL(request.url).pathname)
    }
    mockServer.events.on('request:start', captureRequest)

    try {
      mockDatabase.loginAs('USER')
      const client = createClient()
      const created = await createStudySessionV1({
        count: 1,
        level: 'N5',
        mode: 'RANDOM',
        subject: 'VOCABULARY'
      })
      const session = await client.fetchQuery(
        studySessionQueries.session(created.session.id)
      )

      await submitStudySessionCommand({
        getCachedSession: () => session,
        input: { answers: [], durationSec: 1 },
        sessionId: session.session.id
      })
      await client.fetchQuery(studyResultQueries.result(session.session.id))
      await client.fetchQuery(
        wrongNoteQueries.list({ page: 1, pageSize: 20, sort: 'RECENT' })
      )
      await client.fetchQuery(dashboardQueries.stats())

      expect(observedPaths).toEqual(
        expect.arrayContaining([
          '/api/v1/study-sessions',
          `/api/v1/study-sessions/${session.session.id}`,
          `/api/v1/study-sessions/${session.session.id}/submission`,
          `/api/v1/study-sessions/${session.session.id}/result`,
          '/api/v1/wrong-notes',
          '/api/v1/dashboard'
        ])
      )
      expect(
        observedPaths.filter(
          (pathname) =>
            pathname.startsWith('/api/study/') ||
            pathname === '/api/dashboard/stats' ||
            pathname.startsWith('/api/wrong-note')
        )
      ).toEqual([])
    } finally {
      mockServer.events.removeListener('request:start', captureRequest)
    }
  })
})
