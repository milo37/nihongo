/**
 * One masked line per failed test for the CI log (CCD-664). Vitest failure
 * text can echo request bodies, tokens or connection strings, so only the
 * first line of the first failure is kept, every environment value and every
 * secret-shaped value is masked, and the result is cut to 200 characters.
 */
export const FAILURE_SUMMARY_MAX_LENGTH = 200

const MINIMUM_MASKED_ENVIRONMENT_VALUE_LENGTH = 6

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

// Order matters: whole URLs and assignments go before their inner parts.
const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/[a-z][a-z0-9+.-]*:\/\/\S+/giu, '<url>'],
  [/\b(?:bearer|basic)\s+\S+/giu, '<credential>'],
  [
    /\b[\w-]*(?:password|secret|token|cookie|authorization|digest)[\w-]*["']?\s*[:=]\s*\S+/giu,
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

export const summarizeFailureMessage = (
  message: string | undefined,
  environment: NodeJS.ProcessEnv
): string => {
  const firstLine =
    stripAnsi(message ?? '')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  if (firstLine.length === 0) return 'no failure message'
  // Longest first so a value that contains another is masked whole.
  const environmentValues = Object.values(environment)
    .filter(
      (value): value is string =>
        typeof value === 'string' &&
        value.length >= MINIMUM_MASKED_ENVIRONMENT_VALUE_LENGTH
    )
    .toSorted((left, right) => right.length - left.length)
  let masked = firstLine
  for (const value of environmentValues)
    masked = masked.replace(new RegExp(escapeRegExp(value), 'gu'), '<env>')
  for (const [pattern, replacement] of SECRET_PATTERNS)
    masked = masked.replace(pattern, replacement)
  masked = masked.replace(BASE64_RUN, (run) =>
    looksLikeBase64Secret(run) ? '<base64>' : run
  )
  return masked.length > FAILURE_SUMMARY_MAX_LENGTH
    ? `${masked.slice(0, FAILURE_SUMMARY_MAX_LENGTH - 1)}…`
    : masked
}
