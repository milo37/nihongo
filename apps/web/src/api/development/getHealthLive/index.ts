import { safeGet } from '@nihongo/browser/api/http'
import { healthLiveSchema } from '@api/development/getHealthLive/schema'
import type { HealthLive } from '@api/development/getHealthLive/schema'

const requestHealthLive = safeGet(healthLiveSchema)

export const getHealthLive = async (
  signal?: AbortSignal
): Promise<HealthLive> => {
  if (!import.meta.env.DEV) throw new Error('Development diagnostics disabled')
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal?.aborted) cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, 5000)
  try {
    return await requestHealthLive('/health/live', undefined, {
      baseURL: new URL('/', window.location.href).href,
      adapter: 'fetch',
      timeout: 5000,
      signal: controller.signal,
      withCredentials: false,
      headers: { Accept: 'application/json' },
      transformResponse: [
        (data: unknown, headers, status) => {
          const contentType: unknown = headers['content-type']
          if (
            status !== 200 ||
            typeof contentType !== 'string' ||
            contentType.split(';')[0]?.trim().toLowerCase() !==
              'application/json' ||
            typeof data !== 'string'
          )
            throw new Error('Unexpected health response')
          return JSON.parse(data) as unknown
        }
      ]
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
