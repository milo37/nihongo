import { EXPRESSIONS, FORTUNES } from '@app/account/omikuji/omikujiData'
import type { OmikujiFortune } from '@app/account/omikuji/omikujiData'

/** Today in Asia/Seoul as YYYY-MM-DD, the stamp board's day (K-2). */
export const seoulToday = (now = new Date()): string =>
  now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })

// FNV-1a, then murmur3's finaliser so neighbouring ids spread out; 0 to <1.
const unit = (text: string): number => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return (hash >>> 0) / 2 ** 32
}

export type OmikujiPick = {
  fortune: OmikujiFortune
  messageIndex: number
  expressionIndex: number
}

/**
 * #1055: the same member on the same Seoul day always gets the same slip, on
 * any device. The fortune follows the weights; the message comes from that
 * fortune's list and the expression from the whole list, each by its own seed.
 */
export const pickOmikuji = (userId: string, seoulDate: string): OmikujiPick => {
  const seed = `${userId}|${seoulDate}`
  let roll = unit(`${seed}|fortune`) * 100
  const fortune =
    FORTUNES.find(({ weight }) => (roll -= weight) < 0) ?? FORTUNES.at(-1)!
  return {
    fortune,
    messageIndex: Math.floor(unit(`${seed}|message`) * fortune.messages.length),
    expressionIndex: Math.floor(unit(`${seed}|expression`) * EXPRESSIONS.length)
  }
}
