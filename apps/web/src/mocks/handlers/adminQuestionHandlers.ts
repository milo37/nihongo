import { adminCmsCommandHandlers } from '@mocks/handlers/adminCmsCommandHandlers'
import { adminCmsReadHandlers } from '@mocks/handlers/adminCmsReadHandlers'

export const adminQuestionHandlers = [
  ...adminCmsCommandHandlers,
  ...adminCmsReadHandlers
]
