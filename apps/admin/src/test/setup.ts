import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { appI18n } from '@nihongo/browser/i18n/config'
beforeEach(async () => {
  await appI18n.changeLanguage('ko')
})
afterEach(cleanup)
