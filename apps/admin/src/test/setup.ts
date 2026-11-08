import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { appI18n } from '@nihongo/browser/i18n/config'
// A route render (auth check, lazy page import, i18n) can take longer than the
// 1s default `findBy*`/`waitFor` window when every core is busy, so the first
// wait in a file timed out on loaded machines. This is a deadline, not a retry:
// a missing element still fails, only later, and well inside the 5s test
// timeout.
configure({ asyncUtilTimeout: 3_000 })
// jsdom has no layout; list paging scrolls the top toolbar into view.
Element.prototype.scrollIntoView ??= () => undefined
beforeEach(async () => {
  await appI18n.changeLanguage('ko')
})
afterEach(cleanup)
