import { adminQuestionHandlers } from '@mocks/handlers/adminQuestionHandlers'
import { authHandlers } from '@mocks/handlers/authHandlers'
import { bookmarkHandlers } from '@mocks/handlers/bookmarkHandlers'
import { dashboardHandlers } from '@mocks/handlers/dashboardHandlers'
import { dashboardV1Handlers } from '@mocks/handlers/dashboardV1Handlers'
import { questionHandlers } from '@mocks/handlers/questionHandlers'
import { studyHandlers } from '@mocks/handlers/studyHandlers'
import { studyDraftV2Handlers } from '@mocks/handlers/studyDraftV2Handlers'
import { studySessionV1Handlers } from '@mocks/handlers/studySessionV1Handlers'
import { wrongNoteHandlers } from '@mocks/handlers/wrongNoteHandlers'
import { wrongNoteV1Handlers } from '@mocks/handlers/wrongNoteV1Handlers'

export const handlers = [
  ...authHandlers,
  ...questionHandlers,
  ...studyDraftV2Handlers,
  ...studySessionV1Handlers,
  ...wrongNoteV1Handlers,
  ...dashboardV1Handlers,
  ...studyHandlers,
  ...wrongNoteHandlers,
  ...bookmarkHandlers,
  ...dashboardHandlers,
  ...adminQuestionHandlers
]
