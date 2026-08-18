import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL
const outputLabel = process.env.PLAYWRIGHT_OUTPUT_LABEL ?? 'real'

if (!baseURL) {
  throw new Error(
    'PLAYWRIGHT_BASE_URL is required. Run the isolated root test:e2e script.'
  )
}

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: `test-results/playwright-slice2-${outputLabel}`,
  reporter: [
    ['list'],
    [
      'html',
      { open: 'never', outputFolder: `playwright-report/${outputLabel}` }
    ]
  ],
  retries: 0,
  testDir: 'apps/web/e2e',
  timeout: 75_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    locale: 'ko-KR',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  },
  workers: 1
})
