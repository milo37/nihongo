import { canonicalizeJson } from './canonical-json.js'
import { compareUnicodeScalars, normalizeDuplicateText } from './unicode.js'
import type {
  ContentBundleItemV1,
  OriginalQuestionContentV1,
  PersistedQuestionSemanticV1
} from './types.js'

export const DUPLICATE_RULES = {
  QUESTION_PASSAGE_TRIGRAM_V1: 8200,
  QUESTION_TEXT_EDIT_V1: 9000,
  READING_PASSAGE_TRIGRAM_V1: 9000
} as const

export type DuplicateRuleId = keyof typeof DUPLICATE_RULES

export interface DuplicateIdentityMaterialV1 {
  readonly subject: OriginalQuestionContentV1['subject']
  readonly questionType: OriginalQuestionContentV1['questionType']
  readonly passage: string | null
  readonly questionText: string
  readonly optionTexts: readonly string[]
  readonly correctOptionText: string
}

export interface DuplicateScoreV1 {
  readonly ruleId: DuplicateRuleId
  readonly scoreNumerator: number
  readonly scoreDenominator: number
  readonly scoreBasisPoints: number
  readonly matchesThreshold: boolean
}

export interface BundleDuplicateCandidateV1 {
  readonly contentKey: string
  readonly content: OriginalQuestionContentV1 | PersistedQuestionSemanticV1
}

const optionTextForCorrectKey = (
  content: OriginalQuestionContentV1 | PersistedQuestionSemanticV1
): string =>
  content.options.find(({ key }) => key === content.correctOptionKey)?.text ??
  ''

export const createDuplicateIdentityMaterial = (
  content: OriginalQuestionContentV1 | PersistedQuestionSemanticV1
): DuplicateIdentityMaterialV1 => ({
  subject: content.subject,
  questionType: content.questionType,
  passage:
    content.passage === null ? null : normalizeDuplicateText(content.passage),
  questionText: normalizeDuplicateText(content.questionText),
  optionTexts: content.options
    .map(({ text }) => normalizeDuplicateText(text))
    .toSorted(compareUnicodeScalars),
  correctOptionText: normalizeDuplicateText(optionTextForCorrectKey(content))
})

export const canonicalDuplicateIdentity = (
  content: OriginalQuestionContentV1 | PersistedQuestionSemanticV1
): string => canonicalizeJson(createDuplicateIdentityMaterial(content))

const toCodePoints = (value: string): readonly string[] => Array.from(value)

const trigramSet = (value: string): Set<string> => {
  const points = toCodePoints(value)
  if (points.length === 0) return new Set([''])
  if (points.length < 3) return new Set([points.join('')])
  const trigrams = new Set<string>()
  for (let index = 0; index <= points.length - 3; index += 1) {
    trigrams.add(points.slice(index, index + 3).join(''))
  }
  return trigrams
}

const jaccard = (left: string, right: string): readonly [number, number] => {
  const leftTokens = trigramSet(left)
  const rightTokens = trigramSet(right)
  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1
  }
  const union = new Set([...leftTokens, ...rightTokens]).size
  return [intersection, union]
}

const levenshtein = (left: string, right: string): number => {
  const leftPoints = toCodePoints(left)
  const rightPoints = toCodePoints(right)
  const pattern =
    leftPoints.length <= rightPoints.length ? leftPoints : rightPoints
  const text =
    leftPoints.length <= rightPoints.length ? rightPoints : leftPoints
  if (pattern.length === 0) return text.length

  const masks = new Map<string, bigint>()
  for (const [index, character] of pattern.entries()) {
    masks.set(character, (masks.get(character) ?? 0n) | (1n << BigInt(index)))
  }

  const widthMask = (1n << BigInt(pattern.length)) - 1n
  const topBit = 1n << BigInt(pattern.length - 1)
  let positive = widthMask
  let negative = 0n
  let distance = pattern.length

  for (const character of text) {
    const equality = masks.get(character) ?? 0n
    const combined = equality | negative
    const diagonal =
      ((((combined & positive) + positive) ^ positive) | combined) & widthMask
    const horizontalPositive = (negative | ~(diagonal | positive)) & widthMask
    const horizontalNegative = positive & diagonal

    if ((horizontalPositive & topBit) !== 0n) distance += 1
    else if ((horizontalNegative & topBit) !== 0n) distance -= 1

    const shiftedPositive = ((horizontalPositive << 1n) | 1n) & widthMask
    negative = shiftedPositive & diagonal
    positive =
      ((horizontalNegative << 1n) | ~(shiftedPositive | diagonal)) & widthMask
  }

  return distance
}

const toScore = (
  ruleId: DuplicateRuleId,
  numerator: number,
  denominator: number
): DuplicateScoreV1 => ({
  ruleId,
  scoreNumerator: numerator,
  scoreDenominator: denominator,
  scoreBasisPoints: Math.floor((10000 * numerator) / denominator),
  matchesThreshold: numerator * 10000 >= DUPLICATE_RULES[ruleId] * denominator
})

export const scoreNearDuplicate = (
  left: OriginalQuestionContentV1 | PersistedQuestionSemanticV1,
  right: OriginalQuestionContentV1 | PersistedQuestionSemanticV1
): readonly DuplicateScoreV1[] => {
  const leftQuestion = normalizeDuplicateText(left.questionText)
  const rightQuestion = normalizeDuplicateText(right.questionText)
  const leftPassage =
    left.passage === null ? '' : normalizeDuplicateText(left.passage)
  const rightPassage =
    right.passage === null ? '' : normalizeDuplicateText(right.passage)
  const [questionPassageNumerator, questionPassageDenominator] = jaccard(
    `${leftQuestion}\u0000${leftPassage}`,
    `${rightQuestion}\u0000${rightPassage}`
  )
  const maximumQuestionLength = Math.max(
    toCodePoints(leftQuestion).length,
    toCodePoints(rightQuestion).length
  )
  const questionDistance = levenshtein(leftQuestion, rightQuestion)
  const questionEditNumerator =
    maximumQuestionLength === 0 ? 1 : maximumQuestionLength - questionDistance
  const questionEditDenominator =
    maximumQuestionLength === 0 ? 1 : maximumQuestionLength

  const scores: DuplicateScoreV1[] = [
    toScore(
      'QUESTION_PASSAGE_TRIGRAM_V1',
      questionPassageNumerator,
      questionPassageDenominator
    ),
    toScore(
      'QUESTION_TEXT_EDIT_V1',
      questionEditNumerator,
      questionEditDenominator
    )
  ]

  if (left.passage !== null && right.passage !== null) {
    const [passageNumerator, passageDenominator] = jaccard(
      leftPassage,
      rightPassage
    )
    scores.push(
      toScore(
        'READING_PASSAGE_TRIGRAM_V1',
        passageNumerator,
        passageDenominator
      )
    )
  }

  return scores
}

export interface IntraBundleDuplicateResultV1 {
  readonly exactPairs: readonly {
    readonly leftContentKey: string
    readonly rightContentKey: string
  }[]
  readonly warnings: readonly {
    readonly contentKey: string
    readonly candidateContentKey: string
    readonly score: DuplicateScoreV1
  }[]
}

export const inspectIntraBundleDuplicates = (
  items: readonly Pick<ContentBundleItemV1, 'contentKey' | 'content'>[]
): IntraBundleDuplicateResultV1 => {
  const ordered = items.toSorted((left, right) =>
    compareUnicodeScalars(left.contentKey, right.contentKey)
  )
  const exactPairs: Array<{
    leftContentKey: string
    rightContentKey: string
  }> = []
  const warnings: Array<{
    contentKey: string
    candidateContentKey: string
    score: DuplicateScoreV1
  }> = []

  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const left = ordered[leftIndex]
    if (!left) continue
    const leftIdentity = canonicalDuplicateIdentity(left.content)
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < ordered.length;
      rightIndex += 1
    ) {
      const right = ordered[rightIndex]
      if (!right) continue
      if (leftIdentity === canonicalDuplicateIdentity(right.content)) {
        exactPairs.push({
          leftContentKey: left.contentKey,
          rightContentKey: right.contentKey
        })
        continue
      }
      for (const score of scoreNearDuplicate(left.content, right.content)) {
        if (!score.matchesThreshold) continue
        warnings.push({
          contentKey: left.contentKey,
          candidateContentKey: right.contentKey,
          score
        })
        warnings.push({
          contentKey: right.contentKey,
          candidateContentKey: left.contentKey,
          score
        })
      }
    }
  }

  return {
    exactPairs,
    warnings: warnings.toSorted((left, right) => {
      const keyOrder = compareUnicodeScalars(left.contentKey, right.contentKey)
      if (keyOrder !== 0) return keyOrder
      const candidateOrder = compareUnicodeScalars(
        left.candidateContentKey,
        right.candidateContentKey
      )
      return candidateOrder !== 0
        ? candidateOrder
        : compareUnicodeScalars(left.score.ruleId, right.score.ruleId)
    })
  }
}
