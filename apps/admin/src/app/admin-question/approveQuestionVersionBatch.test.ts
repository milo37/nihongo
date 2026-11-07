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

const approve = () =>
  requestContentOperation({
    operation: 'approveQuestionVersionBatch',
    params: {},
    query: {},
    body: {
      items: [
        { questionVersionId: first, expectedRowVersion: 3 },
        { questionVersionId: second, expectedRowVersion: 5 }
      ]
    }
  })

test.each([
  'VERSION_CONFLICT',
  'NOT_IN_REVIEW',
  'NOT_FOUND',
  'FAILED'
] as const)(
  'accepts a per-item partial batch approve result with %s in request order',
  async (result) => {
    answer = {
      approvedCount: 1,
      items: [
        { questionVersionId: first, result: 'APPROVED', rowVersion: 4 },
        { questionVersionId: second, result, rowVersion: null }
      ]
    }
    await expect(approve()).resolves.toEqual(answer)
  }
)

test.each([
  [
    'reordered items',
    [
      { questionVersionId: second, result: 'NOT_FOUND', rowVersion: null },
      { questionVersionId: first, result: 'APPROVED', rowVersion: 4 }
    ]
  ],
  [
    'an approved row version that skips ahead',
    [
      { questionVersionId: first, result: 'APPROVED', rowVersion: 9 },
      { questionVersionId: second, result: 'NOT_IN_REVIEW', rowVersion: null }
    ]
  ],
  [
    'a row version on an unapproved item',
    [
      { questionVersionId: first, result: 'APPROVED', rowVersion: 4 },
      { questionVersionId: second, result: 'VERSION_CONFLICT', rowVersion: 6 }
    ]
  ],
  [
    'a missing item',
    [{ questionVersionId: first, result: 'APPROVED', rowVersion: 4 }]
  ]
])('rejects %s as a response validation error', async (_name, items) => {
  answer = {
    approvedCount: items.filter(({ result }) => result === 'APPROVED').length,
    items
  }
  await expect(approve()).rejects.toMatchObject({
    isResponseValidationError: true
  })
})
