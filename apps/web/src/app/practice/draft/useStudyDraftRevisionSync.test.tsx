import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useStudyDraftRevisionSync,
  type StudyDraftRevisionSignal
} from '@app/practice/draft/useStudyDraftRevisionSync'

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []

  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>()
  readonly postMessage = vi.fn()
  readonly close = vi.fn()

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this)
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<unknown>) => void
  ): void {
    if (type === 'message') {
      this.listeners.add(listener)
    }
  }

  emit(data: unknown): void {
    for (const listener of this.listeners) {
      listener(new MessageEvent('message', { data }))
    }
  }
}

const sessionId = '10000000-0000-4000-8000-000000000001'
const principalScope = 'USER:10000000-0000-4000-8000-000000000002'

afterEach(() => {
  FakeBroadcastChannel.instances = []
  vi.unstubAllGlobals()
})

describe('useStudyDraftRevisionSync', () => {
  it('routes scoped signals by dirty state and publishes only safe metadata', () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const onCleanSignal = vi.fn()
    const onDirtySignal = vi.fn()
    const onFallbackRefresh = vi.fn()
    const { result, rerender, unmount } = renderHook(
      ({ isDirty }: { isDirty: boolean }) =>
        useStudyDraftRevisionSync({
          enabled: true,
          isDirty,
          onCleanSignal,
          onDirtySignal,
          onFallbackRefresh,
          principalScope,
          sessionId
        }),
      { initialProps: { isDirty: false } }
    )
    const channel = FakeBroadcastChannel.instances[0]
    expect(channel?.name).toContain(encodeURIComponent(principalScope))

    const signal: StudyDraftRevisionSignal = {
      principalScope,
      revision: 2,
      sessionId
    }
    act(() => channel?.emit(signal))
    expect(onCleanSignal).toHaveBeenCalledWith(signal)
    expect(onDirtySignal).not.toHaveBeenCalled()

    rerender({ isDirty: true })
    act(() => channel?.emit({ ...signal, revision: 3 }))
    expect(onDirtySignal).toHaveBeenCalledWith({ ...signal, revision: 3 })

    act(() => {
      channel?.emit({ ...signal, principalScope: 'USER:other' })
      channel?.emit({ unexpected: true })
      result.current(4)
    })
    expect(onCleanSignal).toHaveBeenCalledTimes(1)
    expect(onDirtySignal).toHaveBeenCalledTimes(1)
    expect(channel?.postMessage).toHaveBeenCalledWith({
      principalScope,
      revision: 4,
      sessionId
    })

    unmount()
    expect(channel?.close).toHaveBeenCalledTimes(1)
    expect(onFallbackRefresh).not.toHaveBeenCalled()
  })

  it('uses focus and visible-state fallback without BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const onFallbackRefresh = vi.fn()
    renderHook(() =>
      useStudyDraftRevisionSync({
        enabled: true,
        isDirty: false,
        onCleanSignal: vi.fn(),
        onDirtySignal: vi.fn(),
        onFallbackRefresh,
        principalScope,
        sessionId
      })
    )

    act(() => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(onFallbackRefresh).toHaveBeenCalledTimes(2)
  })
})
