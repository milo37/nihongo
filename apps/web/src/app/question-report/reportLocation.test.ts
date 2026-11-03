import { describe, expect, it } from 'vitest'
import {
  reportScreenKeys,
  toQuestionReportLocation,
  toReportScreenKey
} from '@app/question-report/reportLocation'

describe('report location', () => {
  it('uses only the fixed learner screen key list', () => {
    expect(reportScreenKeys).toEqual([
      'home',
      'login',
      'dashboard',
      'practiceSetup',
      'practiceSession',
      'result',
      'wrongNoteCenter',
      'wrongNoteDetail',
      'bookmarks',
      'legal',
      'accountData',
      'support',
      'forbidden',
      'page'
    ])
  })

  it.each([
    ['/practice/result/019d0000-0000-7000-8000-000000000001', 'result'],
    [
      '/practice/session/019d0000-0000-7000-8000-000000000001',
      'practiceSession'
    ],
    ['/wrong-notes/019d0000-0000-7000-8000-000000000001', 'wrongNoteDetail'],
    ['/dashboard', 'dashboard'],
    ['/admin/reports', 'page'],
    ['/unknown/path', 'page']
  ])('maps %s to %s without IDs', (pathname, key) => {
    expect(toReportScreenKey(pathname)).toBe(key)
  })

  it('formats question locations as screen key and number only', () => {
    const location = toQuestionReportLocation('result', 3)
    expect(location).toBe('result#3')
    expect(location).not.toMatch(/[?/]|[0-9a-f]{8}-/u)
    expect(location.length).toBeLessThanOrEqual(200)
  })
})
