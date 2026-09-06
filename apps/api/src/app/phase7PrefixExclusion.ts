import type { Phase7Operation } from '@nihongo/contracts/admin/phase7'

const PHASE_7_PREFIXES = ['/api/v1/admin', '/api/v1/question-reports'] as const
const HTTP_SCHEME_PATTERN = /^https?:/iu
const CANONICAL_UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const SLICE_2_ADMIN_READ_PATHS = [
  {
    operation: 'listAdminQuestions',
    pattern: /^\/api\/v1\/admin\/questions$/u
  },
  {
    operation: 'getAdminQuestion',
    pattern: new RegExp(
      `^/api/v1/admin/questions/${CANONICAL_UUID_PATTERN}$`,
      'u'
    )
  },
  {
    operation: 'listAdminQuestionVersions',
    pattern: new RegExp(
      `^/api/v1/admin/questions/${CANONICAL_UUID_PATTERN}/versions$`,
      'u'
    )
  },
  {
    operation: 'listAdminTags',
    pattern: /^\/api\/v1\/admin\/tags$/u
  },
  {
    operation: 'previewQuestionVersion',
    pattern: new RegExp(
      `^/api/v1/admin/question-versions/${CANONICAL_UUID_PATTERN}/preview$`,
      'u'
    )
  },
  {
    operation: 'diffQuestionVersion',
    pattern: new RegExp(
      `^/api/v1/admin/question-versions/${CANONICAL_UUID_PATTERN}/diff$`,
      'u'
    )
  },
  {
    operation: 'listQuestionVersionReviews',
    pattern: new RegExp(
      `^/api/v1/admin/question-versions/${CANONICAL_UUID_PATTERN}/reviews$`,
      'u'
    )
  },
  {
    operation: 'listAdminAuditLog',
    pattern: /^\/api\/v1\/admin\/audit-log$/u
  }
] as const

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

export const isCanonicalPhase7Slice2ReadRequest = ({
  method,
  requestTarget
}: {
  method: string
  requestTarget: string
}): boolean => {
  if (method !== 'GET' && method !== 'OPTIONS') {
    return false
  }

  const pathname = getPathnameFromRequestTarget(requestTarget)
  return (
    pathname !== null &&
    SLICE_2_ADMIN_READ_PATHS.some(({ pattern }) => pattern.test(pathname))
  )
}

export const getCanonicalPhase7Slice2ReadOperation = ({
  method,
  requestTarget
}: {
  method: string
  requestTarget: string
}): Phase7Operation | null => {
  if (method !== 'GET') {
    return null
  }
  const pathname = getPathnameFromRequestTarget(requestTarget)
  if (pathname === null) {
    return null
  }
  return (
    SLICE_2_ADMIN_READ_PATHS.find(({ pattern }) => pattern.test(pathname))
      ?.operation ?? null
  )
}
