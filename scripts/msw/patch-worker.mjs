import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)
const workerPath = path.join(
  repositoryRoot,
  'apps/web/public/mockServiceWorker.js'
)
const marker = "const mockClientOriginHeader = 'x-nihongo-msw-client-origin'"
const upstreamNeedle = `  const serializedRequest = await serializeRequest(event.request)
  const clientMessage = await sendToClient(`
const patchedBlock = `  const serializedRequest = await serializeRequest(event.request)
  // Same-origin browser fetches may expose neither Origin nor Fetch Metadata
  // to the Service Worker. A forbidden Origin header would be stripped again
  // when MSW reconstructs the Request in the page, so attach a mock-only
  // attestation that is always overwritten at this trusted boundary.
  const mockClientOriginHeader = 'x-nihongo-msw-client-origin'
  delete serializedRequest.headers[mockClientOriginHeader]
  const clientOrigin = new URL(client.url).origin
  const requestOrigin = new URL(event.request.url).origin
  if (
    event.clientId !== '' &&
    client.id === event.clientId &&
    clientOrigin === requestOrigin
  ) {
    serializedRequest.headers[mockClientOriginHeader] = clientOrigin
  }
  const clientMessage = await sendToClient(`

const worker = await readFile(workerPath, 'utf8')
const isPatched = worker.includes(marker)

if (process.argv.includes('--check')) {
  if (!isPatched || !worker.includes(patchedBlock)) {
    throw new Error(
      'mockServiceWorker.js is missing the source-bound same-origin attestation patch.'
    )
  }
  process.stdout.write('MSW worker attestation patch verified.\n')
} else if (isPatched) {
  if (!worker.includes(patchedBlock)) {
    throw new Error('The existing MSW worker attestation patch has drifted.')
  }
  process.stdout.write('MSW worker attestation patch already applied.\n')
} else {
  if (!worker.includes(upstreamNeedle)) {
    throw new Error(
      'The installed MSW worker no longer matches the supported patch point.'
    )
  }
  await writeFile(
    workerPath,
    worker.replace(upstreamNeedle, patchedBlock),
    'utf8'
  )
  process.stdout.write('MSW worker attestation patch applied.\n')
}
