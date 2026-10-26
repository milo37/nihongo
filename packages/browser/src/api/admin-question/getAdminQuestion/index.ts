import { requestPhase7Operation } from '../../phase7/requestPhase7Operation'
export const getAdminQuestion = (questionId: string) =>
  requestPhase7Operation({
    operation: 'getAdminQuestion',
    params: { questionId },
    query: {},
    body: undefined
  })
