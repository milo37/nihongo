import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  studyDraftSnapshotSchema,
  type StudyDraftSnapshot
} from '@nihongo/contracts/study/study-draft'
import { withErrorFlags } from '@nihongo/browser/api/config'
import { usePracticeDraftController } from '@app/practice/hooks/usePracticeDraftController'
import type { SaveStudyDraftMutationInput } from '@app/practice/queries/studyDraftQueries'
import {
  clearStudyDraftWorkingCopyMemoryCache,
  readStudyDraftWorkingCopy
} from '@nihongo/browser/app/practice/draft/studyDraftWorkingCopyStorage'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import { useAppStore } from '@nihongo/browser/store/index'

const io = vi.hoisted(() => ({
  initial: vi.fn(),
  save: vi.fn(),
  canonical: vi.fn()
}))
vi.mock('@app/practice/hooks/useGetStudyDraft', () => ({
  useGetStudyDraft: () => ({ data: io.initial(), isError: false, error: null })
}))
vi.mock('@app/practice/hooks/useSaveStudyDraft', () => ({
  useSaveStudyDraft: () => ({ mutateAsync: io.save })
}))
vi.mock('@app/practice/queries/studyDraftQueries', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@app/practice/queries/studyDraftQueries')
  >()),
  fetchStudyDraftSnapshot: io.canonical
}))
vi.mock('@app/practice/queries/studySessionQueries', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@app/practice/queries/studySessionQueries')
    >()
  return {
    ...original,
    studySessionQueries: {
      ...original.studySessionQueries,
      session: (sessionId: string) => ({
        queryKey: ['controller-test-session', sessionId],
        queryFn: async () => ({ session: { status: 'IN_PROGRESS' } })
      })
    }
  }
})

let server: StudyDraftSnapshot
let optionA: string
let optionB: string
let startedAt: number[]
const questions = (): string[] =>
  server.answers.map((answer) => answer.studySessionQuestionId)
const answer = (): string => questions()[0]!
const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
const accept = (input: SaveStudyDraftMutationInput) => {
  if (input.body.expectedRevision !== server.revision) {
    throw withErrorFlags(new Error('synthetic stale revision'), {
      code: 'DRAFT_VERSION_CONFLICT',
      status: 409
    })
  }
  server = studyDraftSnapshotSchema.parse({
    studySessionId: server.studySessionId,
    revision: server.revision + 1,
    savedAt: new Date().toISOString(),
    currentOrdinal: input.body.currentOrdinal,
    answers: input.body.answers
  })
  return { data: server }
}
const mount = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    ({ enabled, sessionId }) =>
      usePracticeDraftController({
        enabled,
        sessionId,
        user: null,
        expectedSessionQuestionIds: questions(),
        isInteractionPaused: true
      }),
    {
      wrapper,
      initialProps: { enabled: true, sessionId: server.studySessionId }
    }
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-21T06:00:00.000Z'))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  optionA = crypto.randomUUID()
  optionB = crypto.randomUUID()
  server = studyDraftSnapshotSchema.parse({
    studySessionId: crypto.randomUUID(),
    revision: 0,
    currentOrdinal: 1,
    savedAt: null,
    answers: [
      {
        studySessionQuestionId: crypto.randomUUID(),
        selectedOptionId: null,
        elapsedSec: 0
      },
      {
        studySessionQuestionId: crypto.randomUUID(),
        selectedOptionId: null,
        elapsedSec: 0
      }
    ]
  })
  startedAt = []
  io.initial.mockReset().mockImplementation(() => server)
  io.canonical.mockReset().mockImplementation(async () => server)
  io.save
    .mockReset()
    .mockImplementation(async (input: SaveStudyDraftMutationInput) => {
      startedAt.push(Date.now())
      return accept(input)
    })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('practice draft autosave pacing', () => {
  it('bursts persist locally immediately and send only the latest body after 2s idle', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    expect(
      readStudyDraftWorkingCopy('GUEST', server.studySessionId)?.localDiff
        .answers[answer()]?.selectedOptionId
    ).toBe(optionA)
    await advance(1_000)
    act(() => h.result.current.selectOption(answer(), optionB))
    await advance(1_999)
    expect(io.save).not.toHaveBeenCalled()
    await advance(1)
    expect(io.save).toHaveBeenCalledTimes(1)
    expect(server.answers[0]?.selectedOptionId).toBe(optionB)
    expect(io.canonical).toHaveBeenCalledTimes(1)
  })

  it('continuous edits keep the oldest deadline and start a save at 10s', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    for (let i = 1; i < 10; i += 1) {
      await advance(1_000)
      act(() =>
        h.result.current.selectOption(answer(), i % 2 ? optionB : optionA)
      )
    }
    await advance(999)
    expect(io.save).not.toHaveBeenCalled()
    await advance(1)
    expect(io.save).toHaveBeenCalledTimes(1)
    expect(server.answers[0]?.selectedOptionId).toBe(optionB)
  })

  it('background PUT starts stay 5s apart and clean clock ticks never poll', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    act(() => h.result.current.selectOption(answer(), optionB))
    await advance(4_999)
    expect(io.save).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(io.save).toHaveBeenCalledTimes(2)
    expect(startedAt[1]! - startedAt[0]!).toBe(5_000)
    await advance(60_000)
    expect(io.save).toHaveBeenCalledTimes(2)
  })

  it('unchanged selection and initial sync make no PUT or canonical save GET', async () => {
    const h = mount()
    act(() => h.result.current.moveToOrdinal(1))
    await act(async () => {
      await h.result.current.flush()
    })
    await advance(20_000)
    expect(io.save).not.toHaveBeenCalled()
    expect(io.canonical).not.toHaveBeenCalled()
  })

  it('post-flight edits keep their oldest deadline and remain durable until one next save', async () => {
    const h = mount()
    let finish!: () => void
    io.save.mockImplementationOnce(
      async (input: SaveStudyDraftMutationInput) => {
        startedAt.push(Date.now())
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return accept(input)
      }
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    const frozen = useAppStore.getState().draftWorkingCopy?.frozenAttempt
    act(() => h.result.current.selectOption(answer(), optionB))
    expect(
      readStudyDraftWorkingCopy('GUEST', server.studySessionId)
        ?.postFlightLocalDiff.answers[answer()]?.selectedOptionId
    ).toBe(optionB)
    await advance(10_000)
    expect(io.save).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().draftWorkingCopy?.frozenAttempt).toEqual(
      frozen
    )
    await act(async () => {
      finish()
    })
    await advance(0)
    expect(io.save).toHaveBeenCalledTimes(2)
    expect(server.answers[0]?.selectedOptionId).toBe(optionB)
    expect(startedAt[1]! - startedAt[0]!).toBe(10_000)
  })

  it('submit and concurrent leave drain share one flight and bypass pacing after its ACK', async () => {
    const h = mount()
    let finish!: () => void
    io.save.mockImplementationOnce(
      async (input: SaveStudyDraftMutationInput) => {
        startedAt.push(Date.now())
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return accept(input)
      }
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    act(() => h.result.current.selectOption(answer(), optionB))
    let submit!: ReturnType<typeof h.result.current.prepareSubmission>
    let leave!: ReturnType<typeof h.result.current.flush>
    act(() => {
      submit = h.result.current.prepareSubmission()
      leave = h.result.current.flush()
    })
    await advance(100)
    expect(io.save).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish()
      await Promise.all([submit, leave])
    })
    expect(io.save).toHaveBeenCalledTimes(2)
    expect(startedAt[1]! - startedAt[0]!).toBe(100)
    expect((await submit).answers[0]?.selectedOptionId).toBe(optionB)
    expect((await submit).expectedDraftRevision).toBe(2)
  })

  it('first submit does not wait for the 2s idle timer', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    const before = Date.now()
    await act(async () => {
      await h.result.current.prepareSubmission()
    })
    expect(startedAt).toEqual([before])
    await advance(2_000)
    expect(io.save).toHaveBeenCalledTimes(1)
  })

  it('explicit leave wakes a retry waiting for the 5s background gap', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    act(() => h.result.current.selectOption(answer(), optionB))
    let retry!: Promise<void>
    act(() => {
      retry = h.result.current.retrySave()
    })
    await advance(100)
    expect(io.save).toHaveBeenCalledTimes(1)
    await act(async () => {
      await h.result.current.flush()
      await retry
    })
    expect(io.save).toHaveBeenCalledTimes(2)
    expect(startedAt[1]! - startedAt[0]!).toBe(100)
  })

  it.each([8_000, undefined])(
    '429 cooldown cannot be bypassed by submit/leave/retry (%s)',
    async (retryAfterMs) => {
      const h = mount()
      const failure = withErrorFlags(new Error('synthetic 429'), {
        status: 429,
        code: 'RATE_LIMITED',
        retryable: true,
        retryAfterMs
      })
      io.save.mockRejectedValueOnce(failure)
      act(() => h.result.current.selectOption(answer(), optionA))
      await advance(2_000)
      const frozen = useAppStore.getState().draftWorkingCopy?.frozenAttempt
      for (const flush of [
        h.result.current.prepareSubmission,
        h.result.current.flush,
        h.result.current.retrySave
      ]) {
        await act(async () => {
          await expect(flush()).rejects.toBe(failure)
        })
      }
      expect(io.save).toHaveBeenCalledTimes(1)
      const cooldown = retryAfterMs ?? 5_000
      await advance(cooldown - 1)
      expect(io.save).toHaveBeenCalledTimes(1)
      await advance(1)
      await act(async () => {
        await h.result.current.flush()
      })
      expect(io.save).toHaveBeenCalledTimes(2)
      expect(io.save.mock.calls[1]?.[0]).toEqual({
        body: frozen?.exactParsedBody,
        idempotencyKey: frozen?.idempotencyKey
      })
    }
  )

  it('offline replay retains its exact frozen body/key and preserves post-flight edits', async () => {
    const h = mount()
    io.save.mockRejectedValueOnce(
      withErrorFlags(new Error('response unknown'), {
        isNetworkError: true,
        isOffline: true
      })
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    const frozen = useAppStore.getState().draftWorkingCopy?.frozenAttempt
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
      h.result.current.selectOption(answer(), optionB)
    })
    await act(async () => {
      await expect(h.result.current.flush()).rejects.toThrow('오프라인')
    })
    expect(io.save).toHaveBeenCalledTimes(1)
    await advance(10_000)
    expect(io.save).toHaveBeenCalledTimes(1)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('online')))
    await advance(0)
    expect(io.save.mock.calls[1]?.[0]).toEqual({
      body: frozen?.exactParsedBody,
      idempotencyKey: frozen?.idempotencyKey
    })
    await advance(5_000)
    expect(io.save).toHaveBeenCalledTimes(3)
    expect(server.answers[0]?.selectedOptionId).toBe(optionB)
  })

  it('reload replays the durable frozen attempt before saving a new body', async () => {
    const h = mount()
    io.save.mockRejectedValueOnce(
      withErrorFlags(new Error('unknown response'), { isNetworkError: true })
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    const frozen = useAppStore.getState().draftWorkingCopy?.frozenAttempt
    h.unmount()
    clearStudyDraftWorkingCopyMemoryCache()
    useAppStore.setState({ draftWorkingCopy: null, draftSaveState: 'idle' })
    const recovered = mount()
    await advance(0)
    expect(io.save.mock.calls[1]?.[0]).toEqual({
      body: frozen?.exactParsedBody,
      idempotencyKey: frozen?.idempotencyKey
    })
    expect(
      recovered.result.current.snapshot?.answers[0]?.selectedOptionId
    ).toBe(optionA)
  })

  it('stale multi-tab 409 reconciles canonical conflicts without a second blind PUT', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    server = {
      ...server,
      revision: 1,
      savedAt: new Date().toISOString(),
      answers: server.answers.map((value, i) =>
        i === 0 ? { ...value, selectedOptionId: optionB } : value
      )
    }
    await advance(2_000)
    expect(io.save).toHaveBeenCalledTimes(1)
    expect(io.canonical).toHaveBeenCalledTimes(1)
    expect(h.result.current.conflictCount).toBeGreaterThan(0)
    await act(async () => {
      await expect(h.result.current.flush()).rejects.toThrow('충돌')
    })
    await advance(20_000)
    expect(io.save).toHaveBeenCalledTimes(1)
  })

  it('durable-copy failure blocks even explicit submit before any network write', async () => {
    const h = mount()
    const persistence = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota')
      })
    try {
      act(() => h.result.current.selectOption(answer(), optionA))
      await act(async () => {
        await expect(h.result.current.prepareSubmission()).rejects.toThrow(
          '보존'
        )
      })
      expect(io.save).not.toHaveBeenCalled()
      expect(h.result.current.saveState).toBe('error')
      expect(h.result.current.snapshot?.answers[0]?.selectedOptionId).toBe(
        optionA
      )
    } finally {
      persistence.mockRestore()
    }
  })

  it('unmount cancels a waiting retry and auth-scope cleanup cannot send its old draft', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    act(() => h.result.current.selectOption(answer(), optionB))
    let retry!: Promise<unknown>
    act(() => {
      retry = h.result.current.retrySave().catch((error: unknown) => error)
    })
    h.unmount()
    invalidateCanonicalAuthTransitions()
    await advance(20_000)
    await retry
    expect(io.save).toHaveBeenCalledTimes(1)
    expect(
      readStudyDraftWorkingCopy('GUEST', server.studySessionId)?.localDiff
        .answers[answer()]?.selectedOptionId
    ).toBe(optionB)
  })

  it('an invalid ACK keeps the frozen attempt blocked instead of reporting saved', async () => {
    const h = mount()
    io.save.mockImplementationOnce(
      async (input: SaveStudyDraftMutationInput) => ({
        data: {
          ...server,
          revision: input.body.expectedRevision + 2,
          savedAt: new Date().toISOString(),
          answers: input.body.answers
        }
      })
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    expect(h.result.current.saveState).toBe('error')
    expect(useAppStore.getState().isDraftConflictPending).toBe(true)
    expect(
      readStudyDraftWorkingCopy('GUEST', server.studySessionId)?.frozenAttempt
    ).not.toBeNull()
    await advance(20_000)
    expect(io.save).toHaveBeenCalledTimes(1)
    await act(async () => {
      await expect(h.result.current.prepareSubmission()).rejects.toThrow('충돌')
    })
  })

  it('a real revision-channel signal reconciles another tab without overwriting local work', async () => {
    const channels: EventTarget[] = []
    vi.stubGlobal(
      'BroadcastChannel',
      class extends EventTarget {
        constructor(_name: string) {
          super()
          channels.push(this)
        }
        postMessage = vi.fn()
        close = vi.fn()
      }
    )
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    server = {
      ...server,
      revision: 1,
      savedAt: new Date().toISOString(),
      answers: server.answers.map((value, i) =>
        i === 0 ? { ...value, selectedOptionId: optionB } : value
      )
    }
    act(() =>
      channels[0]!.dispatchEvent(
        new MessageEvent('message', {
          data: {
            principalScope: 'OTHER',
            sessionId: server.studySessionId,
            revision: 1
          }
        })
      )
    )
    expect(io.canonical).not.toHaveBeenCalled()
    act(() =>
      channels[0]!.dispatchEvent(
        new MessageEvent('message', {
          data: {
            principalScope: 'GUEST',
            sessionId: server.studySessionId,
            revision: 1
          }
        })
      )
    )
    await advance(0)
    expect(io.canonical).toHaveBeenCalledTimes(1)
    expect(h.result.current.conflictCount).toBeGreaterThan(0)
    await advance(20_000)
    expect(io.save).not.toHaveBeenCalled()
    expect(h.result.current.snapshot?.answers[0]?.selectedOptionId).toBe(
      optionA
    )
  })

  it('disabling or changing the session clears old autosave timers', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    h.rerender({ enabled: false, sessionId: server.studySessionId })
    await advance(20_000)
    expect(io.save).not.toHaveBeenCalled()
    server = { ...server, studySessionId: crypto.randomUUID() }
    h.rerender({ enabled: true, sessionId: server.studySessionId })
    await advance(20_000)
    expect(io.save).not.toHaveBeenCalled()
  })
})
