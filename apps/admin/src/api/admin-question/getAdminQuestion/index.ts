import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'
export const getAdminQuestion = (questionId: string) =>
  requestContentOperation({
    operation: 'getAdminQuestion',
    params: { questionId },
    query: {},
    body: undefined
  })
