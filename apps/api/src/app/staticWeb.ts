import { readFileSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'
import type { ApiVariables } from '../middleware/requestContext.js'

const reservedPathPrefixes = ['/api', '/health', '/__test'] as const

const decodePath = (path: string): string | null => {
  try {
    let decoded = path
    for (let count = 0; count < 8; count += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) return decoded
      decoded = next
    }
    return null
  } catch {
    return null
  }
}

const isReservedPath = (path: string): boolean => {
  const decodedPath = decodePath(path)
  if (
    decodedPath === null ||
    decodedPath.includes('\\') ||
    decodedPath.includes('//') ||
    decodedPath
      .split('/')
      .some((segment) => segment === '.' || segment === '..')
  ) {
    return true
  }
  return (
    decodedPath === '/mockServiceWorker.js' ||
    decodedPath.startsWith('/.') ||
    reservedPathPrefixes.some(
      (prefix) => decodedPath === prefix || decodedPath.startsWith(`${prefix}/`)
    )
  )
}

const isAssetLikePath = (path: string): boolean => {
  const decodedPath = decodePath(path)
  if (decodedPath === null) return true
  return (
    decodedPath === '/assets' ||
    decodedPath.startsWith('/assets/') ||
    basename(decodedPath).includes('.')
  )
}

const withCacheControl = (response: Response, value: string): Response => {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', value)
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  })
}

const parseMetaAttributes = (tag: string): Map<string, string> | null => {
  const match = /^<meta\b([\s\S]*?)\s*\/?>$/iu.exec(tag)
  if (!match) return null
  const attributeSource = match[1]
  if (attributeSource === undefined) return null

  let remaining = attributeSource
  const attributes = new Map<string, string>()
  while (remaining.trim().length > 0) {
    const attribute =
      /^\s+([a-z][a-z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(remaining)
    if (!attribute) return null
    const rawName = attribute[1]
    if (rawName === undefined) return null
    const name = rawName.toLowerCase()
    if (attributes.has(name)) return null
    attributes.set(name, attribute[2] ?? attribute[3] ?? '')
    remaining = remaining.slice(attribute[0].length)
  }
  return attributes
}

const hasExactReleaseMarker = (html: string, releaseId: string): boolean => {
  const markupOnly = html
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(
      /<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
      ''
    )
  const candidates = [...markupOnly.matchAll(/<meta\b[^<>]*>/giu)].filter(
    ([tag]) => {
      const attributes = parseMetaAttributes(tag)
      return (
        attributes?.get('name')?.toLowerCase() === 'nihongo-release-id' ||
        /nihongo-release-id/iu.test(tag)
      )
    }
  )
  if (candidates.length !== 1) return false

  const candidate = candidates[0]?.[0]
  if (candidate === undefined) return false
  const attributes = parseMetaAttributes(candidate)
  return (
    attributes !== null &&
    attributes.size === 2 &&
    attributes.get('name') === 'nihongo-release-id' &&
    attributes.get('content') === releaseId
  )
}

export const installStaticWeb = ({
  app,
  releaseId,
  webAssetsDirectory
}: {
  app: Hono<{ Variables: ApiVariables }>
  releaseId: string
  webAssetsDirectory: string
}): void => {
  if (!isAbsolute(webAssetsDirectory)) {
    throw new Error('Web assets directory must be absolute.')
  }
  const root = realpathSync(webAssetsDirectory)
  const indexHtml = readFileSync(join(root, 'index.html'), 'utf8')
  if (!hasExactReleaseMarker(indexHtml, releaseId)) {
    throw new Error('Web assets do not match the API release ID.')
  }

  const serveFile = serveStatic<{ Variables: ApiVariables }>({ root })
  const serveIndex = serveStatic<{ Variables: ApiVariables }>({
    path: join(root, 'index.html')
  })

  app.use('*', async (context, next) => {
    if (
      (context.req.method !== 'GET' && context.req.method !== 'HEAD') ||
      isReservedPath(context.req.path)
    ) {
      await next()
      return
    }

    const fileResponse = await serveFile(context, async () => undefined)
    if (fileResponse) {
      return withCacheControl(
        fileResponse,
        context.req.path.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-store'
      )
    }
    if (isAssetLikePath(context.req.path)) {
      await next()
      return
    }

    const indexResponse = await serveIndex(context, async () => undefined)
    if (indexResponse) return withCacheControl(indexResponse, 'no-store')
    await next()
  })
}
