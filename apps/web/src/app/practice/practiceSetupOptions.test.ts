import {
  fitMemberCount,
  getMemberCountChoices
} from '@app/practice/practiceSetupOptions'

describe('member set sizes per subject (#1244)', () => {
  it('reading offers 5 and 10; the others keep 5, 10 and 20', () => {
    expect(getMemberCountChoices('READING')).toEqual([5, 10])
    expect(getMemberCountChoices('VOCABULARY')).toEqual([5, 10, 20])
    expect(getMemberCountChoices('GRAMMAR')).toEqual([5, 10, 20])
  })

  it('an old reading set of 20 is followed by 10; other sizes keep or fall back', () => {
    expect(fitMemberCount('READING', 20)).toBe(10)
    expect(fitMemberCount('READING', 10)).toBe(10)
    expect(fitMemberCount('READING', 3)).toBe(5)
    expect(fitMemberCount('GRAMMAR', 20)).toBe(20)
    expect(fitMemberCount('GRAMMAR', 3)).toBe(10)
  })
})
