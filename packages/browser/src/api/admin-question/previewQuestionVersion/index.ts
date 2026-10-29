import { requestContentOperation } from '../../content-operations/requestContentOperation'
export const previewQuestionVersion = (versionId: string) =>
  requestContentOperation({
    operation: 'previewQuestionVersion',
    params: { versionId },
    query: {},
    body: undefined
  })
