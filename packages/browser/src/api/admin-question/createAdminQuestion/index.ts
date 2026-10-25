import { requestPhase7Operation } from '../../phase7/requestPhase7Operation'
import type { CreateAdminQuestionRequest } from './schema'
export const createAdminQuestion = (body: CreateAdminQuestionRequest) =>
  requestPhase7Operation({
    operation: 'createAdminQuestion',
    params: {},
    query: {},
    body: body
  })
