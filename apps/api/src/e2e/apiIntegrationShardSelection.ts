const SHARDS_ARGUMENT_PREFIX = '--shards='

export const readShardSelectionArgument = (
  argv: readonly string[]
): readonly string[] | undefined => {
  const matches = argv.filter((argument) =>
    argument.startsWith(SHARDS_ARGUMENT_PREFIX)
  )
  if (matches.length > 1) {
    throw new Error('API integration shard selection was given more than once.')
  }
  const [argument] = matches
  if (argument === undefined) return undefined
  return argument.slice(SHARDS_ARGUMENT_PREFIX.length).split(',')
}

// Keeps manifest order so a selected run is a subsequence of the full run.
export const selectApiIntegrationShards = (
  allShards: readonly string[],
  requested: readonly string[] | undefined
): readonly string[] => {
  if (requested === undefined) return allShards
  if (requested.length === 0 || requested.some((shard) => shard === '')) {
    throw new Error('API integration shard selection is empty.')
  }
  const requestedSet = new Set(requested)
  if (requestedSet.size !== requested.length) {
    throw new Error('API integration shard selection has duplicates.')
  }
  const unknown = requested.filter((shard) => !allShards.includes(shard))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown API integration shard selection: ${unknown.join(', ')}.`
    )
  }
  return allShards.filter((shard) => requestedSet.has(shard))
}

// A CI split must run every shard exactly once across its groups.
export const assertApiIntegrationShardPartition = (
  allShards: readonly string[],
  groups: readonly (readonly string[])[]
): void => {
  const seen = new Set<string>()
  for (const group of groups) {
    for (const shard of selectApiIntegrationShards(allShards, group)) {
      if (seen.has(shard)) {
        throw new Error(`API integration shard is in two groups: ${shard}.`)
      }
      seen.add(shard)
    }
  }
  const missing = allShards.filter((shard) => !seen.has(shard))
  if (missing.length > 0) {
    throw new Error(
      `API integration shard groups miss shards: ${missing.join(', ')}.`
    )
  }
}
