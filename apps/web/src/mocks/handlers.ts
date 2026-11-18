import { authHandlers } from '@mocks/handlers/authHandlers'
import { bookmarkHandlers } from '@mocks/handlers/bookmarkHandlers'
import { dashboardV1Handlers } from '@mocks/handlers/dashboardV1Handlers'
import { operationsHandlers } from '@mocks/handlers/operationsHandlers'
import { dailyQuestionHandlers } from '@mocks/handlers/dailyQuestionHandlers'
import { reportHandlers } from '@mocks/handlers/reportHandlers'
import { reviewCenterHandlers } from '@mocks/handlers/reviewCenterHandlers'
import { studyDraftV2Handlers } from '@mocks/handlers/studyDraftV2Handlers'
import { studyResultRetryHandlers } from '@mocks/handlers/studyResultRetryHandlers'
import { studySessionHandlers } from '@mocks/handlers/studySessionHandlers'
import { wrongNoteV1Handlers } from '@mocks/handlers/wrongNoteV1Handlers'
import { guestAllowanceHandlers } from '@mocks/handlers/guestAllowanceHandlers'
import { guestResultImportHandlers } from '@mocks/handlers/guestResultImportHandlers'

export const handlers = [
  ...authHandlers,
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
  ...bookmarkHandlers,
  ...operationsHandlers
]
