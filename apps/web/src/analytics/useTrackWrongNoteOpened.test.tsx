import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsClient } from '@/analytics/client'
import { useTrackWrongNoteOpened } from '@/analytics/useTrackWrongNoteOpened'

describe('wrong-note analytics page view', () => {
  it('records a surface once for the mounted route', () => {
    const track = vi.fn(() => true)
    const analytics = { track } satisfies AnalyticsClient
    const { rerender } = renderHook(() =>
      useTrackWrongNoteOpened('LIST', 'wrong-note-list', analytics)
    )

    rerender()

    expect(track).toHaveBeenCalledExactlyOnceWith({
      event: 'wrong_note_opened',
      payload: { surface: 'LIST' }
    })
  })

  it('records a new detail route without transmitting its question id', () => {
    const track = vi.fn(() => true)
    const analytics = { track } satisfies AnalyticsClient
    const { rerender } = renderHook(
      ({ questionId }) =>
        useTrackWrongNoteOpened('DETAIL', questionId, analytics),
      { initialProps: { questionId: 'question-1' } }
    )

    rerender({ questionId: 'question-2' })

    expect(track).toHaveBeenCalledTimes(2)
    expect(track).toHaveBeenLastCalledWith({
      event: 'wrong_note_opened',
      payload: { surface: 'DETAIL' }
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain('question-')
  })
})
