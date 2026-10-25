import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { useGetStudyDraft } from '@app/practice/hooks/useGetStudyDraft'
import { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import { useSubmitStudySessionV2 } from '@app/practice/hooks/useSubmitStudySessionV2'
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { mockServer } from '@/test/server'
import {
  advanceAuthTransitionEpoch,
  AuthTransitionSupersededError
} from '@libs/authTransitionFence'
import { serverStateQueryKeys } from '@libs/serverStateQueryKeys'

describe('v2 submission while the practice observer is still mounted', () => {
  it.each([false, true])(
    'does not recreate the active draft query after submission (auth transition during cancellation: %s)',
    async (transitionDuringCancel) => {
      const { data: created } = await createStudySessionV2({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      })
      const sessionId = created.session.id
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false }
        }
      })
      const sessionKey = studySessionQueries.session(sessionId).queryKey
      client.setQueryData(sessionKey, toCanonicalStudySessionView(created))
      const draftReads = vi.fn()
      const draftStatuses: number[] = []
      const observeDraft = ({ request }: { request: Request }): void => {
        if (
          request.method === 'GET' &&
          new URL(request.url).pathname ===
            `/api/v1/study-sessions/${sessionId}/draft-answers`
        ) {
          draftReads()
        }
      }
      const observeDraftResponse = ({
        request,
        response
      }: {
        request: Request
        response: Response
      }): void => {
        if (
          request.method === 'GET' &&
          new URL(request.url).pathname ===
            `/api/v1/study-sessions/${sessionId}/draft-answers`
        )
          draftStatuses.push(response.status)
      }
      mockServer.events.on('request:start', observeDraft)
      mockServer.events.on('response:mocked', observeDraftResponse)
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
      const { result, rerender, unmount } = renderHook(
        () => {
          const session = useGetStudySession(sessionId)
          const draft = useGetStudyDraft(
            sessionId,
            session.data?.session.status === 'IN_PROGRESS'
          )
          const submission = useSubmitStudySessionV2(
            sessionId,
            getStudyDraftPrincipalScope(null)
          )
          return { session, draft, submission }
        },
        { wrapper }
      )
      try {
        await waitFor(() => expect(result.current.draft.isSuccess).toBe(true))
        const draft = result.current.draft.data
        if (!draft) throw new Error('A canonical draft is required')
        expect(draftReads).toHaveBeenCalledTimes(1)
        if (transitionDuringCancel) {
          const cancelQueries = client.cancelQueries.bind(client)
          vi.spyOn(client, 'cancelQueries').mockImplementation(
            async (...args) => {
              await cancelQueries(...args)
              advanceAuthTransitionEpoch()
            }
          )
        }
        let failure: unknown
        await act(async () => {
          try {
            await result.current.submission.mutateAsync({
              answers: draft.answers,
              durationSec: 0,
              expectedDraftRevision: draft.revision
            })
          } catch (error: unknown) {
            failure = error
          }
        })
        rerender()
        await waitFor(() =>
          expect(result.current.draft.fetchStatus).toBe('idle')
        )
        if (transitionDuringCancel) {
          expect(failure).toBeInstanceOf(AuthTransitionSupersededError)
          expect(
            client.getQueryData(serverStateQueryKeys.study.result(sessionId))
          ).toBeUndefined()
        } else {
          expect(failure).toBeUndefined()
          expect(result.current.submission.isSuccess).toBe(true)
          expect(
            client.getQueryData(serverStateQueryKeys.study.result(sessionId))
          ).toMatchObject({ sessionId })
        }
        expect(draftStatuses).toEqual([200])
        expect(draftReads).toHaveBeenCalledTimes(1)
        expect(result.current.draft.data).toEqual(draft)
        expect(client.getQueryState(sessionKey)?.isInvalidated).toBe(true)
        expect(result.current.draft.isError).toBe(false)
      } finally {
        unmount()
        client.clear()
        mockServer.events.removeListener('request:start', observeDraft)
        mockServer.events.removeListener(
          'response:mocked',
          observeDraftResponse
        )
      }
    }
  )
})
