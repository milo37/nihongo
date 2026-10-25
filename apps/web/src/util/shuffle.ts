export type ShuffleSeed = number | string

const hashStringSeed = (seed: string): number => {
  let hash = 2166136261

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

const normalizeSeed = (seed: ShuffleSeed): number => {
  if (typeof seed === 'string') {
    return hashStringSeed(seed)
  }

  return Math.trunc(seed) >>> 0
}

export const createSeededRandom = (seed: ShuffleSeed): (() => number) => {
  let state = normalizeSeed(seed)

  return (): number => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export const seededShuffle = <Item>(
  source: readonly Item[],
  seed: ShuffleSeed
): Item[] => {
  const result = [...source]
  const random = createSeededRandom(seed)

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = result[index]
    result[index] = result[swapIndex]
    result[swapIndex] = current
  }

  return result
}
