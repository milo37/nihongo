import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseDeploymentOrigin,
  runPostDeploySmoke
} from './post-deploy-smoke.mjs'

const releaseId = '1234567890abcdef1234567890abcdef12345678'
const origin = 'https://staging.example.test'
const html = `<!doctype html><html><head><meta name="nihongo-release-id" content="${releaseId}"><script type="module" src="/assets/app.js"></script></head></html>`

const createResponse = (body, status, headers = {}) =>
  new Response(body, { headers, status })

const createSuccessfulFetch = () => {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ init, url: url.toString() })
    switch (url.pathname) {
      case '/health/live':
        return createResponse('{"status":"ok"}', 200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          'X-Release-Id': releaseId
        })
      case '/health/ready':
        return createResponse('{"status":"ready"}', 200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          'X-Release-Id': releaseId
        })
      case '/':
      case '/login':
        return createResponse(html, 200, { 'Content-Type': 'text/html' })
      case '/assets/app.js':
        return createResponse('export {}', 200, {
          'Content-Type': 'text/javascript'
        })
      case '/mockServiceWorker.js':
        return createResponse('not found', 404, {
          'Content-Type': 'text/plain'
        })
      default:
        return createResponse('not found', 404)
    }
  }
  return { fetchImpl, requests }
}

test('post-deploy smoke uses GET-only safe requests and returns bounded evidence', async () => {
  const { fetchImpl, requests } = createSuccessfulFetch()
  let time = 0
  const result = await runPostDeploySmoke({
    environment: 'STAGING',
    fetchImpl,
    now: () => (time += 2),
    origin,
    releaseId,
    requestId: '00000000-0000-4000-8000-000000000001'
  })

  assert.equal(result.schemaVersion, 1)
  assert.equal(result.environment, 'STAGING')
  assert.equal(result.releaseId, releaseId)
  assert.equal(result.checks.length, 6)
  assert.equal(JSON.stringify(result).includes(origin), false)
  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    [
      '/health/live',
      '/health/ready',
      '/',
      '/login',
      '/assets/app.js',
      '/mockServiceWorker.js'
    ]
  )
  for (const request of requests) {
    assert.equal(request.init.method, 'GET')
    assert.equal(request.init.credentials, 'omit')
    assert.equal(request.init.redirect, 'manual')
    assert.equal('Authorization' in request.init.headers, false)
    assert.equal('Cookie' in request.init.headers, false)
  }
})

test('post-deploy smoke rejects health drift and release mismatch', async () => {
  const extraFieldFetch = async () =>
    createResponse('{"status":"ok","detail":"unsafe"}', 200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'X-Release-Id': releaseId
    })
  await assert.rejects(
    runPostDeploySmoke({
      environment: 'STAGING',
      fetchImpl: extraFieldFetch,
      origin,
      releaseId
    }),
    /invalid health contract/u
  )

  const mismatchFetch = async () =>
    createResponse('{"status":"ok"}', 200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'X-Release-Id': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    })
  await assert.rejects(
    runPostDeploySmoke({
      environment: 'STAGING',
      fetchImpl: mismatchFetch,
      origin,
      releaseId
    }),
    /release ID mismatch/u
  )
})

test('post-deploy smoke rejects redirects, external assets and mock worker availability', async () => {
  const redirectFetch = async () =>
    createResponse('', 302, { Location: 'https://other.example.test/' })
  await assert.rejects(
    runPostDeploySmoke({
      environment: 'STAGING',
      fetchImpl: redirectFetch,
      origin,
      releaseId
    }),
    /returned a redirect/u
  )

  const externalAssetFetch = async (url) => {
    if (url.pathname.startsWith('/health/')) {
      return createResponse(
        url.pathname.endsWith('live')
          ? '{"status":"ok"}'
          : '{"status":"ready"}',
        200,
        {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          'X-Release-Id': releaseId
        }
      )
    }
    return createResponse(
      html.replace('/assets/app.js', 'https://cdn.example.test/app.js'),
      200,
      { 'Content-Type': 'text/html' }
    )
  }
  await assert.rejects(
    runPostDeploySmoke({
      environment: 'STAGING',
      fetchImpl: externalAssetFetch,
      origin,
      releaseId
    }),
    /cross-origin asset/u
  )

  const { fetchImpl } = createSuccessfulFetch()
  const workerFetch = async (url, init) => {
    if (url.pathname === '/mockServiceWorker.js') {
      return createResponse('worker', 200, {
        'Content-Type': 'text/javascript'
      })
    }
    return fetchImpl(url, init)
  }
  await assert.rejects(
    runPostDeploySmoke({
      environment: 'PRODUCTION',
      fetchImpl: workerFetch,
      origin: 'https://app.example.test',
      releaseId
    }),
    /mock worker is reachable/u
  )
})

test('post-deploy smoke requires one real lowercase release marker', async () => {
  for (const invalidHtml of [
    `<!-- <meta name="nihongo-release-id" content="${releaseId}"> --><script type="module" src="/assets/app.js"></script>`,
    `<script>const marker = '<meta name="nihongo-release-id" content="${releaseId}">'</script><script type="module" src="/assets/app.js"></script>`,
    `${html}<meta name="nihongo-release-id" content="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">`,
    html.replace(releaseId, releaseId.toUpperCase())
  ]) {
    const { fetchImpl } = createSuccessfulFetch()
    const invalidShellFetch = async (url, init) =>
      url.pathname === '/' || url.pathname === '/login'
        ? createResponse(invalidHtml, 200, { 'Content-Type': 'text/html' })
        : fetchImpl(url, init)

    await assert.rejects(
      runPostDeploySmoke({
        environment: 'STAGING',
        fetchImpl: invalidShellFetch,
        origin,
        releaseId
      }),
      /release marker/u
    )
  }
})

test('post-deploy smoke rejects unsafe asset references before requesting them', async () => {
  for (const unsafeReference of [
    '/assets/app.js?token=do-not-record',
    '/assets/app.js#do-not-record',
    'https://user:do-not-record@staging.example.test/assets/app.js',
    '/assets/app%2Ejs'
  ]) {
    const { fetchImpl, requests } = createSuccessfulFetch()
    const unsafeAssetFetch = async (url, init) =>
      url.pathname === '/' || url.pathname === '/login'
        ? createResponse(html.replace('/assets/app.js', unsafeReference), 200, {
            'Content-Type': 'text/html'
          })
        : fetchImpl(url, init)

    await assert.rejects(
      runPostDeploySmoke({
        environment: 'STAGING',
        fetchImpl: unsafeAssetFetch,
        origin,
        releaseId
      }),
      /asset references|unsafe Vite asset path/u
    )
    assert.equal(
      requests.some((request) => request.url.includes('do-not-record')),
      false
    )
  }
})

test('deployment origin and response size are fail closed', async () => {
  assert.throws(
    () => parseDeploymentOrigin('http://localhost:4173'),
    /exact credential-free HTTPS origin/u
  )
  assert.equal(
    parseDeploymentOrigin('http://127.0.0.1:4173', {
      allowLoopbackHttp: true
    }),
    'http://127.0.0.1:4173'
  )
  assert.equal(
    parseDeploymentOrigin('http://[::1]:4173', {
      allowLoopbackHttp: true
    }),
    'http://[::1]:4173'
  )
  assert.throws(
    () => parseDeploymentOrigin('https://user@example.test/path'),
    /exact credential-free HTTPS origin/u
  )
  await assert.rejects(
    runPostDeploySmoke({
      environment: 'PRODUCTION',
      fetchImpl: async () => createResponse('', 500),
      origin: 'https://127.0.0.1',
      releaseId
    }),
    /cannot be loopback/u
  )

  const oversizedFetch = async () =>
    createResponse('', 200, {
      'Cache-Control': 'no-store',
      'Content-Length': '1048577',
      'Content-Type': 'application/json',
      'X-Release-Id': releaseId
    })
  await assert.rejects(
    runPostDeploySmoke({
      environment: 'STAGING',
      fetchImpl: oversizedFetch,
      origin,
      releaseId
    }),
    /response is too large/u
  )

  const chunkedOversizedFetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(700_000))
          controller.enqueue(new Uint8Array(400_000))
          controller.close()
        }
      }),
      {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          'X-Release-Id': releaseId
        },
        status: 200
      }
    )
  await assert.rejects(
    runPostDeploySmoke({
      environment: 'STAGING',
      fetchImpl: chunkedOversizedFetch,
      origin,
      releaseId
    }),
    /response is too large/u
  )

  const stalledFetch = async () =>
    new Response(new ReadableStream({ start() {} }), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        'X-Release-Id': releaseId
      },
      status: 200
    })
  await assert.rejects(
    runPostDeploySmoke({
      environment: 'STAGING',
      fetchImpl: stalledFetch,
      origin,
      releaseId,
      timeoutMs: 100
    }),
    /timed out/u
  )
})
