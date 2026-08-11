import { adminQuestionHandlers } from '@mocks/handlers/adminQuestionHandlers'
import { authHandlers } from '@mocks/handlers/authHandlers'
import { bookmarkHandlers } from '@mocks/handlers/bookmarkHandlers'
import { dashboardHandlers } from '@mocks/handlers/dashboardHandlers'
import { questionHandlers } from '@mocks/handlers/questionHandlers'
import { studyHandlers } from '@mocks/handlers/studyHandlers'
import { wrongNoteHandlers } from '@mocks/handlers/wrongNoteHandlers'

export const handlers = [
  ...authHandlers,
  ...questionHandlers,
  ...studyHandlers,
  ...wrongNoteHandlers,
  ...bookmarkHandlers,
  ...dashboardHandlers,
  ...adminQuestionHandlers
]
