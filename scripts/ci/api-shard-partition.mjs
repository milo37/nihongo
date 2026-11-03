// Run with tsx from apps/api: fails CI when the matrix groups drift from the manifest.
import { getApiIntegrationEntriesByOwner } from '../../apps/api/src/e2e/apiIntegrationManifest.ts'
import { assertApiIntegrationShardPartition } from '../../apps/api/src/e2e/apiIntegrationShardSelection.ts'
import { apiIntegrationShardGroups } from './check-selection.mjs'

const allShards = [
  ...new Set(
    getApiIntegrationEntriesByOwner('phase10').map(({ shard }) => shard)
  )
]
assertApiIntegrationShardPartition(
  allShards,
  Object.values(apiIntegrationShardGroups)
)
process.stdout.write(
  `API integration shard partition ok: ${allShards.length} shards in ${Object.keys(apiIntegrationShardGroups).length} groups.\n`
)
