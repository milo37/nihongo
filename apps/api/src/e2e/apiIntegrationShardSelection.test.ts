import { describe, expect, it } from 'vitest'
import { getApiIntegrationEntriesByOwner } from './apiIntegrationManifest.js'
import {
  assertApiIntegrationShardPartition,
  readShardSelectionArgument,
  selectApiIntegrationShards
} from './apiIntegrationShardSelection.js'

const manifestShards = [
  ...new Set(getApiIntegrationEntriesByOwner('shard').map(({ shard }) => shard))
]

describe('API integration shard selection', () => {
  it('reads no selection when the option is absent', () => {
    expect(readShardSelectionArgument(['node', 'run', '--shard=x'])).toBe(
      undefined
    )
  })

  it('reads a comma separated selection once', () => {
    expect(readShardSelectionArgument(['--shards=a,b'])).toEqual(['a', 'b'])
    expect(() =>
      readShardSelectionArgument(['--shards=a', '--shards=b'])
    ).toThrow('more than once')
  })

  it('keeps every shard in manifest order without a selection', () => {
    expect(selectApiIntegrationShards(manifestShards, undefined)).toBe(
      manifestShards
    )
  })

  it('returns a selection in manifest order', () => {
    const [first, second] = manifestShards
    expect(
      selectApiIntegrationShards(manifestShards, [second!, first!])
    ).toEqual([first, second])
  })

  it.each([
    [[], 'empty'],
    [[''], 'empty'],
    [['pure', 'pure'], 'duplicates'],
    [['not-a-shard'], 'Unknown']
  ])('rejects selection %j', (requested, message) => {
    expect(() => selectApiIntegrationShards(manifestShards, requested)).toThrow(
      message
    )
  })
})

describe('API integration shard partition', () => {
  it('accepts groups whose union is every manifest shard exactly once', () => {
    const middle = Math.ceil(manifestShards.length / 2)
    expect(manifestShards.length).toBeGreaterThan(1)
    expect(() =>
      assertApiIntegrationShardPartition(manifestShards, [
        manifestShards.slice(0, middle),
        manifestShards.slice(middle)
      ])
    ).not.toThrow()
  })

  it('rejects groups that miss a shard', () => {
    expect(() =>
      assertApiIntegrationShardPartition(manifestShards, [
        manifestShards.slice(1)
      ])
    ).toThrow('miss shards')
  })

  it('rejects a shard placed in two groups', () => {
    expect(() =>
      assertApiIntegrationShardPartition(manifestShards, [
        manifestShards,
        manifestShards.slice(0, 1)
      ])
    ).toThrow('two groups')
  })
})
