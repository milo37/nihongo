import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL
const outputLabel = process.env.PLAYWRIGHT_OUTPUT_LABEL ?? 'real'
const safeEvidenceDirectory =
  process.env.PHASE10_PLAYWRIGHT_EVIDENCE_DIR ??
  'test-results/phase10-evidence/playwright'

if (!baseURL) {
  throw new Error(
    'PLAYWRIGHT_BASE_URL is required. Run an isolated browser acceptance script.'
  )
}

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: `test-results/phase10-raw/${outputLabel}`,
  reporter: [
    ['list'],
    [
      './scripts/security/phase10-playwright-summary-reporter.mjs',
      { label: outputLabel, outputDirectory: safeEvidenceDirectory }
    ]
  ],
  retries: 0,
  testDir: 'apps/web/e2e',
  timeout: 75_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    locale: 'ko-KR',
    screenshot: 'off',
    timezoneId: 'Asia/Tokyo',
    trace: 'off',
    video: 'off'
  },
  workers: 1
})
