import type { OriginalQuestionSeed } from './createQuestion.js'
import { n1Questions } from './n1.js'
import { n2Questions } from './n2.js'
import { n3Questions } from './n3.js'
import { n4Questions } from './n4.js'
import { n5Questions } from './n5.js'

export const originalQuestionSeeds: readonly OriginalQuestionSeed[] = [
  ...n5Questions,
  ...n4Questions,
  ...n3Questions,
  ...n2Questions,
  ...n1Questions
]
