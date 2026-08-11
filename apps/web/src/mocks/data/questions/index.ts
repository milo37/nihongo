import type { QuestionRecord } from '@common/types/domain'
import { n1Questions } from '@mocks/data/questions/n1'
import { n2Questions } from '@mocks/data/questions/n2'
import { n3Questions } from '@mocks/data/questions/n3'
import { n4Questions } from '@mocks/data/questions/n4'
import { n5Questions } from '@mocks/data/questions/n5'

export const originalQuestions: QuestionRecord[] = [
  ...n5Questions,
  ...n4Questions,
  ...n3Questions,
  ...n2Questions,
  ...n1Questions
]
