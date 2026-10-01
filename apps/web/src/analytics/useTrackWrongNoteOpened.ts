import { useEffect, useRef } from 'react'
import { analyticsClient, type AnalyticsClient } from '@/analytics/client'

type WrongNoteSurface = 'LIST' | 'DETAIL' | 'REVIEW_CENTER'

export const useTrackWrongNoteOpened = (
  surface: WrongNoteSurface,
  routeInstanceKey: string = surface,
  analytics: AnalyticsClient = analyticsClient
): void => {
  const trackedRouteInstanceRef = useRef<string | null>(null)

  useEffect(() => {
    if (trackedRouteInstanceRef.current === routeInstanceKey) return
    trackedRouteInstanceRef.current = routeInstanceKey
    analytics.track({
      event: 'wrong_note_opened',
      payload: { surface }
    })
  }, [analytics, routeInstanceKey, surface])
}
