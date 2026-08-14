const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const UINT64_MASK = 0xffffffffffffffffn

const hash64 = (value: string): string => {
  let hash = FNV_OFFSET_BASIS

  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = (hash * FNV_PRIME) & UINT64_MASK
  }

  return hash.toString(16).padStart(16, '0')
}

export const toStableSeedUuid = (namespace: string, value: string): string => {
  const hexadecimal = `${hash64(`${namespace}:${value}`)}${hash64(
    `${value}:${namespace}`
  )}`

  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    `4${hexadecimal.slice(13, 16)}`,
    `8${hexadecimal.slice(17, 20)}`,
    hexadecimal.slice(20, 32)
  ].join('-')
}
