import type { QuestionRecord, User } from '@nihongo/browser/common/types/domain'
import { originalQuestions } from '@mocks/data/questions'
import { approvedN5ReadingQuestions } from '@mocks/data/questions/approvedN5Reading'
import { demoUsers } from '@mocks/data/users'
import { renderSetQuestions } from '@mocks/data/questions/renderSet'

export interface MockSeedData {
  questions: QuestionRecord[]
  users: User[]
}

export const mockSeedData: MockSeedData = {
  questions: [
    ...originalQuestions,
    ...approvedN5ReadingQuestions,
    // Dev server only, for 20-question renders (JLP-833).
    ...(import.meta.env.MODE === 'development' &&
    import.meta.env['VITE_MOCK_RENDER_SET'] === '1'
      ? renderSetQuestions
      : [])
  ],
  users: demoUsers
}
