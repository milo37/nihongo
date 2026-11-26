import type { BrowserContext, Frame, Request } from '@playwright/test'

// What each engine reports when it cancels a request itself (Chromium,
// Firefox, WebKit). An injected `route.abort()` reports a plain failure
// (net::ERR_FAILED), so test faults never match.
const ABORTED_ERROR = /net::ERR_ABORTED|NS_BINDING_ABORTED|cancelled/iu

export interface NavigationAbortTracker {
  /**
   * True only when the browser cancelled the request because its frame moved
   * on: the frame started a new document, or was detached, after the request
   * began. Any other failure, aborted or not, stays a real failure.
   */
  readonly isNavigationAbort: (request: Request) => boolean
}

// Service-worker-initiated requests have no frame; Playwright throws for them.
const frameOf = (request: Request): Frame | null => {
  try {
    return request.frame()
  } catch {
    return null
  }
}

/** Start before the requests to judge: it orders requests by when they began. */
export const trackNavigationAborts = (
  context: BrowserContext
): NavigationAbortTracker => {
  let sequence = 0
  const startedAt = new WeakMap<Request, number>()
  const lastDocumentStart = new WeakMap<Frame, number>()
  const detachedAt = new WeakMap<Frame, number>()

  context.on('request', (request) => {
    sequence += 1
    if (!request.isNavigationRequest()) {
      startedAt.set(request, sequence)
      return
    }
    const frame = frameOf(request)
    if (frame) lastDocumentStart.set(frame, sequence)
  })
  const watchPage = (page: ReturnType<BrowserContext['pages']>[number]) =>
    page.on('framedetached', (frame) => detachedAt.set(frame, ++sequence))
  context.pages().forEach(watchPage)
  context.on('page', watchPage)

  return {
    isNavigationAbort: (request) => {
      if (!ABORTED_ERROR.test(request.failure()?.errorText ?? '')) return false
      const frame = frameOf(request)
      const started = startedAt.get(request)
      if (!frame || started === undefined) return false
      return (
        (lastDocumentStart.get(frame) ?? 0) > started ||
        (detachedAt.get(frame) ?? 0) > started
      )
    }
  }
}
