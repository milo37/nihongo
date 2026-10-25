import { Hono } from 'hono'
import { practiceFlowConformanceFixture as practice } from '@nihongo/contracts/testing/practice-flow-conformance'
import { reviewCenterConformanceFixture as review } from '@nihongo/contracts/testing/review-center-conformance'
import { createStudySessionV2ResponseSchema } from '@nihongo/contracts/study/create-study-session'
import { saveStudyDraftAnswersResponseSchema } from '@nihongo/contracts/study/save-study-draft-answers'
import { studyResultSchema } from '@nihongo/contracts/study/study-result'
import { createBookmarkResponseSchema } from '@nihongo/contracts/bookmark/create-bookmark'
import { listReviewQueueResponseSchema } from '@nihongo/contracts/wrong-note/list-review-queue'
import { createTargetedReviewSessionResponseSchema } from '@nihongo/contracts/wrong-note/create-targeted-review-session'
import { createApiErrorHandler } from '../app/createApp.js'
import { createAdminReadGuard } from '../admin/adminReadGuard.js'
import { createAdminCommandGuard } from '../admin/adminCommandGuard.js'
import { parseApiEnvironment } from '../config/env.js'
import { requestContext } from '../middleware/requestContext.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { createWriteSecurity } from '../middleware/writeSecurity.js'
import { createJsonLogger } from '../observability/logger.js'
import { createStudySessionRoutes } from '../routes/studySessions.js'
import { createStudyDraftRoutes } from '../routes/studyDrafts.js'
import { createStudySubmissionRoutes } from '../routes/studySubmissions.js'
import { createReviewQueueRoutes } from '../routes/reviewQueue.js'
import { createTargetedReviewSessionRoutes } from '../routes/targetedReviewSessions.js'
import { createBookmarkRoutes } from '../routes/bookmarks.js'
import type { PrincipalService } from './principalService.js'
import type { GuestPrincipalService } from './guestPrincipalService.js'
import type { StudySessionService } from '../study/studySessionService.js'
import type { StudyDraftService } from '../study/studyDraftService.js'
import type { StudySubmissionService } from '../study/studySubmissionService.js'
import type { BookmarkService } from '../bookmark/bookmarkService.js'
import type { WrongNoteReviewQueueService } from '../wrong-note/wrongNoteReviewQueueService.js'
import type { WrongNoteTargetedReviewService } from '../wrong-note/wrongNoteTargetedReviewService.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { runProvisionAdminCommand } from './provisionAdminCommand.js'

const db = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  query:
    vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(),
  end: vi.fn<() => Promise<void>>(),
  construct: vi.fn()
}))
vi.mock('pg', () => ({
  Client: class {
    connect = db.connect
    query = db.query
    end = db.end
    constructor(options: unknown) {
      db.construct(options)
    }
  }
}))

const userId = '11111111-1111-4111-8111-111111111111'
const validInput = (mode = 'test'): NodeJS.ProcessEnv => {
  const test = mode === 'test'
  const database = test ? 'nihongo_test' : 'nihongo_dev'
  const schema = test ? 'phase7_bootstrap_test' : 'phase7_bootstrap_dev'
  const migration = new URL('postgresql://127.0.0.1:5432/' + database)
  migration.username = test
    ? 'nihongo_test_phase7_migration_login'
    : 'nihongo_development_phase7_migration_login'
  migration.password = 'unit-only'
  migration.searchParams.set('schema', schema)
  migration.searchParams.set('options', '-c role=nihongo_phase7_migration')
  return {
    NODE_ENV: mode,
    DEPLOYMENT_ENV: test ? 'TEST' : 'DEVELOPMENT',
    ADMIN_PROVISION_CONFIRM: 'PROVISION_FIRST_GOOGLE_ADMIN',
    ADMIN_PROVISION_USER_ID: userId,
    ADMIN_PROVISION_GOOGLE_SUBJECT: 'opaque-google-subject',
    ADMIN_PROVISION_EXPECTED_GENERATION: '7',
    PHASE7_MIGRATION_DATABASE_URL: migration.href,
    DATABASE_URL:
      'postgresql://nihongo_app:unit-only@127.0.0.1:5432/' +
      database +
      '?schema=' +
      schema,
    PRODUCTION_DATABASE_URL:
      'postgresql://runtime:unit-only@production.invalid:5432/nihongo_production?schema=public'
  }
}
const changeUrl = (source: NodeJS.ProcessEnv, change: (url: URL) => void) => {
  const url = new URL(source.PHASE7_MIGRATION_DATABASE_URL!)
  change(url)
  return { ...source, PHASE7_MIGRATION_DATABASE_URL: url.href }
}
let stdout: MockInstance<typeof process.stdout.write>
let stderr: MockInstance<typeof process.stderr.write>
const originalExit = process.exitCode
beforeEach(() => {
  vi.resetAllMocks()
  process.exitCode = undefined
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  db.connect.mockResolvedValue(undefined)
  db.end.mockResolvedValue(undefined)
  db.query.mockImplementation(async (sql) => ({
    rows: sql.startsWith('SELECT') ? [{ authorityGeneration: 8 }] : []
  }))
})
afterEach(() => {
  process.exitCode = originalExit
  vi.restoreAllMocks()
})
const expectFailure = () => {
  expect(process.exitCode).toBe(1)
  expect(stdout).not.toHaveBeenCalled()
  expect(stderr).toHaveBeenCalledExactlyOnceWith(
    '{"event":"first_google_admin_provision_failed"}\n'
  )
}

describe('first Google admin operator CLI', () => {
  it.each(['test', 'development'])(
    'uses canonical %s target and one parameterized owned transition',
    async (mode) => {
      const input = validInput(mode)
      await runProvisionAdminCommand(input)
      expect(process.exitCode).toBeUndefined()
      const options: unknown = db.construct.mock.calls[0]?.[0]
      expect(options).toEqual({
        connectionString: expect.any(String),
        connectionTimeoutMillis: 5000,
        query_timeout: 15000,
        statement_timeout: 10000,
        options:
          '-c search_path=phase7_bootstrap_' +
          (mode === 'test' ? 'test' : 'dev') +
          ' -c TimeZone=UTC -c role=nihongo_phase7_migration'
      })
      const connection = new URL(
        (options as { connectionString: string }).connectionString
      )
      expect(connection.searchParams.has('schema')).toBe(false)
      expect(connection.searchParams.has('options')).toBe(false)
      expect(db.query.mock.calls).toEqual([
        ['BEGIN ISOLATION LEVEL READ COMMITTED'],
        ["SET LOCAL lock_timeout = '5s'"],
        [
          expect.stringContaining(
            '"phase7_bootstrap_first_google_admin"($1::uuid,$2::text,$3::integer,$4::text,$5::"AdminAuditEnvironment")'
          ),
          [
            userId,
            'opaque-google-subject',
            7,
            'phase7_bootstrap_' + (mode === 'test' ? 'test' : 'dev'),
            mode === 'test' ? 'TEST' : 'DEVELOPMENT'
          ]
        ],
        ['COMMIT']
      ])
      expect(db.end).toHaveBeenCalledOnce()
      expect(stdout).toHaveBeenCalledExactlyOnceWith(
        '{"event":"first_google_admin_provisioned","authorityGeneration":8}\n'
      )
      expect(stderr).not.toHaveBeenCalled()
    }
  )

  it('binds an opaque subject without interpolation or success-log identity disclosure', async () => {
    const subject = "opaque'; SELECT private_data; --"
    await runProvisionAdminCommand({
      ...validInput(),
      ADMIN_PROVISION_GOOGLE_SUBJECT: subject
    })
    expect(process.exitCode).toBeUndefined()
    const call = db.query.mock.calls.find(([sql]) => sql.startsWith('SELECT'))
    expect(call?.[0]).not.toContain(subject)
    expect(call?.[1]?.[1]).toBe(subject)
    expect(stdout).toHaveBeenCalledExactlyOnceWith(
      '{"event":"first_google_admin_provisioned","authorityGeneration":8}\n'
    )
  })

  const rejected: [string, () => NodeJS.ProcessEnv][] = [
    ...[
      'host',
      'hostaddr',
      'port',
      'user',
      'password',
      'database',
      'dbname',
      'connectionString'
    ].map((key): [string, () => NodeJS.ProcessEnv] => [
      'connection override ' + key,
      () =>
        changeUrl(validInput(), (url) => {
          url.searchParams.set(key, 'override.invalid')
        })
    ]),
    ['production', () => ({ ...validInput(), NODE_ENV: 'production' })],
    [
      'staging deployment',
      () => ({ ...validInput(), DEPLOYMENT_ENV: 'STAGING' })
    ],
    [
      'mismatched deployment',
      () => ({ ...validInput(), DEPLOYMENT_ENV: 'DEVELOPMENT' })
    ],
    [
      'missing confirmation',
      () => ({ ...validInput(), ADMIN_PROVISION_CONFIRM: undefined })
    ],
    [
      'wrong confirmation',
      () => ({ ...validInput(), ADMIN_PROVISION_CONFIRM: 'PROVISION_ADMIN' })
    ],
    [
      'missing UUID',
      () => ({ ...validInput(), ADMIN_PROVISION_USER_ID: undefined })
    ],
    [
      'invalid UUID',
      () => ({ ...validInput(), ADMIN_PROVISION_USER_ID: 'email@example.test' })
    ],
    [
      'missing subject',
      () => ({ ...validInput(), ADMIN_PROVISION_GOOGLE_SUBJECT: undefined })
    ],
    [
      'empty subject',
      () => ({ ...validInput(), ADMIN_PROVISION_GOOGLE_SUBJECT: '' })
    ],
    [
      'subject whitespace',
      () => ({ ...validInput(), ADMIN_PROVISION_GOOGLE_SUBJECT: ' subject' })
    ],
    [
      'subject control',
      () => ({ ...validInput(), ADMIN_PROVISION_GOOGLE_SUBJECT: 'subject\n' })
    ],
    [
      'subject bound',
      () => ({
        ...validInput(),
        ADMIN_PROVISION_GOOGLE_SUBJECT: 's'.repeat(256)
      })
    ],
    ...['0', '-1', '1.1', '01', '1e2', '2147483647', '99999999999', ''].map(
      (generation): [string, () => NodeJS.ProcessEnv] => [
        'generation ' + generation,
        () => ({
          ...validInput(),
          ADMIN_PROVISION_EXPECTED_GENERATION: generation
        })
      ]
    ),
    [
      'missing production proof',
      () => ({ ...validInput(), PRODUCTION_DATABASE_URL: undefined })
    ],
    [
      'production database alias',
      () => ({
        ...validInput(),
        PRODUCTION_DATABASE_URL:
          'postgresql://other:unit-only@other.invalid:5432/nihongo_test?schema=other'
      })
    ],
    ['missing runtime', () => ({ ...validInput(), DATABASE_URL: undefined })],
    [
      'different runtime schema',
      () => ({
        ...validInput(),
        DATABASE_URL: validInput().DATABASE_URL + '_other'
      })
    ],
    [
      'wrong migration login',
      () =>
        changeUrl(validInput(), (url) => {
          url.username = 'nihongo_app'
        })
    ],
    [
      'remote test target',
      () =>
        changeUrl(validInput(), (url) => {
          url.hostname = 'remote.invalid'
        })
    ],
    [
      'wrong database suffix',
      () =>
        changeUrl(validInput(), (url) => {
          url.pathname = '/nihongo'
        })
    ],
    [
      'wrong startup role',
      () =>
        changeUrl(validInput(), (url) => {
          url.searchParams.set('options', '-c role=nihongo_phase7_owner')
        })
    ],
    [
      'duplicate startup option',
      () =>
        changeUrl(validInput(), (url) => {
          url.searchParams.append('options', '-c role=nihongo_phase7_migration')
        })
    ],
    [
      'duplicate schema',
      () =>
        changeUrl(validInput(), (url) => {
          url.searchParams.append('schema', 'phase7_bootstrap_test')
        })
    ],
    [
      'missing schema',
      () =>
        changeUrl(validInput(), (url) => {
          url.searchParams.delete('schema')
        })
    ],
    [
      'unsafe schema',
      () =>
        changeUrl(validInput(), (url) => {
          url.searchParams.set('schema', 'public,pg_temp')
        })
    ]
  ]
  it.each(rejected)(
    'rejects %s before constructing a connection',
    async (_label, input) => {
      await runProvisionAdminCommand(input())
      expectFailure()
      expect(db.construct).not.toHaveBeenCalled()
      expect(db.connect).not.toHaveBeenCalled()
    }
  )

  it.each(['connect', 'BEGIN', 'SET LOCAL', 'SELECT', 'COMMIT', 'end'])(
    'awaits closure and redacts %s failure',
    async (stage) => {
      const secret = new Error(
        'postgresql://secret:private@host/private opaque-google-subject'
      )
      if (stage === 'connect') db.connect.mockRejectedValue(secret)
      else if (stage === 'end') db.end.mockRejectedValue(secret)
      else
        db.query.mockImplementation(async (sql) => {
          if (sql.startsWith(stage)) throw secret
          return {
            rows: sql.startsWith('SELECT') ? [{ authorityGeneration: 8 }] : []
          }
        })
      await runProvisionAdminCommand(validInput())
      expectFailure()
      expect(db.end).toHaveBeenCalledOnce()
      const statements = db.query.mock.calls.map(([sql]) => sql)
      expect(statements.includes('ROLLBACK')).toBe(
        ['SET LOCAL', 'SELECT', 'COMMIT'].includes(stage)
      )
    }
  )
  it.each(
    [
      [],
      [{ authorityGeneration: 7 }],
      [{ authorityGeneration: 8 }, { authorityGeneration: 8 }]
    ].map((rows) => ({ rows }))
  )('rolls back an invalid scalar result %#', async ({ rows }) => {
    db.query.mockImplementation(async (sql) => ({
      rows: sql.startsWith('SELECT') ? rows : []
    }))
    await runProvisionAdminCommand(validInput())
    expectFailure()
    expect(db.query).toHaveBeenCalledWith('ROLLBACK')
    expect(db.query).not.toHaveBeenCalledWith('COMMIT')
  })
  it('keeps rollback failures private and still closes', async () => {
    db.query.mockRejectedValue(new Error('private database and subject'))
    // BEGIN must succeed before either SELECT or ROLLBACK fails.
    db.query.mockResolvedValueOnce({ rows: [] })
    await runProvisionAdminCommand(validInput())
    expectFailure()
    expect(db.query).toHaveBeenCalledWith('ROLLBACK')
    expect(db.end).toHaveBeenCalledOnce()
  })
  it('does not announce success until teardown has completed', async () => {
    let finish: (() => void) | undefined
    db.end.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const pending = runProvisionAdminCommand(validInput())
    await vi.waitFor(() => expect(db.end).toHaveBeenCalledOnce())
    expect(stdout).not.toHaveBeenCalled()
    finish!()
    await pending
    expect(stdout).toHaveBeenCalledOnce()
  })
})

describe('ADMIN learner access and CMS role boundaries', () => {
  const actorId = userId
  const key = '22222222-2222-4222-8222-222222222222'
  const origin = 'http://localhost:5173'
  const environment = parseApiEnvironment({
    NODE_ENV: 'test',
    ADMIN_CMS_MODE: 'technical',
    DATABASE_URL:
      'postgresql://nihongo_test_app_login:placeholder@localhost/nihongo_test?schema=public',
    AUTH_GATEWAY_DATABASE_URL:
      'postgresql://nihongo_test_auth_gateway_login:placeholder@localhost/nihongo_test?schema=public',
    TRUSTED_ORIGINS: origin,
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    GUEST_COOKIE_SECRET: 'b'.repeat(32),
    AUTH_EMAIL_FROM: 'fixture@example.test'
  })
  const session = createStudySessionV2ResponseSchema.parse(practice.session)
  const draft = saveStudyDraftAnswersResponseSchema.parse(practice.draft)
  const bookmark = createBookmarkResponseSchema.parse(practice.bookmark)
  const queue = listReviewQueueResponseSchema.parse(review.queue)
  const targeted = createTargetedReviewSessionResponseSchema.parse(
    review.targetedSession
  )
  const row = session.questions[0]
  const correctOption = row?.question.options[0]
  if (!row || !correctOption) throw new Error('Expected one-question fixture')
  const result = studyResultSchema.parse({
    sessionId: session.session.id,
    level: session.session.level,
    subject: session.session.subject,
    mode: session.session.mode,
    totalCount: 1,
    correctCount: 0,
    incorrectCount: 1,
    correctRate: 0,
    durationSec: 12,
    submittedAt: '2026-08-17T01:02:00.000Z',
    items: [
      {
        sessionQuestionId: row.sessionQuestionId,
        question: {
          ...row.question,
          correctOptionId: correctOption.id,
          explanationKo: 'Role boundary fixture explanation.',
          explanationJa: null
        },
        selectedOptionId: null,
        isCorrect: false,
        wrongNoteStatus: 'NEW'
      }
    ]
  })
  const unexpected = (): never => {
    throw new Error('Unexpected fixture port call')
  }
  const roleHarness = (role: 'ADMIN' | 'USER' | null) => {
    const user =
      role === null
        ? null
        : {
            id: actorId,
            name: 'Role fixture',
            role,
            targetLevel: 'N5' as const
          }
    const principalService = {
      getAuthenticatedUser: async () => user,
      resolveAuthenticatedUser: vi.fn(async () => ({
        clearSessionCookie: false,
        headers: new Headers(),
        user,
        ...(user
          ? {
              phase7Session: {
                id: key,
                token: 'fixture-session-token',
                createdAt: new Date('2026-08-17T01:00:00.000Z'),
                expiresAt: new Date('2026-08-18T01:00:00.000Z'),
                isFresh: true
              }
            }
          : {})
      }))
    } satisfies PrincipalService
    const guestPrincipalService = {
      clear: unexpected,
      create: unexpected,
      deleteExpired: unexpected,
      inspectCookie: vi.fn(unexpected),
      prepareCredential: vi.fn(unexpected),
      resolveExisting: unexpected
    } satisfies GuestPrincipalService
    const rateLimiter = { consume: vi.fn(async () => undefined) }
    const common = { environment, principalService, rateLimiter }
    const create = vi.fn<StudySessionService['create']>().mockResolvedValue({
      payload: session,
      practiceContractVersion: 2,
      issuedGuestCredential: null
    })
    const save = vi
      .fn<StudyDraftService['save']>()
      .mockResolvedValue({ replayed: false, response: draft })
    const submit = vi.fn<StudySubmissionService['submit']>().mockResolvedValue({
      replayed: false,
      guestProofExpiresAt: null,
      response: result
    })
    const listReviewQueue = vi
      .fn<WrongNoteReviewQueueService['listReviewQueue']>()
      .mockResolvedValue(queue)
    const createTargetedReviewSession = vi
      .fn<WrongNoteTargetedReviewService['createTargetedReviewSession']>()
      .mockResolvedValue({ replayed: false, response: targeted })
    const createBookmark = vi
      .fn<BookmarkService['create']>()
      .mockResolvedValue({ created: true, bookmark })
    const app = new Hono<{ Variables: ApiVariables }>()
    app.use('*', requestContext)
    app.use('*', async (context, next) => {
      const url = new URL(context.req.url)
      context.set('rawRequestTarget', url.pathname + url.search)
      context.set('requestStartedAt', Date.now())
      await next()
    })
    app.use('*', createWriteSecurity(environment))
    app.onError(createApiErrorHandler({ logger: createJsonLogger('silent') }))
    app.route(
      '/api/v1/study-sessions',
      createStudySessionRoutes({
        ...common,
        guestPrincipalService,
        practiceContractV2Enabled: true,
        studySessionService: { create, get: unexpected }
      })
    )
    app.route(
      '/api/v1/study-sessions',
      createStudyDraftRoutes({
        ...common,
        guestPrincipalService,
        studyDraftService: {
          save,
          get: unexpected,
          cancel: unexpected,
          listResumable: unexpected
        }
      })
    )
    app.route(
      '/api/v1/study-sessions',
      createStudySubmissionRoutes({
        ...common,
        guestPrincipalService,
        practiceContractV2Enabled: true,
        studySubmissionService: { submit, getResult: unexpected }
      })
    )
    app.route(
      '/api/v1/review-queue',
      createReviewQueueRoutes({
        ...common,
        reviewQueueService: { listReviewQueue }
      })
    )
    app.route(
      '/api/v1/wrong-notes',
      createTargetedReviewSessionRoutes({
        ...common,
        targetedReviewService: { createTargetedReviewSession }
      })
    )
    app.route(
      '/api/v1/bookmarks',
      createBookmarkRoutes({
        ...common,
        bookmarkService: {
          create: createBookmark,
          delete: unexpected,
          list: unexpected
        }
      })
    )
    const assertCapability = vi.fn(async () => undefined)
    const adminRateLimiter = { consume: vi.fn(async () => undefined) }
    const readReached = vi.fn(() => new Response(null, { status: 204 }))
    const commandReached = vi.fn(() => new Response(null, { status: 204 }))
    const adminDependencies = {
      environment,
      principalService,
      assertCapability,
      rateLimiter: adminRateLimiter
    }
    app.get(
      '/api/v1/admin/questions',
      createAdminReadGuard(adminDependencies),
      readReached
    )
    app.post(
      '/api/v1/admin/questions',
      createAdminCommandGuard(adminDependencies),
      commandReached
    )
    const request = (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Nihongo-Practice-Contract': '2',
          'Idempotency-Key': key
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    return {
      request,
      create,
      save,
      submit,
      listReviewQueue,
      createTargetedReviewSession,
      createBookmark,
      guestPrincipalService,
      assertCapability,
      adminRateLimiter,
      readReached,
      commandReached
    }
  }
  it('allows ADMIN study, saved answers, submission, review and bookmarks as authenticated user', async () => {
    const h = roleHarness('ADMIN')
    const owner = { kind: 'USER', userId: actorId }
    const base = '/api/v1/study-sessions/' + session.session.id
    const createBody = {
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    }
    const saveBody = {
      expectedRevision: 0,
      currentOrdinal: 1,
      answers: draft.answers
    }
    const submitBody = {
      answers: draft.answers,
      durationSec: 12,
      expectedDraftRevision: draft.revision
    }
    const created = await h.request(
      'POST',
      '/api/v1/study-sessions',
      createBody
    )
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual(session)
    expect(h.create).toHaveBeenCalledWith(createBody, owner, 2)
    const saved = await h.request('PUT', base + '/draft-answers', saveBody)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual(draft)
    expect(h.save).toHaveBeenCalledWith(
      session.session.id,
      key,
      saveBody,
      owner
    )
    const submitted = await h.request('POST', base + '/submission', submitBody)
    expect(submitted.status).toBe(201)
    expect(await submitted.json()).toEqual(result)
    expect(h.submit).toHaveBeenCalledWith(
      session.session.id,
      key,
      submitBody,
      owner,
      2
    )
    const reviewed = await h.request('GET', '/api/v1/review-queue')
    expect(reviewed.status).toBe(200)
    expect(await reviewed.json()).toEqual(queue)
    expect(h.listReviewQueue).toHaveBeenCalledWith(actorId, {
      page: 1,
      pageSize: 20,
      view: 'DUE',
      sort: 'NEXT_REVIEW'
    })
    const targetedReview = await h.request(
      'POST',
      '/api/v1/wrong-notes/' + review.targetedQuestionId + '/review-session',
      {}
    )
    expect(targetedReview.status).toBe(201)
    expect(await targetedReview.json()).toEqual(targeted)
    expect(h.createTargetedReviewSession).toHaveBeenCalledWith(
      actorId,
      review.targetedQuestionId,
      key
    )
    const bookmarked = await h.request(
      'PUT',
      '/api/v1/bookmarks/' + bookmark.questionId,
      {}
    )
    expect(bookmarked.status).toBe(201)
    expect(await bookmarked.json()).toEqual(bookmark)
    expect(h.createBookmark).toHaveBeenCalledWith(actorId, bookmark.questionId)
    expect(h.guestPrincipalService.inspectCookie).not.toHaveBeenCalled()
    expect(h.guestPrincipalService.prepareCredential).not.toHaveBeenCalled()
    expect((await h.request('GET', '/api/v1/admin/questions')).status).toBe(204)
    expect(
      (await h.request('POST', '/api/v1/admin/questions', {})).status
    ).toBe(204)
    expect(h.readReached).toHaveBeenCalledOnce()
    expect(h.commandReached).toHaveBeenCalledOnce()
  })
  it.each([
    ['USER', 403, 'ADMIN_REQUIRED'],
    [null, 401, 'AUTHENTICATION_REQUIRED']
  ] as const)('denies %s at both CMS guards', async (role, status, code) => {
    const h = roleHarness(role)
    for (const response of [
      await h.request('GET', '/api/v1/admin/questions'),
      await h.request('POST', '/api/v1/admin/questions', {})
    ]) {
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ code })
    }
    expect(h.readReached).not.toHaveBeenCalled()
    expect(h.commandReached).not.toHaveBeenCalled()
    expect(h.assertCapability).not.toHaveBeenCalled()
    expect(h.adminRateLimiter.consume).not.toHaveBeenCalled()
  })
})
