import { requestContentOperation } from '../../content-operations/requestContentOperation'
export const getAdminQuestion = (questionId: string) =>
  requestContentOperation({
    operation: 'getAdminQuestion',
    params: { questionId },
    query: {},
    body: undefined
  })
