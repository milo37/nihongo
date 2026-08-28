const PHASE_7_PREFIXES = ['/api/v1/admin', '/api/v1/question-reports'] as const
const HTTP_SCHEME_PATTERN = /^https?:/iu

const getPathnameFromRequestTarget = (requestTarget: string): string | null => {
  let pathAndQuery = requestTarget

  const scheme = HTTP_SCHEME_PATTERN.exec(pathAndQuery)
  if (scheme) {
    // WHATWG special URLs treat both slash characters as authority
    // delimiters, including mixed or missing `//` spellings. Preserve the
    // raw path after that authority so dot/percent aliases cannot disappear
    // during URL canonicalization.
    let authorityStart = scheme[0].length
    while (
      pathAndQuery[authorityStart] === '/' ||
      pathAndQuery[authorityStart] === '\\'
    ) {
      authorityStart += 1
    }

    const authoritySuffix = pathAndQuery.slice(authorityStart)
    const terminatorOffset = authoritySuffix.search(/[\\/?#]/u)
    if (terminatorOffset < 0) {
      return '/'
    }
    const pathStart = authorityStart + terminatorOffset
    if (pathAndQuery[pathStart] === '?' || pathAndQuery[pathStart] === '#') {
      return '/'
    }
    pathAndQuery = pathAndQuery.slice(pathStart)
  } else if (!pathAndQuery.startsWith('/')) {
    return null
  }

  const queryStart = pathAndQuery.indexOf('?')
  const fragmentStart = pathAndQuery.indexOf('#')
  const pathnameEnd = [queryStart, fragmentStart]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), pathAndQuery.length)

  return pathAndQuery.slice(0, pathnameEnd)
}

const hasPrefix = (pathname: string): boolean =>
  PHASE_7_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )

const getSlashNormalizedPathnames = (pathname: string): readonly string[] => {
  const unresolvedSegments: string[] = []
  const resolvedSegments: string[] = []

  for (const segment of pathname.replaceAll('\\', '/').split('/')) {
    if (segment.length === 0 || segment === '.') {
      continue
    }

    const normalizedSegment = segment.toLowerCase()
    unresolvedSegments.push(normalizedSegment)
    if (normalizedSegment === '..') {
      resolvedSegments.pop()
      continue
    }
    resolvedSegments.push(normalizedSegment)
  }

  return [`/${unresolvedSegments.join('/')}`, `/${resolvedSegments.join('/')}`]
}

const hasPhase7Alias = (rawPathname: string): boolean => {
  let candidate = rawPathname

  // Every successful percent-decoding pass shortens the string. The original
  // character count therefore bounds every possible nested encoding.
  for (let pass = 0; pass <= rawPathname.length; pass += 1) {
    if (getSlashNormalizedPathnames(candidate).some(hasPrefix)) {
      return true
    }

    // Decode only ASCII percent bytes and leave malformed/unrelated UTF-8
    // escapes untouched. Every reserved Phase 7 prefix character is ASCII,
    // so a bad suffix must not hide an already-decodable protected prefix.
    const decoded = candidate.replace(
      /%([0-7][0-9a-f])/giu,
      (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))
    )
    if (decoded === candidate) {
      return false
    }
    candidate = decoded
  }

  return false
}

export const getRawRequestPathname = (requestTarget: string): string | null =>
  getPathnameFromRequestTarget(requestTarget)

export const isPhase7ExcludedRequest = (requestTarget: string): boolean => {
  const pathname = getPathnameFromRequestTarget(requestTarget)
  return pathname !== null && hasPhase7Alias(pathname)
}
