import { authHandlers } from '@mocks/handlers/authHandlers'
import { bookmarkHandlers } from '@mocks/handlers/bookmarkHandlers'
import { dashboardHandlers } from '@mocks/handlers/dashboardHandlers'
import { dashboardInsightsV1Handlers } from '@mocks/handlers/dashboardInsightsV1Handlers'
import { dashboardV1Handlers } from '@mocks/handlers/dashboardV1Handlers'
import { questionHandlers } from '@mocks/handlers/questionHandlers'
import { reportHandlers } from '@mocks/handlers/reportHandlers'
import { reviewCenterHandlers } from '@mocks/handlers/reviewCenterHandlers'
import { studyDraftV2Handlers } from '@mocks/handlers/studyDraftV2Handlers'
import { studyResultRetryHandlers } from '@mocks/handlers/studyResultRetryHandlers'
import { studySessionHandlers } from '@mocks/handlers/studySessionHandlers'
import { wrongNoteHandlers } from '@mocks/handlers/wrongNoteHandlers'
import { wrongNoteV1Handlers } from '@mocks/handlers/wrongNoteV1Handlers'

export const handlers = [
  ...authHandlers,
  ...questionHandlers,
  ...studyDraftV2Handlers,
  ...studyResultRetryHandlers,
  ...studySessionHandlers,
  ...reportHandlers,
  ...reviewCenterHandlers,
  ...wrongNoteV1Handlers,
  ...dashboardInsightsV1Handlers,
  ...dashboardV1Handlers,
  ...wrongNoteHandlers,
  ...bookmarkHandlers,
  ...dashboardHandlers
]
