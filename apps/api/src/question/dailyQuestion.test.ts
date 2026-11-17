import { describe, expect, it } from 'vitest'
import {
  DAILY_SHEET_MAX_CHARACTERS,
  SHEET_SPACE_PATTERN,
  dailySheetLength
} from './dailyQuestion.js'

describe('daily question manuscript sheet length (#1087)', () => {
  it('counts squares as the web card does: spaces dropped, code points', () => {
    expect(DAILY_SHEET_MAX_CHARACTERS).toBe(36)
    expect(dailySheetLength('あ'.repeat(36))).toBe(36)
    expect(dailySheetLength('あ'.repeat(37))).toBe(37)
    expect(dailySheetLength('わたし は　がくせい\nです。')).toBe(11)
    // A surrogate pair is one square, as Array.from counts it.
    expect(dailySheetLength('𠮷野')).toBe(2)
  })

  it('drops exactly the characters JavaScript \\s drops', () => {
    const sql = new RegExp(SHEET_SPACE_PATTERN, 'u')
    for (let code = 0; code <= 0xffff; code += 1) {
      const character = String.fromCharCode(code)
      expect(sql.test(character), code.toString(16)).toBe(/\s/u.test(character))
    }
  })
})
