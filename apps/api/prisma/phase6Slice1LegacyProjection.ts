import { QUESTION_CONTENT_REVIEW } from './seed-data/contentReview.js'
import { buildAllQuestionSeeds } from './seedQuestionCatalog.js'
import {
  projectLegacySeedArtifacts,
  type LegacySeedProjectionV1
} from '../src/content/validators/v1/legacySeedProjector.js'

export const projectCanonicalLegacySeedArtifacts = async (
  repositoryRoot: string
): Promise<LegacySeedProjectionV1> => {
  const seeds = buildAllQuestionSeeds()
  return projectLegacySeedArtifacts(
    repositoryRoot,
    seeds,
    QUESTION_CONTENT_REVIEW.sha256
  )
}
