import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono, MiddlewareHandler } from 'hono'
import type { ApiVariables } from '../middleware/requestContext.js'
import { getRawRequestPathname } from './phase7PrefixExclusion.js'

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
    decodedPath.split('/').some((segment) => segment.startsWith('.'))
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

type StaticEnvironment = { Variables: ApiVariables }

const isWithinRoot = (root: string, file: string): boolean => {
  const name = relative(root, file)
  return (
    name === '' ||
    (!isAbsolute(name) && name !== '..' && !name.startsWith(`..${sep}`))
  )
}

const resolveStaticFile = (
  root: string,
  path: string
): string | null | undefined => {
  try {
    let file = realpathSync(join(root, path))
    if (!isWithinRoot(root, file)) return null
    if (statSync(file).isDirectory())
      file = realpathSync(join(file, 'index.html'))
    return isWithinRoot(root, file) && statSync(file).isFile() ? file : null
  } catch {
    return undefined
  }
}

const readAssetRoot = (directory: string, releaseId: string) => {
  if (!isAbsolute(directory))
    throw new Error('Web assets directory must be absolute.')
  const root = realpathSync(directory)
  const index = resolveStaticFile(root, '/index.html')
  if (
    !index ||
    !hasExactReleaseMarker(readFileSync(index, 'utf8'), releaseId)
  ) {
    throw new Error('Web assets do not match the API release ID.')
  }
  return { root, index }
}

const isAdminPath = (path: string | null): boolean => {
  const value = path?.toLowerCase()
  return value === '/admin' || value?.startsWith('/admin/') === true
}

export const installStaticWeb = ({
  app,
  releaseId,
  webAssetsDirectory,
  adminAssetsDirectory,
  adminGuard
}: {
  app: Hono<StaticEnvironment>
  releaseId: string
  webAssetsDirectory: string
  adminAssetsDirectory?: string
  adminGuard?: MiddlewareHandler<StaticEnvironment>
}): void => {
  const web = readAssetRoot(webAssetsDirectory, releaseId)
  const admin = adminAssetsDirectory
    ? readAssetRoot(adminAssetsDirectory, releaseId)
    : undefined
  if (
    admin &&
    (isWithinRoot(web.root, admin.root) || isWithinRoot(admin.root, web.root))
  ) {
    throw new Error('Web and admin asset directories must be separate.')
  }

  app.use('*', async (context, next) => {
    const rawTarget = context.get('rawRequestTarget') ?? context.req.raw.url
    const rawPath = getRawRequestPathname(rawTarget)
    const decodedPath = rawPath === null ? null : decodePath(rawPath)
    const adminRequest =
      isAdminPath(decodedPath) || isAdminPath(decodePath(context.req.path))
    const canonicalAdminPrefix =
      rawPath === '/admin' || rawPath?.startsWith('/admin/') === true
    if (adminRequest) {
      context.header('Cache-Control', 'private, no-store')
      context.header('Vary', 'Cookie, Authorization')
      if (
        !admin ||
        !adminGuard ||
        !canonicalAdminPrefix ||
        rawPath !== context.req.path ||
        rawTarget.includes('#')
      ) {
        return context.notFound()
      }
    }
    const path = adminRequest
      ? decodedPath?.slice('/admin'.length) || '/'
      : decodedPath
    if (
      (context.req.method !== 'GET' && context.req.method !== 'HEAD') ||
      path === null ||
      isReservedPath(path)
    ) {
      if (adminRequest) return context.notFound()
      await next()
      return
    }

    const respond = async (assets: {
      root: string
      index: string
    }): Promise<Response> => {
      const file = resolveStaticFile(assets.root, path)
      if (file === null || (file === undefined && isAssetLikePath(path)))
        return context.notFound()
      const response = await serveStatic<StaticEnvironment>({
        path: file ?? assets.index
      })(context, async () => undefined)
      if (!response) return context.notFound()
      const cached = withCacheControl(
        response,
        adminRequest
          ? 'private, no-store'
          : path.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-store'
      )
      if (adminRequest) cached.headers.delete('Last-Modified')
      return cached
    }
    if (adminRequest && admin && adminGuard) {
      const response = await adminGuard(context, async () => {
        context.res = await respond(admin)
      })
      return response ?? context.res
    }
    return respond(web)
  })
}
