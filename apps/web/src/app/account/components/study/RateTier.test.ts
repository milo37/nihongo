import { getRateTier } from '@app/account/components/study/RateTier'

// JLP-851: the tier follows the rounded number on screen.
it.each([
  [100, 'high'],
  [80, 'high'],
  [79.5, 'high'],
  [79.49, 'mid'],
  [60, 'mid'],
  [59.5, 'mid'],
  [59.49, 'low'],
  [0, 'low']
] as const)('%s%% is %s', (rate, tier) => {
  expect(getRateTier(rate)).toBe(tier)
})
