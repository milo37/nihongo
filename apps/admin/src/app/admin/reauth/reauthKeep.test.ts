import { cachedSessionStorage } from '@nihongo/browser/libs/storage'
import {
  REAUTH_KEEP_MS,
  clearReauthKeep,
  readReauthKeep,
  saveReauthKeep
} from '@app/admin/reauth/reauthKeep'

const takeReauthKeep = (
  ...args: Parameters<typeof readReauthKeep>
): unknown => {
  const value = readReauthKeep(...args)
  clearReauthKeep(args[0], args[1])
  return value
}

const NOW = Date.parse('2026-11-08T10:00:00.000Z')

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

it('restores a kept value once, for the same admin and screen', () => {
  const kept = { selected: ['q-1', 'q-2'] }
  expect(saveReauthKeep('admin-1', 'question-list', kept, NOW)).toBe(true)
  expect(readReauthKeep('admin-2', 'question-list', NOW)).toBeNull()
  expect(readReauthKeep('admin-1', 'report-detail', NOW)).toBeNull()
  // Reading twice (a doubled state initializer) still finds it.
  expect(readReauthKeep('admin-1', 'question-list', NOW + 500)).toEqual(kept)
  expect(takeReauthKeep('admin-1', 'question-list', NOW + 1000)).toEqual(kept)
  expect(takeReauthKeep('admin-1', 'question-list', NOW + 2000)).toBeNull()
})

it('drops a value older than ten minutes or from the future', () => {
  saveReauthKeep('admin-1', 'report-detail', 'memo', NOW)
  expect(
    takeReauthKeep('admin-1', 'report-detail', NOW + REAUTH_KEEP_MS + 1)
  ).toBeNull()
  saveReauthKeep('admin-1', 'report-detail', 'memo', NOW)
  expect(takeReauthKeep('admin-1', 'report-detail', NOW - 1)).toBeNull()
})

it('reports a failed save so the page can stay instead of leaving', () => {
  vi.spyOn(cachedSessionStorage, 'setItem').mockReturnValue(false)
  expect(saveReauthKeep('admin-1', 'member-detail', 'reason', NOW)).toBe(false)
})

it('ignores unreadable stored text', () => {
  window.sessionStorage.setItem(
    'nihongo:admin-reauth:v1:admin-1:question-edit',
    '{not json'
  )
  expect(takeReauthKeep('admin-1', 'question-edit', NOW)).toBeNull()
})
