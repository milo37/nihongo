import type { Phase7Operation } from '@nihongo/contracts/admin/phase7'

const PHASE_7_PREFIXES = ['/api/v1/admin', '/api/v1/question-reports'] as const
const MAX_PERCENT_DECODING_PASSES = 16
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

const SLICE_3A_ADMIN_COMMAND_PATHS = [
  {
    method: 'POST',
    operation: 'createAdminQuestion',
    pattern: /^\/api\/v1\/admin\/questions$/u
  },
  {
    method: 'POST',
    operation: 'createAdminQuestionVersion',
    pattern: new RegExp(
      `^/api/v1/admin/questions/${CANONICAL_UUID_PATTERN}/versions$`,
      'u'
    )
  },
  {
    method: 'PATCH',
    operation: 'updateQuestionVersion',
    pattern: new RegExp(
      `^/api/v1/admin/question-versions/${CANONICAL_UUID_PATTERN}$`,
      'u'
    )
  },
  {
    method: 'POST',
    operation: 'requestContentReview',
    pattern: new RegExp(
      `^/api/v1/admin/question-versions/${CANONICAL_UUID_PATTERN}/review-request$`,
      'u'
    )
  },
  {
    method: 'POST',
    operation: 'requestQuestionChanges',
    pattern: new RegExp(
      `^/api/v1/admin/question-versions/${CANONICAL_UUID_PATTERN}/change-request$`,
      'u'
    )
  }
] as const

const SLICE_3R_A1_REAUTHENTICATION_PATHS = [
  {
    method: 'POST',
    operation: 'reauthenticateAdmin',
    pattern: /^\/api\/v1\/admin\/reauthentication$/u
  }
] as const

const SLICE_3R_A2_APPROVAL_COMMAND_PATHS = [
  {
    method: 'POST',
    operation: 'approveQuestionVersion',
    pattern: new RegExp(
      `^/api/v1/admin/question-versions/${CANONICAL_UUID_PATTERN}/approval$`,
      'u'
    )
  },
  {
    method: 'POST',
    operation: 'withdrawQuestionApproval',
    pattern: new RegExp(
      `^/api/v1/admin/question-versions/${CANONICAL_UUID_PATTERN}/approval-withdrawal$`,
      'u'
    )
  }
] as const

const ACTIVE_ADMIN_COMMAND_PATHS = [
  ...SLICE_3A_ADMIN_COMMAND_PATHS,
  ...SLICE_3R_A2_APPROVAL_COMMAND_PATHS,
  ...SLICE_3R_A1_REAUTHENTICATION_PATHS
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

  for (let pass = 0; pass < MAX_PERCENT_DECODING_PASSES; pass += 1) {
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

  // Deeply nested encodings are not valid canonical routes. Fail closed after
  // a fixed amount of linear work so they cannot turn prefix classification
  // into an attacker-controlled quadratic scan.
  return true
}

const hasRequestTargetFragment = (requestTarget: string): boolean =>
  requestTarget.includes('#')

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
  if (hasRequestTargetFragment(requestTarget)) return false
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
  if (hasRequestTargetFragment(requestTarget) || method !== 'GET') {
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

export const getCanonicalPhase7Slice3Operation = ({
  method,
  requestTarget
}: {
  method: string
  requestTarget: string
}): Phase7Operation | null => {
  if (hasRequestTargetFragment(requestTarget)) return null
  const pathname = getPathnameFromRequestTarget(requestTarget)
  if (pathname === null) return null

  return (
    ACTIVE_ADMIN_COMMAND_PATHS.find(
      (entry) => entry.method === method && entry.pattern.test(pathname)
    )?.operation ?? null
  )
}

const isCanonicalRequestForPaths = (
  input: { method: string; requestTarget: string },
  paths: readonly {
    readonly method: string
    readonly pattern: RegExp
  }[]
): boolean => {
  if (hasRequestTargetFragment(input.requestTarget)) return false
  const pathname = getPathnameFromRequestTarget(input.requestTarget)
  if (pathname === null) return false
  if (input.method === 'OPTIONS') {
    return paths.some(({ pattern }) => pattern.test(pathname))
  }
  return paths.some(
    ({ method, pattern }) => method === input.method && pattern.test(pathname)
  )
}

export const isCanonicalPhase7Slice3ACommandRequest = (input: {
  method: string
  requestTarget: string
}): boolean => isCanonicalRequestForPaths(input, SLICE_3A_ADMIN_COMMAND_PATHS)

export const isCanonicalPhase7ReauthenticationRequest = (input: {
  method: string
  requestTarget: string
}): boolean =>
  isCanonicalRequestForPaths(input, SLICE_3R_A1_REAUTHENTICATION_PATHS)

export const isCanonicalPhase7ApprovalCommandRequest = (input: {
  method: string
  requestTarget: string
}): boolean =>
  isCanonicalRequestForPaths(input, SLICE_3R_A2_APPROVAL_COMMAND_PATHS)

export const getCanonicalPhase7ActiveOperation = (input: {
  method: string
  requestTarget: string
}): Phase7Operation | null =>
  getCanonicalPhase7Slice2ReadOperation(input) ??
  getCanonicalPhase7Slice3Operation(input)

export const isCanonicalPhase7ActiveRequest = ({
  method,
  requestTarget
}: {
  method: string
  requestTarget: string
}): boolean => {
  if (hasRequestTargetFragment(requestTarget)) return false
  const pathname = getPathnameFromRequestTarget(requestTarget)
  if (pathname === null) return false
  if (method === 'OPTIONS') {
    return (
      SLICE_2_ADMIN_READ_PATHS.some(({ pattern }) => pattern.test(pathname)) ||
      ACTIVE_ADMIN_COMMAND_PATHS.some(({ pattern }) => pattern.test(pathname))
    )
  }
  return getCanonicalPhase7ActiveOperation({ method, requestTarget }) !== null
}
