import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { useLatest } from '@common/hooks/useLatest'

const revisionSignalSchema = z
  .object({
    principalScope: z.string().min(1),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sessionId: z.uuid()
  })
  .strict()

export interface StudyDraftRevisionSignal {
  principalScope: string
  revision: number
  sessionId: string
}

interface UseStudyDraftRevisionSyncOptions {
  enabled: boolean
  isDirty: boolean
  onCleanSignal: (signal: StudyDraftRevisionSignal) => void
  onDirtySignal: (signal: StudyDraftRevisionSignal) => void
  onFallbackRefresh: () => void
  principalScope: string
  sessionId: string
}

const openChannels = new Set<BroadcastChannel>()

const getChannelName = (principalScope: string, sessionId: string): string =>
  `nihongo:practice-draft:v1:${encodeURIComponent(principalScope)}:${encodeURIComponent(sessionId)}`

export const closeAllStudyDraftRevisionChannels = (): void => {
  for (const channel of openChannels) {
    channel.close()
  }
  openChannels.clear()
}

export const useStudyDraftRevisionSync = ({
  enabled,
  isDirty,
  onCleanSignal,
  onDirtySignal,
  onFallbackRefresh,
  principalScope,
  sessionId
}: UseStudyDraftRevisionSyncOptions): ((revision: number) => void) => {
  const channelRef = useRef<BroadcastChannel | null>(null)
  const latest = useLatest({
    isDirty,
    onCleanSignal,
    onDirtySignal,
    onFallbackRefresh,
    principalScope,
    sessionId
  })

  useEffect(() => {
    if (!enabled || typeof BroadcastChannel === 'undefined') {
      if (!enabled) {
        return
      }

      const handleFocus = (): void => latest.current.onFallbackRefresh()
      const handleVisibility = (): void => {
        if (document.visibilityState === 'visible') {
          latest.current.onFallbackRefresh()
        }
      }
      window.addEventListener('focus', handleFocus)
      document.addEventListener('visibilitychange', handleVisibility)
      return () => {
        window.removeEventListener('focus', handleFocus)
        document.removeEventListener('visibilitychange', handleVisibility)
      }
    }

    const channel = new BroadcastChannel(
      getChannelName(principalScope, sessionId)
    )
    openChannels.add(channel)
    channelRef.current = channel
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      const parsed = revisionSignalSchema.safeParse(event.data)
      if (!parsed.success) {
        return
      }

      const signal = parsed.data
      if (
        signal.principalScope !== latest.current.principalScope ||
        signal.sessionId !== latest.current.sessionId
      ) {
        return
      }

      if (latest.current.isDirty) {
        latest.current.onDirtySignal(signal)
      } else {
        latest.current.onCleanSignal(signal)
      }
    })

    return () => {
      channelRef.current = null
      openChannels.delete(channel)
      channel.close()
    }
  }, [enabled, latest, principalScope, sessionId])

  return (revision: number): void => {
    if (!enabled || !channelRef.current) {
      return
    }

    channelRef.current.postMessage(
      revisionSignalSchema.parse({ principalScope, revision, sessionId })
    )
  }
}
