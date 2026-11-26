import { queryClient } from '@nihongo/browser/libs/queryClient'

// #1262: in the learner app a screen draws its own data's failure, so a
// failed query stays on that screen (localErrorUi) unless it sets its own
// meta; sign-in and permission failures still reach the global handler.
// A screen that shows nothing on failure is a bug of that screen. Actions
// (mutations) keep the global warning toast unless they show it themselves.
queryClient.setQueryDefaults([], { meta: { localErrorUi: true } })
