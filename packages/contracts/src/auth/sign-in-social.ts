import { z } from 'zod'
import {
  getAdminQuestionReportParamsSchema,
  listAdminQuestionReportsQuerySchema
} from '../admin/content-future.js'
import { jlptLevelSchema } from '../common/enum.js'
import { pageRequestSchema } from '../common/pagination.js'
import type { WrongNoteReviewState } from '../wrong-note/list-review-list.js'

// Contracts intentionally compile with ES-only libs. These local structural
// types describe the standard Web URL API without adding Node/DOM dependencies
// or changing global declarations; both supported browsers and Node 22 supply it.
export interface RuntimeSearchParams extends Iterable<[string, string]> {
  keys: () => IterableIterator<string>
  get: (key: string) => string | null
  getAll: (key: string) => string[]
  set: (key: string, value: string) => void
  delete: (key: string) => void
  toString: () => string
}
export interface RuntimeURL {
  origin: string
  pathname: string
  search: string
  hash: string
  username: string
  password: string
  searchParams: RuntimeSearchParams
}
const { URL, URLSearchParams } = globalThis as unknown as {
  URL: new (input: string, base?: string) => RuntimeURL
  URLSearchParams: new (input?: string) => RuntimeSearchParams
}

export const ssoProviderIdSchema = z.enum(['apple', 'google'])
export type SsoProviderId = z.output<typeof ssoProviderIdSchema>
export const ssoCallbackOutcomeSchema = z.enum([
  'CANCELLED',
  'FAILED',
  'INVALID_CALLBACK',
  // JLP-845: the account waits out its erasure grace period and can be restored.
  'RESTORE_AVAILABLE'
])

const FILTER_KEYS = new Set([
  'state',
  'level',
  'subject',
  'type',
  'status',
  'tagId',
  'difficulty',
  'mode',
  'page',
  'pageSize',
  'sort',
  'search',
  'view',
  'count',
  'resumePage',
  'questionType',
  'tag',
  'question',
  'returnTo'
])
// The wrong-note list page reads only these (JLP-812 review-list).
const REVIEW_KEYS = new Set(['state', 'level', 'page'])
/**
 * Same states and query as listReviewListQuerySchema, kept here so the login
 * chunk does not pull in the review-list contract (first-screen budget).
 * The contract test keeps the two in step.
 */
export const ssoReviewListStates = [
  'TO_REVIEW',
  'REVIEWED'
] as const satisfies readonly WrongNoteReviewState[]
const reviewListReturnQuerySchema = pageRequestSchema
  .extend({
    state: z.enum(ssoReviewListStates).default('TO_REVIEW'),
    level: jlptLevelSchema.optional()
  })
  .strict()
const BUSINESS_PATH =
  /^\/(?:$|dashboard$|bookmarks$|practice(?:\/(?:session|result)\/[A-Za-z0-9-]+)?$|wrong-notes(?:\/(?:history|[A-Za-z0-9-]+))?$|admin\/questions(?:\/[A-Za-z0-9/-]+)?$)/u
const hasControlOrSpace = (value: string): boolean =>
  [...value].some(
    (character) =>
      character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127
  )

/** A same-origin relative URL with no fragment, controls or repeated keys. */
export const relativeURL = (value: unknown): RuntimeURL | null => {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\#]/u.test(value) ||
    hasControlOrSpace(value)
  )
    return null
  try {
    const parsed = new URL(value, 'https://return.invalid')
    if (
      parsed.origin !== 'https://return.invalid' ||
      parsed.pathname !== value.split('?')[0]
    )
      return null
    const seen = new Set<string>()
    for (const key of parsed.searchParams.keys()) {
      if (seen.has(key)) return null
      seen.add(key)
    }
    return parsed
  } catch {
    return null
  }
}

/** List-only, non-nested returnTo; same shared review query semantics as the UI. */
const reviewReturnPath = (value: string): string | null => {
  const url = relativeURL(value)
  if (!url) return null
  if (url.pathname === '/dashboard' && url.search === '') return '/wrong-notes'
  if (!['/wrong-notes', '/wrong-notes/history'].includes(url.pathname))
    return null
  const params = new URLSearchParams(url.search)
  if (url.pathname === '/wrong-notes/history') {
    // Old history links: answered-right notes are now the REVIEWED list.
    if (params.get('status') === 'SOLVED') params.set('state', 'REVIEWED')
    params.delete('status')
  }
  if ([...params.keys()].some((key) => !REVIEW_KEYS.has(key))) return null
  let query = reviewListReturnQuerySchema.parse({ pageSize: 20 })
  for (const [key, value] of params) {
    const candidate = reviewListReturnQuerySchema.safeParse({
      ...query,
      [key]: value
    })
    if (candidate.success) query = candidate.data
  }
  const canonical = new URLSearchParams()
  if (query.state !== 'TO_REVIEW') canonical.set('state', query.state)
  if (query.level) canonical.set('level', query.level)
  if (query.page !== 1) canonical.set('page', String(query.page))
  const search = canonical.toString()
  return `/wrong-notes${search ? `?${search}` : ''}`
}

export const safeSsoReturnPath = (value: unknown): string => {
  const url = relativeURL(value)
  if (url?.pathname === '/admin/reports') {
    return listAdminQuestionReportsQuerySchema.safeParse(
      Object.fromEntries(url.searchParams)
    ).success
      ? url.pathname + url.search
      : '/'
  }
  if (url?.pathname.startsWith('/admin/reports/')) {
    // Report-owned drafts/list context stay out of the fresh detail callback.
    return url.search === '' &&
      getAdminQuestionReportParamsSchema.safeParse({
        reportId: url.pathname.slice('/admin/reports/'.length)
      }).success
      ? url.pathname
      : '/'
  }
  if (
    !url ||
    !BUSINESS_PATH.test(url.pathname) ||
    [...url.searchParams.keys()].some((key) => !FILTER_KEYS.has(key))
  )
    return '/'
  const nested = url.searchParams.get('returnTo')
  if (nested !== null) {
    // Only detail-to-review-list navigation has this meaning in the current UI.
    if (
      !/^\/wrong-notes\/[A-Za-z0-9-]+$/u.test(url.pathname) ||
      url.pathname === '/wrong-notes/history'
    )
      return '/'
    const normalized = reviewReturnPath(nested)
    if (normalized === null) return '/'
    url.searchParams.set('returnTo', normalized)
  }
  return url.pathname + url.search
}

const isSsoAuthorizationURL = (value: string): boolean => {
  try {
    const url = new URL(value)
    if (
      !(
        (url.origin === 'https://accounts.google.com' &&
          url.pathname === '/o/oauth2/v2/auth') ||
        (url.origin === 'https://appleid.apple.com' &&
          url.pathname === '/auth/authorize')
      ) ||
      url.username ||
      url.password ||
      url.hash
    )
      return false
    if (
      url.origin === 'https://appleid.apple.com' &&
      (url.searchParams.get('response_mode') !== 'form_post' ||
        url.searchParams.get('response_type') !== 'code')
    )
      return false
    for (const key of ['state', 'nonce', 'code_challenge']) {
      if (
        url.searchParams.getAll(key).length !== 1 ||
        !/^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get(key) ?? '')
      )
        return false
    }
    return (
      url.searchParams.getAll('code_challenge_method').length === 1 &&
      url.searchParams.get('code_challenge_method') === 'S256'
    )
  } catch {
    return false
  }
}

/** FE validates the authorization URL against the selected provider as well. */
export const isSsoAuthorizationURLForProvider = (
  provider: SsoProviderId,
  value: string
): boolean =>
  isSsoAuthorizationURL(value) &&
  new URL(value).origin ===
    (provider === 'apple'
      ? 'https://appleid.apple.com'
      : 'https://accounts.google.com')

export const signInSocialRequestSchema = z
  .object({
    provider: ssoProviderIdSchema,
    callbackURL: z.string().max(2048).transform(safeSsoReturnPath).optional()
  })
  .strict()
export const signInSocialResponseSchema = z
  .object({
    url: z.url().max(8192).refine(isSsoAuthorizationURL),
    redirect: z.literal(true)
  })
  .strict()

export type SignInSocialRequest = z.input<typeof signInSocialRequestSchema>
export type SignInSocialResponse = z.output<typeof signInSocialResponseSchema>
export type SsoCallbackOutcome = z.output<typeof ssoCallbackOutcomeSchema>
