import { apiClient } from '@nihongo/browser/api/config'
import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'

const first = '40000000-0000-4000-8000-000000000001'
const second = '40000000-0000-4000-8000-000000000002'
const originalAdapter = apiClient.defaults.adapter
let answer: unknown

beforeEach(() => {
  apiClient.defaults.adapter = async (config) => ({
    data: answer,
    status: 200,
    statusText: '',
    config,
    headers: {
      'cache-control': 'private, no-store',
      'x-request-id': '30000000-0000-4000-8000-000000000001'
    }
  })
})
afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
})

const publish = () =>
  requestContentOperation({
    operation: 'publishQuestionVersionBatch',
    params: {},
    query: {},
    body: {
      items: [
        { questionVersionId: first, expectedRowVersion: 3 },
        { questionVersionId: second, expectedRowVersion: 5 }
      ]
    }
  })

test('accepts a per-item partial batch publish result in request order', async () => {
  answer = {
    publishedCount: 1,
    items: [
      { questionVersionId: first, result: 'PUBLISHED', rowVersion: 4 },
      {
        questionVersionId: second,
        result: 'VERSION_CONFLICT',
        rowVersion: null
      }
    ]
  }
  await expect(publish()).resolves.toEqual(answer)
})

test.each([
  [
    'reordered items',
    [
      { questionVersionId: second, result: 'NOT_FOUND', rowVersion: null },
      { questionVersionId: first, result: 'PUBLISHED', rowVersion: 4 }
    ]
  ],
  [
    'a published row version that skips ahead',
    [
      { questionVersionId: first, result: 'PUBLISHED', rowVersion: 9 },
      { questionVersionId: second, result: 'NOT_REVIEWED', rowVersion: null }
    ]
  ],
  [
    'a row version on an unpublished item',
    [
      { questionVersionId: first, result: 'PUBLISHED', rowVersion: 4 },
      { questionVersionId: second, result: 'VERSION_CONFLICT', rowVersion: 6 }
    ]
  ],
  [
    'a missing item',
    [{ questionVersionId: first, result: 'PUBLISHED', rowVersion: 4 }]
  ]
])('rejects %s as a response validation error', async (_name, items) => {
  answer = {
    publishedCount: items.filter(({ result }) => result === 'PUBLISHED').length,
    items
  }
  await expect(publish()).rejects.toMatchObject({
    isResponseValidationError: true
  })
})
