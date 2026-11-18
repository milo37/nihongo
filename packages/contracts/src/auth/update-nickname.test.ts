import { describe, expect, it } from 'vitest'
import {
  defaultNickname,
  nicknameSchema,
  updateNicknameBodySchema,
  updateNicknameResponseSchema
} from './update-nickname.js'

describe('nickname contract (#1096)', () => {
  it('trims the ends and keeps 2 to 12 characters', () => {
    expect(nicknameSchema.parse('  하루 마루  ')).toBe('하루 마루')
    expect(nicknameSchema.parse('ab')).toBe('ab')
    expect(nicknameSchema.parse('あ'.repeat(12))).toBe('あ'.repeat(12))
    // A surrogate pair is one character.
    expect(nicknameSchema.parse('𠮷'.repeat(12))).toBe('𠮷'.repeat(12))
    for (const value of [
      '',
      ' ',
      '하',
      ' 하 ',
      'あ'.repeat(13),
      '하\n루',
      '하\t루'
    ])
      expect(nicknameSchema.safeParse(value).success, value).toBe(false)
  })

  it('prefills the first 12 characters, or empty under 2', () => {
    expect(defaultNickname('  Haru Maru  ')).toBe('Haru Maru')
    expect(defaultNickname('Alexander Hamilton')).toBe('Alexander Ha')
    // A cut that ends on a space is trimmed again.
    expect(defaultNickname('Alexander   Hamilton')).toBe('Alexander')
    expect(defaultNickname('김')).toBe('')
    expect(defaultNickname('   ')).toBe('')
  })

  it('takes and answers exactly one nickname', () => {
    expect(updateNicknameBodySchema.parse({ nickname: ' 마루 ' })).toEqual({
      nickname: '마루'
    })
    expect(
      updateNicknameBodySchema.safeParse({ nickname: '마루', name: 'x' })
        .success
    ).toBe(false)
    expect(updateNicknameResponseSchema.parse({ nickname: '마루' })).toEqual({
      nickname: '마루'
    })
  })
})
