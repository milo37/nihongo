import { authHandlers } from '@mocks/handlers/authHandlers'
import { bookmarkHandlers } from '@mocks/handlers/bookmarkHandlers'
import { dashboardHandlers } from '@mocks/handlers/dashboardHandlers'
import { dashboardV1Handlers } from '@mocks/handlers/dashboardV1Handlers'
import { operationsHandlers } from '@mocks/handlers/operationsHandlers'
import { questionHandlers } from '@mocks/handlers/questionHandlers'
import { dailyQuestionHandlers } from '@mocks/handlers/dailyQuestionHandlers'
import { reportHandlers } from '@mocks/handlers/reportHandlers'
import { reviewCenterHandlers } from '@mocks/handlers/reviewCenterHandlers'
import { studyDraftV2Handlers } from '@mocks/handlers/studyDraftV2Handlers'
import { studyResultRetryHandlers } from '@mocks/handlers/studyResultRetryHandlers'
import { studySessionHandlers } from '@mocks/handlers/studySessionHandlers'
import { wrongNoteHandlers } from '@mocks/handlers/wrongNoteHandlers'
import { wrongNoteV1Handlers } from '@mocks/handlers/wrongNoteV1Handlers'
import { guestAllowanceHandlers } from '@mocks/handlers/guestAllowanceHandlers'
import { guestResultImportHandlers } from '@mocks/handlers/guestResultImportHandlers'

export const handlers = [
  ...authHandlers,
  ...questionHandlers,
  ...dailyQuestionHandlers,
  ...studyDraftV2Handlers,
  ...studyResultRetryHandlers,
  ...studySessionHandlers,
  ...guestAllowanceHandlers,
  ...guestResultImportHandlers,
  ...reportHandlers,
  ...reviewCenterHandlers,
  ...wrongNoteV1Handlers,
  ...dashboardV1Handlers,
  ...wrongNoteHandlers,
  ...bookmarkHandlers,
  ...dashboardHandlers,
  ...operationsHandlers
]
