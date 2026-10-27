import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { apiClient } from '@nihongo/browser/api/config'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { studyDraftQueries } from '@app/practice/queries/studyDraftQueries'
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'
import { mockServer } from '@/test/server'

it.each(['session', 'draft'] as const)(
  'cancelling a pending %s query aborts its transport before another read',
  async (kind) => {
    const { data: created } = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const path = `/api/v1/study-sessions/${created.session.id}${
      kind === 'draft' ? '/draft-answers' : ''
    }`
    let markStarted = (): void => undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let releaseRequest = (): void => undefined
    const release = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    let signal: AbortSignal | undefined
    // MSW synthesizes a Request for XHR without linking its AbortSignal.
    // Observe Axios's actual XHR abort as well as the forwarded Query signal.
    const abortTransport = vi.spyOn(XMLHttpRequest.prototype, 'abort')
    const interceptor = apiClient.interceptors.request.use((config) => {
      if (config.url && path.endsWith(config.url)) {
        signal = config.signal as AbortSignal | undefined
      }
      return config
    })
    mockServer.use(
      http.get(`*${path}`, async () => {
        markStarted()
        await release
        return HttpResponse.json({ deliberatelyUnconsumed: true })
      })
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    const session = studySessionQueries.session(created.session.id)
    const draft = studyDraftQueries.draft(created.session.id)
    const queryKey = kind === 'session' ? session.queryKey : draft.queryKey
    const pending = (
      kind === 'session' ? client.fetchQuery(session) : client.fetchQuery(draft)
    ).catch((error: unknown) => error)
    try {
      await started
      await client.cancelQueries({ queryKey, exact: true })
      expect(signal).toBeDefined()
      expect(signal?.aborted).toBe(true)
      expect(abortTransport).toHaveBeenCalledTimes(1)
      expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle')
    } finally {
      releaseRequest()
      await pending
      client.clear()
      apiClient.interceptors.request.eject(interceptor)
      abortTransport.mockRestore()
    }
  }
)
