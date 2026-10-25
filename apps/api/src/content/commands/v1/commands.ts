import { summarizeBundleCoverage } from '@nihongo/domain/content/validators/v1/coverage'
import {
  canonicalDuplicateIdentity,
  scoreNearDuplicate,
  type DuplicateScoreV1
} from '@nihongo/domain/content/validators/v1/duplicates'
import {
  loadAnalysisInput,
  MAX_REPORTED_CANDIDATES,
  resolveRepositoryRoot,
  type AnalysisItem,
  type ContentAnalysisCommand
} from './commandSupport.js'

interface DuplicateCandidate {
  readonly leftContentKey: string
  readonly rightContentKey: string
  readonly kind: 'EXACT' | 'NEAR'
  readonly score: DuplicateScoreV1 | null
}

const inspectDuplicates = (items: readonly AnalysisItem[]) => {
  let exactPairCount = 0
  let nearCandidateCount = 0
  const candidates: DuplicateCandidate[] = []
  const identities = items.map(({ content }) =>
    canonicalDuplicateIdentity(content)
  )
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    const left = items[leftIndex]
    if (!left) continue
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < items.length;
      rightIndex += 1
    ) {
      const right = items[rightIndex]
      if (!right) continue
      if (identities[leftIndex] === identities[rightIndex]) {
        exactPairCount += 1
        if (candidates.length < MAX_REPORTED_CANDIDATES) {
          candidates.push({
            leftContentKey: left.contentKey,
            rightContentKey: right.contentKey,
            kind: 'EXACT',
            score: null
          })
        }
        continue
      }
      for (const score of scoreNearDuplicate(left.content, right.content)) {
        if (!score.matchesThreshold) continue
        nearCandidateCount += 1
        if (candidates.length < MAX_REPORTED_CANDIDATES) {
          candidates.push({
            leftContentKey: left.contentKey,
            rightContentKey: right.contentKey,
            kind: 'NEAR',
            score
          })
        }
      }
    }
  }
  return {
    exactPairCount,
    nearCandidateCount,
    reportedCandidateCount: candidates.length,
    maximumReportedCandidates: MAX_REPORTED_CANDIDATES,
    truncated: exactPairCount + nearCandidateCount > candidates.length,
    candidates
  }
}

export const runContentAnalysis = async (
  command: ContentAnalysisCommand,
  args: readonly string[],
  repositoryRoot?: string
) => {
  const input = await loadAnalysisInput(
    command,
    args,
    repositoryRoot ?? (await resolveRepositoryRoot())
  )
  const result = {
    schemaVersion: 1 as const,
    mode: 'PASSIVE_ANALYSIS' as const,
    command: `content:${command}`,
    status: 'ANALYZED' as const,
    scope: input.scope,
    inputSha256: input.inputSha256,
    itemCount: input.items.length,
    inventory: input.inventory,
    trustVerified: false as const,
    fullTaxonomyApplicabilityVerified: false as const
  }
  if (command === 'coverage') {
    const coverage = summarizeBundleCoverage(
      input.items.map(({ content }) => ({
        // Neutral slots adapt semantic rows for counting, not authored evidence.
        content: {
          ...content,
          distractorRationalesKo: { '1': null, '2': null, '3': null, '4': null }
        }
      }))
    )
    return { ...result, coverage: { ...coverage, scope: input.scope } }
  }
  if (command === 'duplicates')
    return { ...result, duplicateAnalysis: inspectDuplicates(input.items) }
  return { ...result, structurallyValid: true as const }
}
