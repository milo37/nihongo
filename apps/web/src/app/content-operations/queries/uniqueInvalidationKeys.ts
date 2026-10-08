import type { QueryKey } from '@tanstack/react-query'

export const uniqueKeys = (keys: readonly QueryKey[]): QueryKey[] => {
  const seen = new Set<string>()
  return keys.filter((key) => {
    const encoded = JSON.stringify(key)
    if (seen.has(encoded)) return false
    seen.add(encoded)
    return true
  })
}
