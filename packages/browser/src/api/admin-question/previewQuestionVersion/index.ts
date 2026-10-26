import { requestPhase7Operation } from '../../phase7/requestPhase7Operation'
export const previewQuestionVersion = (versionId: string) =>
  requestPhase7Operation({
    operation: 'previewQuestionVersion',
    params: { versionId },
    query: {},
    body: undefined
  })
