import { describe, expect, it } from 'vitest'
import { maskMemberEmail } from './adminMemberRepository.js'

describe('maskMemberEmail', () => {
  it('keeps two local and one host character and the last suffix', () => {
    expect(maskMemberEmail('minsu1@example.com')).toBe('mi****@e******.com')
    expect(maskMemberEmail('a@b.c')).toBe('*@*.c')
    expect(maskMemberEmail('ab@mail.co.kr')).toBe('a*@m******.kr')
    expect(maskMemberEmail('한국어@도메인.한국')).toBe('한국*@도**.한국')
    expect(maskMemberEmail('nodomain')).toBe('no******@')
  })
})
