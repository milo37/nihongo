import { BlockList, isIP } from 'node:net'

const INTERNAL_CLIENT_IP_HEADER = 'x-nihongo-client-ip'

const normalizeAddress = (address: string): string => {
  const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu)?.[1]
  return mappedIpv4 ?? address
}

const createTrustedProxyList = (entries: readonly string[]): BlockList => {
  const blockList = new BlockList()
  for (const entry of entries) {
    const [address = '', prefix] = entry.split('/')
    const family = isIP(address)
    const type = family === 4 ? 'ipv4' : 'ipv6'
    blockList.addSubnet(
      address,
      prefix === undefined ? (family === 4 ? 32 : 128) : Number(prefix),
      type
    )
  }
  return blockList
}

export interface ClientIpAuthority {
  apply: (request: Request, peerAddress?: string) => Request
  resolve: (
    peerAddress: string | undefined,
    forwardedFor: string | null
  ) => string
}

export const createClientIpAuthority = (
  trustedProxyCidrs: readonly string[]
): ClientIpAuthority => {
  const trustedProxies = createTrustedProxyList(trustedProxyCidrs)
  const isTrusted = (address: string): boolean => {
    const normalized = normalizeAddress(address)
    const family = isIP(normalized)
    return (
      family !== 0 &&
      trustedProxies.check(normalized, family === 4 ? 'ipv4' : 'ipv6')
    )
  }

  const resolve = (
    peerAddress: string | undefined,
    forwardedFor: string | null
  ): string => {
    if (!peerAddress) {
      return 'unresolved'
    }

    const peer = normalizeAddress(peerAddress)
    if (isIP(peer) === 0 || !isTrusted(peer) || !forwardedFor) {
      return isIP(peer) === 0 ? 'unresolved' : peer
    }

    let current = peer
    for (const rawCandidate of forwardedFor.split(',').toReversed()) {
      if (!isTrusted(current)) {
        return current
      }
      const candidate = normalizeAddress(rawCandidate.trim())
      if (isIP(candidate) === 0) {
        return peer
      }
      current = candidate
    }

    return isTrusted(current) ? peer : current
  }

  return {
    apply: (request, peerAddress) => {
      const headers = new Headers(request.headers)
      headers.delete(INTERNAL_CLIENT_IP_HEADER)
      headers.set(
        INTERNAL_CLIENT_IP_HEADER,
        resolve(peerAddress, headers.get('X-Forwarded-For'))
      )
      return new Request(request, { headers })
    },
    resolve
  }
}

export { INTERNAL_CLIENT_IP_HEADER }
