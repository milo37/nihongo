import type { QuestionRecord, User } from '@common/types/domain'
import { originalQuestions } from '@mocks/data/questions'
import { demoUsers } from '@mocks/data/users'

export interface MockSeedData {
  questions: QuestionRecord[]
  users: User[]
}

export const mockSeedData: MockSeedData = {
  questions: originalQuestions,
  users: demoUsers
}
