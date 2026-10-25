#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertExactReleaseMarker,
  assertReleaseId
} from './release-contract.mjs'
import { writeManifestAtomically } from './release-manifest.mjs'

const MAX_RESPONSE_BYTES = 1_048_576
const DEFAULT_TIMEOUT_MS = 5_000
const deploymentEnvironments = new Set(['STAGING', 'PRODUCTION'])

const parseArguments = (argumentsList) => {
  const values = new Map()
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index]
    const value = argumentsList[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Smoke arguments must be --key value pairs.')
    }
    if (values.has(key)) throw new Error(`Duplicate argument: ${key}`)
    values.set(key, value)
  }
  return values
}

const requiredArgument = (argumentsMap, name) => {
  const value = argumentsMap.get(name)
  if (!value) throw new Error(`Missing required argument: ${name}`)
  return value
}

export const parseDeploymentOrigin = (
  origin,
  { allowLoopbackHttp = false } = {}
) => {
  const url = new URL(origin)
  const isAllowedLoopback =
    allowLoopbackHttp &&
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  if (
    (url.protocol !== 'https:' && !isAllowedLoopback) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin === 'null'
  ) {
    throw new Error(
      'Deploy origin must be an exact credential-free HTTPS origin.'
    )
  }
  return url.origin
}

const readBoundedText = async (response, label, signal) => {
  const declaredLength = response.headers.get('content-length')
  if (
    declaredLength !== null &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > MAX_RESPONSE_BYTES
  ) {
    throw new Error(`${label} response is too large.`)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let text = ''
  const cancelOnAbort = () => {
    void reader.cancel()
  }
  signal.addEventListener('abort', cancelOnAbort, { once: true })
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      if (bytesRead > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error(`${label} response is too large.`)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    signal.removeEventListener('abort', cancelOnAbort)
    reader.releaseLock()
  }
}

const assertExactHealth = (body, expectedStatus, label) => {
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error(`${label} returned invalid JSON.`)
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    parsed.status !== expectedStatus
  ) {
    throw new Error(`${label} returned an invalid health contract.`)
  }
}

export const isCanonicalViteAssetPath = (path) => {
  if (typeof path !== 'string' || !path.startsWith('/assets/')) return false
  const segments = path.slice('/assets/'.length).split('/')
  return (
    segments.length > 0 &&
    segments.every(
      (segment) =>
        /^[A-Za-z0-9_][A-Za-z0-9._-]*$/u.test(segment) &&
        segment !== '.' &&
        segment !== '..'
    )
  )
}

const getAssetPaths = (html, origin) => {
  const paths = new Set()
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/giu)) {
    const reference = match[1]
    if (!reference) continue
    const url = new URL(reference, origin)
    if (url.origin !== origin) {
      throw new Error('Web shell references a cross-origin asset.')
    }
    if (url.pathname.startsWith('/assets/')) {
      if (url.username || url.password || url.search || url.hash) {
        throw new Error(
          'Web shell asset references must not contain credentials, query, or fragment data.'
        )
      }
      if (!isCanonicalViteAssetPath(url.pathname)) {
        throw new Error('Web shell contains an unsafe Vite asset path.')
      }
      paths.add(url.pathname)
    }
  }
  if (paths.size === 0) throw new Error('Web shell contains no Vite assets.')
  return [...paths].sort()
}

export const runPostDeploySmoke = async ({
  environment,
  allowLoopbackHttp = false,
  fetchImpl = fetch,
  now = () => performance.now(),
  origin,
  releaseId,
  requestId = randomUUID(),
  timeoutMs = DEFAULT_TIMEOUT_MS
}) => {
  if (
    !deploymentEnvironments.has(environment) &&
    !(environment === 'TEST' && allowLoopbackHttp)
  ) {
    throw new Error('Smoke environment must be STAGING or PRODUCTION.')
  }
  const expectedReleaseId = assertReleaseId(releaseId)
  const exactOrigin = parseDeploymentOrigin(origin, { allowLoopbackHttp })
  const deploymentHostname = new URL(exactOrigin).hostname.toLowerCase()
  if (
    deploymentEnvironments.has(environment) &&
    (deploymentHostname === 'localhost' ||
      deploymentHostname === '[::1]' ||
      /^127(?:\.|$)/u.test(deploymentHostname))
  ) {
    throw new Error('Staging and Production smoke targets cannot be loopback.')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error('Smoke timeout must be between 100 and 30000 milliseconds.')
  }

  const checks = []
  const get = async (path, accept, inspect) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = now()
    let response
    try {
      response = await fetchImpl(new URL(path, exactOrigin), {
        credentials: 'omit',
        headers: {
          Accept: accept,
          'X-Request-Id': requestId
        },
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal
      })
    } catch {
      clearTimeout(timer)
      throw new Error(`GET ${path} failed.`)
    }
    try {
      if (response.status >= 300 && response.status < 400) {
        throw new Error(`GET ${path} returned a redirect.`)
      }
      const result = await inspect(response, controller.signal)
      if (controller.signal.aborted) {
        throw new Error(`GET ${path} timed out.`)
      }
      checks.push({
        durationMs: Math.max(0, Math.round(now() - startedAt)),
        path,
        status: response.status
      })
      return result
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`GET ${path} timed out.`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  for (const [path, expectedStatus] of [
    ['/health/live', 'ok'],
    ['/health/ready', 'ready']
  ]) {
    await get(path, 'application/json', async (response, signal) => {
      if (response.status !== 200) {
        throw new Error(`GET ${path} was not ready.`)
      }
      if (!response.headers.get('cache-control')?.includes('no-store')) {
        throw new Error(`GET ${path} is cacheable.`)
      }
      if (response.headers.get('x-release-id') !== expectedReleaseId) {
        throw new Error(`GET ${path} release ID mismatch.`)
      }
      assertExactHealth(
        await readBoundedText(response, path, signal),
        expectedStatus,
        path
      )
    })
  }

  let rootHtml = ''
  for (const path of ['/', '/login']) {
    const html = await get(path, 'text/html', async (response, signal) => {
      if (
        response.status !== 200 ||
        !response.headers.get('content-type')?.includes('text/html')
      ) {
        throw new Error(`GET ${path} did not return the SPA shell.`)
      }
      const body = await readBoundedText(response, path, signal)
      assertExactReleaseMarker(body, expectedReleaseId, `GET ${path}`)
      return body
    })
    if (path === '/') rootHtml = html
  }

  for (const assetPath of getAssetPaths(rootHtml, exactOrigin)) {
    await get(assetPath, '*/*', async (response, signal) => {
      if (response.status !== 200) {
        throw new Error(`GET ${assetPath} failed.`)
      }
      await readBoundedText(response, assetPath, signal)
    })
  }

  await get(
    '/mockServiceWorker.js',
    'text/javascript',
    async (response, signal) => {
      if (response.status !== 404) {
        throw new Error('Production mock worker is reachable.')
      }
      await readBoundedText(response, '/mockServiceWorker.js', signal)
    }
  )

  return {
    schemaVersion: 1,
    environment,
    releaseId: expectedReleaseId,
    targetFingerprintSha256: createHash('sha256')
      .update(exactOrigin)
      .digest('hex'),
    checks
  }
}

export const runPostDeploySmokeCli = async (argumentsList) => {
  const argumentsMap = parseArguments(argumentsList)
  const result = await runPostDeploySmoke({
    environment: requiredArgument(argumentsMap, '--environment'),
    origin: requiredArgument(argumentsMap, '--origin'),
    releaseId: requiredArgument(argumentsMap, '--release-id')
  })
  writeManifestAtomically(
    resolve(requiredArgument(argumentsMap, '--output')),
    result
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runPostDeploySmokeCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Post-deploy smoke failed.'}\n`
    )
    process.exitCode = 1
  }
}
