import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'
import {
  studyDraftSnapshotSchema,
  type StudyDraftSnapshot
} from '@nihongo/contracts/study/study-draft'
import { withErrorFlags } from '@nihongo/browser/api/config'
import { usePracticeDraftController } from '@app/practice/hooks/usePracticeDraftController'
import type { SaveStudyDraftMutationInput } from '@app/practice/queries/studyDraftQueries'
import {
  clearAllStudyDraftWorkingCopies,
  clearStudyDraftWorkingCopyMemoryCache,
  readStudyDraftWorkingCopy,
  writeStudyDraftWorkingCopy
} from '@nihongo/browser/app/practice/draft/studyDraftWorkingCopyStorage'
import { createStudyDraftWorkingCopy } from '@nihongo/browser/app/practice/draft/studyDraftWorkingCopy'
import {
  diffStudyDraftSnapshots,
  mergeStudyDraftSnapshots
} from '@nihongo/browser/app/practice/draft/studyDraftMerge'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import { useAppStore } from '@nihongo/browser/store/index'

const io = vi.hoisted(() => ({
  initial: vi.fn(),
  save: vi.fn(),
  canonical: vi.fn(),
  session: vi.fn()
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
        queryFn: io.session
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
const mount = (
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  }),
  user: AuthenticatedUser | null = null
) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    ({ enabled, sessionId }) =>
      usePracticeDraftController({
        enabled,
        sessionId,
        user,
        expectedSessionQuestionIds: questions(),
        isInteractionPaused: true
      }),
    {
      wrapper,
      initialProps: { enabled: true, sessionId: server.studySessionId }
    }
  )
  return { ...hook, client }
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
  io.session
    .mockReset()
    .mockResolvedValue({ session: { status: 'IN_PROGRESS' } })
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

  it('retains an actual post-flight edit that returns to the frozen value', async () => {
    const h = mount()
    let finish!: () => void
    io.save.mockImplementationOnce(
      async (input: SaveStudyDraftMutationInput) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return accept(input)
      }
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    act(() => h.result.current.selectOption(answer(), optionB))
    act(() => h.result.current.selectOption(answer(), optionA))
    expect(
      readStudyDraftWorkingCopy('GUEST', server.studySessionId)
        ?.postFlightLocalDiff.answers[answer()]?.selectedOptionId
    ).toBe(optionA)
    await act(async () => finish())
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
    '429 cooldown survives same-scope reenable and cannot be bypassed by submit/leave/retry (%s)',
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
      h.rerender({ enabled: false, sessionId: server.studySessionId })
      h.rerender({ enabled: true, sessionId: server.studySessionId })
      await advance(0)
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

  it('replays an uncertain request with the same key, then trusts a newer GET', async () => {
    const h = mount()
    let oldAck!: { data: StudyDraftSnapshot }
    io.save.mockImplementationOnce(
      async (input: SaveStudyDraftMutationInput) => {
        oldAck = accept(input)
        throw withErrorFlags(new Error('unknown response'), {
          isNetworkError: true
        })
      }
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    const first = io.save.mock.calls[0]![0]
    server = {
      ...server,
      revision: 2,
      savedAt: new Date(Date.now() + 1).toISOString(),
      answers: server.answers.map((value, i) =>
        i === 0 ? { ...value, selectedOptionId: optionB } : value
      )
    }
    io.save.mockResolvedValueOnce(oldAck)
    await advance(5_000)
    await act(async () => h.result.current.retrySave())
    expect(io.save.mock.calls[1]![0]).toEqual(first)
    expect(io.canonical).toHaveBeenCalled()
    expect(h.result.current.snapshot?.revision).toBe(2)
    expect(h.result.current.snapshot?.answers[0]?.selectedOptionId).toBe(
      optionB
    )
    await advance(10_000)
    expect(io.save).toHaveBeenCalledTimes(2)
  })

  it('does not treat a replay ACK as an editable draft after submission', async () => {
    const h = mount()
    let oldAck!: { data: StudyDraftSnapshot }
    io.save.mockImplementationOnce(
      async (input: SaveStudyDraftMutationInput) => {
        oldAck = accept(input)
        throw withErrorFlags(new Error('unknown response'), {
          isNetworkError: true
        })
      }
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    const first = io.save.mock.calls[0]![0]
    io.save.mockResolvedValueOnce(oldAck)
    io.canonical.mockRejectedValueOnce(
      withErrorFlags(new Error('terminal'), {
        code: 'RESOURCE_NOT_FOUND',
        status: 404
      })
    )
    io.session.mockResolvedValueOnce({ session: { status: 'SUBMITTED' } })
    await advance(5_000)
    await act(async () => {
      await expect(h.result.current.retrySave()).rejects.toThrow()
    })
    expect(io.save.mock.calls[1]![0]).toEqual(first)
    expect(io.save).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().draftWorkingCopy).toBeNull()
    expect(h.result.current.saveState).not.toBe('saved')
  })

  it('preserves the working copy when session ownership is unknown after a 404', async () => {
    const h = mount()
    io.save.mockRejectedValueOnce(
      withErrorFlags(new Error('draft missing'), {
        code: 'RESOURCE_NOT_FOUND',
        status: 404
      })
    )
    io.session.mockRejectedValueOnce(
      withErrorFlags(new Error('session unknown'), {
        code: 'RESOURCE_NOT_FOUND',
        status: 404
      })
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    expect(
      readStudyDraftWorkingCopy('GUEST', server.studySessionId)?.frozenAttempt
    ).not.toBeNull()
    expect(h.result.current.saveState).not.toBe('saved')
  })

  it.each(['retry', 'reload'] as const)(
    'uses GET, not the rejected PUT, after conflict recovery fails and %s',
    async (mode) => {
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
      io.canonical.mockRejectedValueOnce(
        withErrorFlags(new Error('synthetic network failure'), {
          isNetworkError: true
        })
      )
      await advance(2_000)
      expect(io.save).toHaveBeenCalledTimes(1)
      expect(io.canonical).toHaveBeenCalledTimes(1)
      const rejected = io.save.mock.calls[0]![0]
      expect(rejected.body.expectedRevision).toBe(0)
      expect(rejected.idempotencyKey).toBeTruthy()
      if (mode === 'reload') {
        h.unmount()
        clearStudyDraftWorkingCopyMemoryCache()
        useAppStore.setState({ draftWorkingCopy: null, draftSaveState: 'idle' })
        mount()
        await advance(5_000)
      } else {
        await advance(5_000)
        await act(async () => h.result.current.retrySave())
      }
      expect(io.save).toHaveBeenCalledTimes(1)
      expect(io.canonical).toHaveBeenCalledTimes(2)
      expect(useAppStore.getState().draftWorkingCopy?.confirmedBase).toEqual(
        server
      )
    }
  )

  it('keeps post-flight edits through rejected PUT, offline retry and reload', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const h = mount()
    let rejectPut!: () => void
    io.save.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectPut = () =>
            reject(
              withErrorFlags(new Error('synthetic conflict'), {
                code: 'DRAFT_VERSION_CONFLICT',
                status: 409
              })
            )
        })
    )
    io.canonical.mockRejectedValueOnce(
      withErrorFlags(new Error('synthetic offline'), { isNetworkError: true })
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    const rejected = io.save.mock.calls[0]![0]
    act(() => h.result.current.selectOption(questions()[1]!, optionB))
    server = {
      ...server,
      revision: 1,
      savedAt: new Date().toISOString(),
      answers: server.answers.map((value, i) =>
        i === 0 ? { ...value, selectedOptionId: optionB } : value
      )
    }
    await act(async () => rejectPut())
    expect(io.canonical).toHaveBeenCalledTimes(1)
    const saved = readStudyDraftWorkingCopy('GUEST', server.studySessionId)
    expect(
      saved?.postFlightLocalDiff.answers[questions()[1]!]?.selectedOptionId
    ).toBe(optionB)
    online.mockReturnValue(false)
    let retry!: Promise<unknown>
    act(() => {
      retry = h.result.current.retrySave().catch((error: unknown) => error)
    })
    await advance(5_000)
    expect(await retry).toBeInstanceOf(Error)
    expect(io.save).toHaveBeenCalledTimes(1)
    h.unmount()
    clearStudyDraftWorkingCopyMemoryCache()
    useAppStore.setState({ draftWorkingCopy: null, draftSaveState: 'idle' })
    online.mockReturnValue(true)
    mount()
    await advance(0)
    expect(io.canonical).toHaveBeenCalledTimes(2)
    expect(io.save).toHaveBeenCalledTimes(1)
    await advance(7_000)
    expect(io.save).toHaveBeenCalledTimes(2)
    expect(io.canonical).toHaveBeenCalledTimes(3)
    const next = io.save.mock.calls[1]![0]
    expect(next.idempotencyKey).not.toBe(rejected.idempotencyKey)
    expect(next.body.expectedRevision).toBe(1)
    expect(next.body.answers[0]?.selectedOptionId).toBe(optionB)
    expect(next.body.answers[1]?.selectedOptionId).toBe(optionB)
  })

  it('stale multi-tab 409 keeps the committed server value without a second blind PUT', async () => {
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
    expect(h.result.current.conflictCount).toBe(0)
    expect(h.result.current.snapshot?.answers[0]?.selectedOptionId).toBe(
      optionB
    )
    expect(h.result.current.status.code).toBe('reconciled')
    act(() => useAppStore.getState().setDraftSaveState('offline'))
    expect(h.result.current.status.code).toBe('offline')
    act(() => useAppStore.getState().setDraftSaveState('saved'))
    expect(h.result.current.status.code).toBe('reconciled')
    act(() => h.result.current.selectOption(answer(), optionA))
    expect(h.result.current.status.code).toBe('dirty')
    await act(async () => {
      await h.result.current.flush()
    })
    expect(h.result.current.status.code).toBe('savedAt')
    await advance(20_000)
    expect(io.save).toHaveBeenCalledTimes(2)
  })

  it('keeps a legacy conflict on failed GET and adopts the server after explicit retry', async () => {
    const base = server
    const local = {
      ...base,
      answers: base.answers.map((value, i) =>
        i === 0 ? { ...value, selectedOptionId: optionA } : value
      )
    }
    server = {
      ...base,
      revision: 1,
      savedAt: new Date().toISOString(),
      answers: base.answers.map((value, i) =>
        i === 0 ? { ...value, selectedOptionId: optionB } : value
      )
    }
    const merged = mergeStudyDraftSnapshots(base, local, server)
    writeStudyDraftWorkingCopy({
      ...createStudyDraftWorkingCopy({
        confirmedBase: server,
        principalScope: 'GUEST',
        sessionId: server.studySessionId
      }),
      localDiff: diffStudyDraftSnapshots(server, merged.localPreferred),
      pendingConflict: {
        base,
        local,
        remote: server,
        localPreferred: merged.localPreferred,
        conflicts: merged.conflicts
      }
    })
    io.canonical.mockRejectedValueOnce(new Error('offline synthetic'))
    const h = mount()
    await advance(0)
    expect(
      readStudyDraftWorkingCopy('GUEST', server.studySessionId)?.pendingConflict
    ).not.toBeNull()
    expect(useAppStore.getState().isDraftConflictPending).toBe(true)
    expect(io.save).not.toHaveBeenCalled()
    await act(async () => h.result.current.retrySave())
    expect(h.result.current.snapshot?.answers[0]?.selectedOptionId).toBe(
      optionB
    )
    expect(readStudyDraftWorkingCopy('GUEST', server.studySessionId)).toBeNull()
    expect(io.save).not.toHaveBeenCalled()
  })

  it('saves only actual post-flight input after a 409, even when it returns to the frozen value', async () => {
    const h = mount()
    let finish!: () => void
    io.save.mockImplementationOnce(
      async (input: SaveStudyDraftMutationInput) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return accept(input)
      }
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    const first = io.save.mock.calls[0]![0]
    act(() => h.result.current.selectOption(answer(), optionB))
    act(() => h.result.current.selectOption(answer(), optionA))
    server = {
      ...server,
      revision: 1,
      savedAt: new Date().toISOString(),
      answers: server.answers.map((value, i) =>
        i === 0 ? { ...value, selectedOptionId: optionB } : value
      )
    }
    await act(async () => finish())
    await advance(5_000)
    expect(io.save).toHaveBeenCalledTimes(2)
    expect(io.save.mock.calls[1]![0].body.expectedRevision).toBe(1)
    expect(io.save.mock.calls[1]![0].idempotencyKey).not.toBe(
      first.idempotencyKey
    )
    expect(server.answers[0]?.selectedOptionId).toBe(optionA)
    expect(h.result.current.conflictCount).toBe(0)
  })

  it('keeps input made while a 409 canonical GET is pending', async () => {
    const h = mount()
    let finishGet!: (snapshot: StudyDraftSnapshot) => void
    io.canonical.mockImplementationOnce(
      () =>
        new Promise<StudyDraftSnapshot>((resolve) => {
          finishGet = resolve
        })
    )
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
    expect(io.canonical).toHaveBeenCalledTimes(1)
    act(() => h.result.current.selectOption(questions()[1]!, optionA))
    await act(async () => finishGet(server))
    await advance(5_000)
    expect(io.save).toHaveBeenCalledTimes(2)
    expect(server.answers[0]?.selectedOptionId).toBe(optionB)
    expect(server.answers[1]?.selectedOptionId).toBe(optionA)
  })

  it('does not resend an older post-flight edit after a second 409', async () => {
    const h = mount()
    let finish!: () => void
    io.save.mockImplementationOnce(
      async (input: SaveStudyDraftMutationInput) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return accept(input)
      }
    )
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    act(() => h.result.current.selectOption(answer(), optionB))
    act(() => h.result.current.selectOption(answer(), optionA))
    server = {
      ...server,
      revision: 1,
      savedAt: new Date().toISOString(),
      answers: server.answers.map((value, i) =>
        i === 0 ? { ...value, selectedOptionId: optionB } : value
      )
    }
    await act(async () => finish())
    server = {
      ...server,
      revision: 2,
      savedAt: new Date(Date.now() + 1).toISOString()
    }
    await advance(5_000)
    await advance(20_000)
    expect(io.save).toHaveBeenCalledTimes(2)
    expect(h.result.current.snapshot?.revision).toBe(2)
    expect(h.result.current.snapshot?.answers[0]?.selectedOptionId).toBe(
      optionB
    )
  })

  it('does not apply a late 409 recovery GET after the auth epoch changes', async () => {
    const h = mount()
    let finishGet!: (snapshot: StudyDraftSnapshot) => void
    io.canonical.mockImplementationOnce(
      () =>
        new Promise<StudyDraftSnapshot>((resolve) => {
          finishGet = resolve
        })
    )
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
    expect(io.canonical).toHaveBeenCalledTimes(1)
    const newActorRecord = createStudyDraftWorkingCopy({
      confirmedBase: server,
      principalScope: `USER:${crypto.randomUUID()}`,
      sessionId: server.studySessionId
    })
    act(() => {
      invalidateCanonicalAuthTransitions()
      h.rerender({ enabled: false, sessionId: server.studySessionId })
      useAppStore.setState({
        draftWorkingCopy: newActorRecord,
        draftSaveState: 'idle'
      })
    })
    await act(async () => finishGet(server))
    expect(useAppStore.getState().draftWorkingCopy).toEqual(newActorRecord)
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

  it.each(['offline', 'error'] as const)(
    'shows %s when an actual remote revision signal overlaps an in-flight save',
    async (failure) => {
      const channels: EventTarget[] = []
      vi.stubGlobal(
        'BroadcastChannel',
        class extends EventTarget {
          constructor(_name: string) {
            super()
            channels.push(this)
          }
          postMessage() {}
          close() {}
        }
      )
      const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
      let rejectPut!: () => void
      io.save.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectPut = () =>
              reject(
                failure === 'offline'
                  ? withErrorFlags(new Error('network'), {
                      isNetworkError: true
                    })
                  : withErrorFlags(new Error('server failure'), { status: 500 })
              )
          })
      )
      const h = mount()
      act(() => h.result.current.selectOption(answer(), optionA))
      await advance(2_000)
      expect(io.save).toHaveBeenCalledTimes(1)
      server = { ...server, revision: 1, savedAt: new Date().toISOString() }
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
      expect(h.result.current.status.code).toBe('remoteDeferred')
      if (failure === 'offline') {
        online.mockReturnValue(false)
        act(() => window.dispatchEvent(new Event('offline')))
      } else {
        await act(async () => rejectPut())
      }
      expect(h.result.current.saveState).toBe(failure)
      expect(h.result.current.status.code).toBe(failure)
      if (failure === 'offline') {
        await act(async () => rejectPut())
        online.mockReturnValue(true)
        act(() => window.dispatchEvent(new Event('online')))
        await advance(5_000)
      } else {
        let retry!: Promise<void>
        act(() => {
          retry = h.result.current.retrySave()
        })
        await advance(5_000)
        await act(async () => retry)
      }
      expect(io.save).toHaveBeenCalledTimes(2)
      expect(io.save.mock.calls[1]![0]).toEqual(io.save.mock.calls[0]![0])
      expect(io.canonical).toHaveBeenCalled()
      expect(h.result.current.snapshot?.revision).toBe(1)
      expect(h.result.current.status.code).toBe('reconciled')
    }
  )

  it('a real revision-channel signal keeps the committed server value for a conflicting field', async () => {
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
    expect(h.result.current.conflictCount).toBe(0)
    await advance(20_000)
    expect(io.save).not.toHaveBeenCalled()
    expect(h.result.current.snapshot?.answers[0]?.selectedOptionId).toBe(
      optionB
    )
  })

  it.each(['remount', 'reenable'] as const)(
    'same-scope dirty %s autosaves without another edit while the clock is paused',
    async (reentry) => {
      const h = mount()
      act(() => h.result.current.selectOption(answer(), optionA))
      if (reentry === 'remount') {
        h.unmount()
        mount(h.client)
      } else {
        h.rerender({ enabled: false, sessionId: server.studySessionId })
        h.rerender({ enabled: true, sessionId: server.studySessionId })
      }
      await advance(1_999)
      expect(io.save).not.toHaveBeenCalled()
      await advance(1)
      expect(io.save).toHaveBeenCalledTimes(1)
      expect(server.answers[0]?.selectedOptionId).toBe(optionA)
      expect(server.revision).toBe(1)
    }
  )

  it('same-scope reenable preserves the oldest unsent deadline during continuing edits', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(1_000)
    act(() => h.result.current.selectOption(answer(), optionB))
    h.rerender({ enabled: false, sessionId: server.studySessionId })
    h.rerender({ enabled: true, sessionId: server.studySessionId })
    for (let i = 2; i < 10; i += 1) {
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

  it('same-scope reenable preserves the previous PUT start gap', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    act(() => h.result.current.selectOption(answer(), optionB))
    h.rerender({ enabled: false, sessionId: server.studySessionId })
    h.rerender({ enabled: true, sessionId: server.studySessionId })
    await advance(4_999)
    expect(io.save).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(io.save).toHaveBeenCalledTimes(2)
    expect(startedAt[1]! - startedAt[0]!).toBe(5_000)
    expect(server.answers[0]?.selectedOptionId).toBe(optionB)
  })

  it('fresh remount retains the previous PUT start gap after its ACK', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    act(() => h.result.current.selectOption(answer(), optionB))
    h.unmount()
    mount(h.client)
    await advance(2_000)
    expect(io.save).toHaveBeenCalledTimes(1)
    await advance(2_999)
    expect(io.save).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(io.save).toHaveBeenCalledTimes(2)
    expect(startedAt[1]! - startedAt[0]!).toBe(5_000)
    expect(server.answers[0]?.selectedOptionId).toBe(optionB)
  })

  it.each([8_000, undefined])(
    'fresh remount preserves429 cooldown and exact frozen retry (%s)',
    async (retryAfterMs) => {
      const h = mount()
      const failure = withErrorFlags(new Error('synthetic429'), {
        status: 429,
        code: 'RATE_LIMITED',
        retryable: true,
        retryAfterMs
      })
      io.save.mockRejectedValueOnce(failure)
      act(() => h.result.current.selectOption(answer(), optionA))
      await advance(2_000)
      const frozen = useAppStore.getState().draftWorkingCopy?.frozenAttempt
      h.unmount()
      const resumed = mount(h.client)
      await advance(0)
      expect(io.save).toHaveBeenCalledTimes(1)
      for (const flush of [
        resumed.result.current.prepareSubmission,
        resumed.result.current.flush,
        resumed.result.current.retrySave
      ]) {
        await act(async () => {
          await expect(flush()).rejects.toBe(failure)
        })
      }
      await advance((retryAfterMs ?? 5_000) - 1)
      expect(io.save).toHaveBeenCalledTimes(1)
      await advance(1)
      await act(async () => {
        await resumed.result.current.flush()
      })
      expect(io.save).toHaveBeenCalledTimes(2)
      expect(io.save.mock.calls[1]?.[0]).toEqual({
        body: frozen?.exactParsedBody,
        idempotencyKey: frozen?.idempotencyKey
      })
    }
  )

  it.each([8_000, undefined])(
    'late429 arriving during remount wait blocks the pending PUT until Retry-After (%s)',
    async (retryAfterMs) => {
      const h = mount()
      const failure = withErrorFlags(new Error('late429'), {
        status: 429,
        code: 'RATE_LIMITED',
        retryable: true,
        retryAfterMs
      })
      let fail!: () => void
      io.save.mockImplementationOnce(
        async (input: SaveStudyDraftMutationInput) => {
          startedAt.push(Date.now())
          await new Promise<void>((_resolve, reject) => {
            fail = () => reject(failure)
          })
          return accept(input)
        }
      )
      act(() => h.result.current.selectOption(answer(), optionA))
      await advance(2_000)
      const frozen = useAppStore.getState().draftWorkingCopy?.frozenAttempt
      h.unmount()
      const resumed = mount(h.client)
      await advance(1_000)
      await act(async () => fail())
      await advance(4_000)
      expect(io.save).toHaveBeenCalledTimes(1)
      for (const flush of [
        resumed.result.current.prepareSubmission,
        resumed.result.current.flush,
        resumed.result.current.retrySave
      ]) {
        await act(async () => {
          await expect(flush()).rejects.toBe(failure)
        })
      }
      await advance((retryAfterMs ?? 5_000) - 4_001)
      expect(io.save).toHaveBeenCalledTimes(1)
      await advance(1)
      await act(async () => {
        await resumed.result.current.flush()
      })
      expect(io.save).toHaveBeenCalledTimes(2)
      expect(startedAt[1]! - startedAt[0]!).toBe(
        1_000 + (retryAfterMs ?? 5_000)
      )
      expect(io.save.mock.calls[1]?.[0]).toEqual({
        body: frozen?.exactParsedBody,
        idempotencyKey: frozen?.idempotencyKey
      })
      expect(server.answers[0]?.selectedOptionId).toBe(optionA)
    }
  )

  it('fresh remount keeps only the recent clean PUT gate and releases it after expiry', async () => {
    const h = mount()
    act(() => h.result.current.selectOption(answer(), optionA))
    await advance(2_000)
    await h.client.refetchQueries(
      { queryKey: ['study', 'draft-save-pacing'], exact: true },
      { throwOnError: true }
    )
    h.unmount()
    await advance(4_999)
    expect(h.client.getQueryData(['study', 'draft-save-pacing'])).toBeDefined()
    await advance(1)
    expect(
      h.client.getQueryData(['study', 'draft-save-pacing'])
    ).toBeUndefined()
    mount(h.client)
    await advance(20_000)
    expect(io.save).toHaveBeenCalledTimes(1)
  })

  it.each(['actor', 'session', 'auth'] as const)(
    'fresh remount never carries an old429 gate across %s transition',
    async (transition) => {
      const h = mount()
      io.save.mockRejectedValueOnce(
        withErrorFlags(new Error('old429'), {
          status: 429,
          retryAfterMs: 30_000
        })
      )
      act(() => h.result.current.selectOption(answer(), optionA))
      await advance(2_000)
      const oldKey =
        useAppStore.getState().draftWorkingCopy?.frozenAttempt?.idempotencyKey
      h.unmount()
      if (transition === 'session')
        server = { ...server, studySessionId: crypto.randomUUID() }
      if (transition === 'auth') {
        invalidateCanonicalAuthTransitions()
        clearAllStudyDraftWorkingCopies()
        useAppStore.setState({
          draftWorkingCopy: null,
          draftSaveState: 'idle',
          draftConflict: null,
          isDraftConflictPending: false
        })
      }
      const actor: AuthenticatedUser | null =
        transition === 'actor'
          ? {
              id: crypto.randomUUID(),
              name: 'New actor',
              role: 'USER',
              targetLevel: 'N5'
            }
          : null
      const resumed = mount(h.client, actor)
      act(() => resumed.result.current.selectOption(answer(), optionB))
      await advance(2_000)
      expect(io.save).toHaveBeenCalledTimes(2)
      expect(io.save.mock.calls[1]?.[0].idempotencyKey).not.toBe(oldKey)
      expect(server.answers[0]?.selectedOptionId).toBe(optionB)
    }
  )

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
