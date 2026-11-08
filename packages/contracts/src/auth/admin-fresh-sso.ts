import { z } from 'zod'
import { opaqueIdSchema } from '../common/id.js'
import {
  relativeURL,
  safeSsoReturnPath,
  ssoProviderIdSchema
} from './sign-in-social.js'
import type { RuntimeURL } from './sign-in-social.js'

/**
 * How long an ADMIN_FRESH sign-in keeps sensitive admin commands open,
 * measured from the new Session's creation (#683). The server computes every
 * fresh expiry from this one value; `adminFreshUntil` reports it.
 */
export const ADMIN_FRESH_WINDOW_SECONDS = 30 * 60

const QUESTION_LIST_KEYS = new Set([
  'search',
  'level',
  'subject',
  'status',
  'difficulty',
  'sort',
  'page',
  'pageSize'
])
const QUESTION_PAGE_KEYS = new Set(['returnTo'])
const QUESTION_DETAIL_KEYS = new Set(['returnTo', 'version'])
const MEMBER_LIST_KEYS = new Set(['sort', 'order', 'page', 'pageSize'])

const hasOnlyKeys = (url: RuntimeURL, allowed: ReadonlySet<string>): boolean =>
  [...url.searchParams.keys()].every((key) => allowed.has(key))
const isOpaqueId = (value: string | undefined): boolean =>
  opaqueIdSchema.safeParse(value).success

/** The admin question list, with only its own filter keys. */
const isQuestionListPath = (url: RuntimeURL): boolean =>
  url.pathname === '/admin/questions' && hasOnlyKeys(url, QUESTION_LIST_KEYS)

/** A `returnTo` on question pages may only name the question list. */
const hasQuestionListReturnTo = (url: RuntimeURL): boolean => {
  const nested = url.searchParams.get('returnTo')
  if (nested === null) return true
  const list = relativeURL(nested)
  return list !== null && isQuestionListPath(list)
}

const isQuestionPagePath = (url: RuntimeURL): boolean => {
  const [, admin, questions, id, page, ...rest] = url.pathname.split('/')
  if (admin !== 'admin' || questions !== 'questions' || rest.length > 0)
    return false
  if (id === 'new' || id === 'import')
    return page === undefined && hasOnlyKeys(url, QUESTION_PAGE_KEYS)
  if (!isOpaqueId(id)) return false
  if (page === 'edit') return hasOnlyKeys(url, QUESTION_PAGE_KEYS)
  return page === undefined && hasOnlyKeys(url, QUESTION_DETAIL_KEYS)
}

const isMemberPath = (url: RuntimeURL): boolean => {
  if (url.pathname === '/admin/members')
    return hasOnlyKeys(url, MEMBER_LIST_KEYS)
  const [, admin, members, id, ...rest] = url.pathname.split('/')
  return (
    admin === 'admin' &&
    members === 'members' &&
    rest.length === 0 &&
    isOpaqueId(id) &&
    url.search === ''
  )
}

/** Report pages keep the report query validation of the sign-in policy. */
const isReportPath = (value: string, url: RuntimeURL): boolean =>
  (url.pathname === '/admin/reports' ||
    url.pathname.startsWith('/admin/reports/')) &&
  safeSsoReturnPath(value) === value

/**
 * Where an ADMIN_FRESH sign-in may land: only the admin pages that start a
 * fresh-required command, with only their own navigation keys, so the
 * same-tab return can never carry a command or leave the admin app (#683).
 * A missing value or `/login` keeps the sign-in page; anything else lands on
 * `/`, as the sign-in policy does.
 */
export const safeAdminFreshReturnPath = (value: unknown): string => {
  if (value === undefined || value === '/login') return '/login'
  const url = relativeURL(value)
  if (url === null || typeof value !== 'string') return '/'
  const allowed =
    isQuestionListPath(url) ||
    (isQuestionPagePath(url) && hasQuestionListReturnTo(url)) ||
    isMemberPath(url) ||
    isReportPath(value, url)
  return allowed ? url.pathname + url.search : '/'
}
export const adminFreshSsoRequestSchema = z
  .object({
    purpose: z.literal('ADMIN_FRESH'),
    provider: ssoProviderIdSchema,
    callbackURL: z
      .string()
      .max(2048)
      .optional()
      .transform(safeAdminFreshReturnPath)
  })
  .strict()
export const adminFreshSsoOutcomeSchema = z.enum([
  'REAUTHENTICATED',
  'CANCELLED',
  'FAILED',
  'INVALID_CALLBACK'
])
export type AdminFreshSsoRequest = z.input<typeof adminFreshSsoRequestSchema>
export type AdminFreshSsoOutcome = z.output<typeof adminFreshSsoOutcomeSchema>
