import { LOCAL_RELEASE_ID, resolveReleaseId } from '@libs/resolveReleaseId'

export const releaseId = resolveReleaseId(__NIHONGO_RELEASE_ID__)
export const releaseLabel =
  releaseId === LOCAL_RELEASE_ID ? 'local' : releaseId.slice(0, 12)
