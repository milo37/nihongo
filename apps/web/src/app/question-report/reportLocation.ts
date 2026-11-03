import { getRouteLabelKey } from '@nihongo/browser/i18n/routePresentation'

// Fixed learner screen keys; locations never carry IDs or query strings.
export const reportScreenKeys = [
  'home',
  'login',
  'dashboard',
  'practiceSetup',
  'practiceSession',
  'result',
  'wrongNoteCenter',
  'wrongNoteDetail',
  'bookmarks',
  'legal',
  'accountData',
  'support',
  'forbidden',
  'page'
] as const

export type ReportScreenKey = (typeof reportScreenKeys)[number]

const isReportScreenKey = (value: string): value is ReportScreenKey =>
  (reportScreenKeys as readonly string[]).includes(value)

export const toReportScreenKey = (pathname: string): ReportScreenKey => {
  const key = getRouteLabelKey(pathname).slice('routes.'.length)
  return isReportScreenKey(key) ? key : 'page'
}

export const toQuestionReportLocation = (
  screen: ReportScreenKey,
  ordinal: number
): string => `${screen}#${ordinal}`
