/**
 * One masked line per failed test for the CI log (CCD-664). Vitest failure
 * text can echo request bodies, tokens or connection strings, so only the
 * first line of the first failure is kept, every environment value and every
 * secret-shaped value is masked, and the result is cut to 200 characters.
 */
export const FAILURE_SUMMARY_MAX_LENGTH = 200

const MINIMUM_MASKED_ENVIRONMENT_VALUE_LENGTH = 6
const PERCENT_DECODE_ROUNDS = 3

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

// Order matters: whole URLs and assignments go before their inner parts.
const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/[a-z][a-z0-9+.-]*:\/\/\S+/giu, '<url>'],
  // user:pass@host without a scheme.
  [/[^\s:@/]+:[^\s@/]+@[^\s/]+/gu, '<url>'],
  [/\b(?:bearer|basic)\s+\S+/giu, '<credential>'],
  // A secret value may hold spaces, so everything after the key goes.
  [
    /\b[\w-]*(?:password|passwd|secret|token|cookie|authorization|digest|key|credential)[\w-]*["']?\s*[:=].*$/giu,
    '<secret>'
  ],
  [/\b[A-Z][A-Z0-9_]{2,}=\S+/gu, '<env>'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '<email>'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/gu, '<token>'],
  [/\b[0-9a-f]{16,}\b/giu, '<hex>']
]

// UUIDs (lower-case hex) and paths stay readable: a base64 secret mixes
// upper case, lower case and digits.
const BASE64_RUN = /[A-Za-z0-9+/_-]{20,}={0,2}/gu
const looksLikeBase64Secret = (run: string) =>
  /[A-Z]/u.test(run) && /[a-z]/u.test(run) && /[0-9]/u.test(run)

const stripAnsi = (value: string) =>
  // eslint-disable-next-line no-control-regex
  value.replace(/\u001b\[[0-9;]*[A-Za-z]/gu, '')

// Zero-width and other invisible format characters could split a secret.
const stripInvisible = (value: string) => value.replace(/\p{Cf}/gu, '')

const decodePercentRun = (run: string) => {
  try {
    return decodeURIComponent(run)
  } catch {
    return run
  }
}
// Percent-encoded secrets are checked in plain form, nested encodings too.
const percentDecode = (value: string) => {
  let decoded = value
  for (let round = 0; round < PERCENT_DECODE_ROUNDS; round += 1) {
    const next = decoded.replace(/(?:%[0-9a-f]{2})+/giu, decodePercentRun)
    if (next === decoded) break
    decoded = next
  }
  return decoded
}

const maskEnvironmentValues = (
  value: string,
  environmentValues: readonly string[]
) =>
  environmentValues.reduce(
    (masked, secret) =>
      masked.replace(new RegExp(escapeRegExp(secret), 'gu'), '<env>'),
    value
  )

export const summarizeFailureMessage = (
  message: string | undefined,
  environment: NodeJS.ProcessEnv
): string => {
  const firstLine =
    stripInvisible(stripAnsi(message ?? ''))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  if (firstLine.length === 0) return 'no failure message'
  // Longest first so a value that contains another is masked whole.
  const environmentValues = [
    ...new Set(
      Object.values(environment)
        .filter((value): value is string => typeof value === 'string')
        .flatMap((value) => [value, percentDecode(value)])
    )
  ]
    .filter((value) => value.length >= MINIMUM_MASKED_ENVIRONMENT_VALUE_LENGTH)
    .toSorted((left, right) => right.length - left.length)
  let masked = maskEnvironmentValues(
    percentDecode(maskEnvironmentValues(firstLine, environmentValues)),
    environmentValues
  )
  for (const [pattern, replacement] of SECRET_PATTERNS)
    masked = masked.replace(pattern, replacement)
  masked = masked.replace(BASE64_RUN, (run) =>
    looksLikeBase64Secret(run) ? '<base64>' : run
  )
  return masked.length > FAILURE_SUMMARY_MAX_LENGTH
    ? `${masked.slice(0, FAILURE_SUMMARY_MAX_LENGTH - 1)}…`
    : masked
}
