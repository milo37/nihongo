import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const analyticsEvents = [
  'bookmark_created',
  'login',
  'practice_configured',
  'question_answered',
  'question_reported',
  'review_started',
  'review_submitted',
  'sign_up',
  'study_started',
  'study_submitted',
  'wrong_note_opened'
]

test('analytics contract has exactly the approved coarse event names', () => {
  const source = read('packages/contracts/src/analytics/events.ts')
  const names = Array.from(
    source.matchAll(/event:\s*z\.literal\('([^']+)'\)/gu),
    (match) => match[1]
  ).toSorted()

  assert.deepEqual(names, analyticsEvents)
})

test('all analytics events are wired at authoritative learner boundaries', () => {
  const boundarySources = {
    bookmark_created: read(
      'apps/web/src/app/bookmark/hooks/useCreateBookmark.ts'
    ),
    login: read('apps/web/src/app/login/hooks/useSignInUser.ts'),
    practice_configured: read(
      'apps/web/src/app/practice/hooks/useCreateStudySession.ts'
    ),
    question_answered: read('apps/web/src/app/practice/session/page.tsx'),
    question_reported: read(
      'apps/web/src/app/question-report/hooks/useCreatePhase7QuestionReport.ts'
    ),
    review_started: [
      read('apps/web/src/app/practice/hooks/useCreateStudySession.ts'),
      read('apps/web/src/app/practice/hooks/useCreateResultRetrySession.ts'),
      read(
        'apps/web/src/app/wrong-note/hooks/useCreateTargetedReviewSession.ts'
      )
    ].join('\n'),
    review_submitted: read('apps/web/src/analytics/studyEvents.ts'),
    sign_up: read('apps/web/src/app/login/hooks/useSignUpUser.ts'),
    study_started: [
      read('apps/web/src/app/practice/hooks/useCreateStudySession.ts'),
      read('apps/web/src/app/practice/hooks/useCreateResultRetrySession.ts'),
      read(
        'apps/web/src/app/wrong-note/hooks/useCreateTargetedReviewSession.ts'
      )
    ].join('\n'),
    study_submitted: read('apps/web/src/analytics/studyEvents.ts'),
    wrong_note_opened: read('apps/web/src/analytics/client.ts')
  }

  for (const event of analyticsEvents) {
    assert.match(boundarySources[event], new RegExp(`event: '${event}'`, 'u'))
  }

  assert.match(boundarySources.bookmark_created, /response\.status === 201/u)
  assert.match(boundarySources.login, /if \(refresh\.applied\)/u)
  assert.match(boundarySources.question_answered, /if \(isFirstAnswer\)/u)
  assert.match(boundarySources.review_started, /status === 'IN_PROGRESS'/u)
  assert.match(boundarySources.wrong_note_opened, /routeInstanceKey/u)
})

test('provider-disabled analytics and frontend error reporting have zero fallback transport', () => {
  const sources = [
    read('apps/web/src/analytics/client.ts'),
    read('apps/web/src/observability/frontendErrorReporter.ts')
  ].join('\n')

  assert.equal(
    (sources.match(/if \(!transport\) return false/gu) ?? []).length,
    2
  )
  for (const forbidden of [
    'fetch(',
    'localStorage',
    'sessionStorage',
    'sendBeacon',
    'console.'
  ]) {
    assert.equal(sources.includes(forbidden), false, forbidden)
  }
})

test('public KO/JA operations foundation exposes all seven truthful surfaces', () => {
  const router = read('apps/web/src/app/operations/router.tsx')
  const page = read('apps/web/src/app/operations/page.tsx')
  const layout = read('apps/web/src/app/layout.tsx')
  const footer = read('apps/web/src/common/components/InformationFooter.tsx')
  const ko = read('apps/web/src/i18n/resources/ko.ts')
  const ja = read('apps/web/src/i18n/resources/ja.ts')
  const destinations = [
    '/legal#terms',
    '/legal#privacy',
    '/legal#copyright',
    '/account/data#deletion',
    '/account/data#data-export',
    '/support#question-report',
    '/support#contact'
  ]
  const footerDestinations = Array.from(
    footer.matchAll(/\bto:\s*'([^']+)'/gu),
    (match) => match[1]
  )

  for (const path of ['legal', 'account/data', 'support']) {
    assert.match(router, new RegExp(`path: '${path.replace('/', '\\/')}'`, 'u'))
  }
  assert.match(
    layout,
    /import\s+\{\s*InformationFooter\s*\}\s+from\s+'@common\/components\/InformationFooter'/u
  )
  assert.match(layout, /<InformationFooter\b[^>]*\/>/u)
  assert.match(footer, /groups\.map\(/u)
  assert.match(footer, /group\.map\(\(\{\s*to,\s*key\s*\}\)\s*=>/u)
  assert.match(footer, /<Link\s+to=\{to\}/u)
  assert.deepEqual(footerDestinations.toSorted(), destinations.toSorted())
  for (const destination of destinations) {
    const anchor = destination.slice(destination.indexOf('#'))
    assert.equal(page.includes(destination), true, destination)
    assert.equal(page.includes(anchor), true, anchor)
  }
  assert.match(ko, /미정:/u)
  assert.match(ja, /未定:/u)
  assert.doesNotMatch(ko, /mailto:/u)
  assert.doesNotMatch(ja, /mailto:/u)
})
