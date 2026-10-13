import type { QuestionRecord, User } from '@common/types/domain'
import { originalQuestions } from '@mocks/data/questions'
import { approvedN5ReadingQuestions } from '@mocks/data/questions/approvedN5Reading'
import { demoUsers } from '@mocks/data/users'

export interface MockSeedData {
  questions: QuestionRecord[]
  users: User[]
}

export const mockSeedData: MockSeedData = {
  questions: [...originalQuestions, ...approvedN5ReadingQuestions],
  users: demoUsers
}
