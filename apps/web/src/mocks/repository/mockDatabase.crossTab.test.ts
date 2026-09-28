import type {
  CreateAdminQuestionRequest,
  UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { describe, expect, it } from 'vitest'
import {
  MOCK_DATABASE_STORAGE_KEY,
  PHASE7_ADMIN_CMS_STORAGE_KEY
} from '@libs/storage'
import { mockSeedData } from '@mocks/data'
import {
  DEMO_ADMIN_ID,
  DEMO_REVIEWER_ADMIN_ID,
  DEMO_USER_ID
} from '@mocks/data/users'
import { getPhase7QuestionContractIdentity } from '@mocks/adapters/questionContractAdapter'
import { MockDatabase, type MockStorage } from '@mocks/repository/mockDatabase'
import { createInMemoryPhase7MutationLease } from '@mocks/repository/phase7MutationCoordinator'

const seedQuestion = mockSeedData.questions[0]
if (!seedQuestion) throw new Error('Cross-tab seed question is unavailable.')

const createStorage = (): MockStorage => {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    getLatestItem: (key) => values.get(key) ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value)
  }
}

const createContent = (suffix = 'draft'): CreateAdminQuestionRequest => {
  const correctIndex = seedQuestion.options.findIndex(
    (option) => option.isCorrect
  )
  if (correctIndex < 0) throw new Error('Seed answer is unavailable.')
  return {
    level: seedQuestion.level,
    subject: seedQuestion.subject,
    questionType: seedQuestion.questionType,
    difficulty: seedQuestion.difficulty,
    questionText: `${seedQuestion.questionText} cross-tab ${suffix}`,
    passage: seedQuestion.passage,
    explanationKo: seedQuestion.explanationKo,
    explanationJa: seedQuestion.explanationJa,
    tagNames: seedQuestion.tags,
    options: seedQuestion.options.map((option, index) => ({
      clientOptionKey: `option-${index + 1}`,
      text: option.text
    })),
    correctOptionKey: `option-${correctIndex + 1}`
  }
}

describe('Phase 7 canonical mock cross-tab mutation lease', () => {
  it('allows one same-rowVersion PATCH winner and preserves it without audit loss', async () => {
    const storage = createStorage()
    const mutationLease = createInMemoryPhase7MutationLease()
    const options = {
      listenToStorage: false,
      mutationLease,
      now: () => '2026-09-28T00:00:00.000Z',
      storage
    } as const
    const first = new MockDatabase(options)
    first.loginAs('ADMIN', DEMO_ADMIN_ID)
    const firstState = first.getPhase7AdminCmsStateForHandlers()
    const created = await firstState.createQuestion({
      actorId: DEMO_ADMIN_ID,
      assertAuthority: () =>
        first.assertPhase7AdminCommandAuthority({
          actorId: DEMO_ADMIN_ID,
          requiresFresh: false
        }),
      request: createContent(),
      requestId: crypto.randomUUID(),
      sources: first.listCanonicalAdminQuestionSources()
    })
    if (!created.questionVersionId || !created.versionRowVersion) {
      throw new Error('Cross-tab draft was not created.')
    }

    const second = new MockDatabase(options)
    second.loginAs('ADMIN', DEMO_ADMIN_ID)
    const secondState = second.getPhase7AdminCmsStateForHandlers()
    const persistedVersion = second
      .getCanonicalAdminCmsSnapshot()
      .versions.find(
        (version) => version.questionVersionId === created.questionVersionId
      )
    if (!persistedVersion) throw new Error('Cross-tab version is unavailable.')
    const baseRequest: UpdateQuestionVersionRequest = {
      level: persistedVersion.level,
      subject: persistedVersion.subject,
      questionType: persistedVersion.questionType,
      difficulty: persistedVersion.difficulty,
      questionText: persistedVersion.questionText,
      passage: persistedVersion.passage,
      explanationKo: persistedVersion.explanationKo,
      explanationJa: persistedVersion.explanationJa,
      tagNames: persistedVersion.tags.map((tag) => tag.label),
      options: persistedVersion.options.map((option) => ({
        id: option.id,
        ordinal: option.ordinal,
        text: option.text
      })),
      correctOptionId: persistedVersion.correctOptionId,
      expectedRowVersion: created.versionRowVersion
    }
    const update = (
      database: MockDatabase,
      state: typeof firstState,
      suffix: string
    ) =>
      state.updateVersion({
        actorId: DEMO_ADMIN_ID,
        assertAuthority: () =>
          database.assertPhase7AdminCommandAuthority({
            actorId: DEMO_ADMIN_ID,
            requiresFresh: false
          }),
        request: {
          ...baseRequest,
          questionText: `${baseRequest.questionText} ${suffix}`
        },
        requestId: crypto.randomUUID(),
        sources: database.listCanonicalAdminQuestionSources(),
        versionId: created.questionVersionId!
      })

    const results = await Promise.allSettled([
      update(first, firstState, 'tab-a'),
      update(second, secondState, 'tab-b')
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    expect(rejected?.reason).toMatchObject({ code: 'VERSION_CONFLICT' })

    const verifier = new MockDatabase(options)
    const snapshot = verifier.getCanonicalAdminCmsSnapshot()
    const finalVersion = snapshot.versions.find(
      (version) => version.questionVersionId === created.questionVersionId
    )
    expect(finalVersion?.rowVersion).toBe(created.versionRowVersion + 1)
    expect(finalVersion?.questionText).toMatch(/tab-[ab]$/u)
    expect(
      snapshot.auditLogs.filter(
        (audit) => audit.command === 'QUESTION_VERSION_UPDATE'
      )
    ).toHaveLength(1)
  })

  it('keeps the dedicated Phase 7 graph when a stale tab persists non-CMS state', async () => {
    const storage = createStorage()
    const mutationLease = createInMemoryPhase7MutationLease()
    const options = {
      listenToStorage: false,
      mutationLease,
      now: () => '2026-09-28T00:00:00.000Z',
      storage
    } as const
    const writer = new MockDatabase(options)
    const staleTab = new MockDatabase(options)
    writer.loginAs('ADMIN', DEMO_ADMIN_ID)
    staleTab.loginAs('ADMIN', DEMO_ADMIN_ID)

    const created = await writer
      .getPhase7AdminCmsStateForHandlers()
      .createQuestion({
        actorId: DEMO_ADMIN_ID,
        assertAuthority: () =>
          writer.assertPhase7AdminCommandAuthority({
            actorId: DEMO_ADMIN_ID,
            requiresFresh: false
          }),
        request: createContent(),
        requestId: crypto.randomUUID(),
        sources: writer.listCanonicalAdminQuestionSources()
      })

    // loginAs is a representative synchronous non-CMS persistence path. Its
    // embedded v8 snapshot is stale, but it cannot overwrite the dedicated
    // Phase 7 authority key.
    staleTab.loginAs('ADMIN', DEMO_ADMIN_ID)
    const verifier = new MockDatabase(options)
    const snapshot = verifier.getCanonicalAdminCmsSnapshot()
    expect(
      snapshot.questions.some(
        (question) => question.questionId === created.questionId
      )
    ).toBe(true)
    expect(
      snapshot.auditLogs.some(
        (audit) =>
          audit.command === 'QUESTION_CREATE' &&
          audit.targetId === created.questionId
      )
    ).toBe(true)
  })

  it('rejects stale ADMIN commands after an actor switch or logout without writes', async () => {
    const storage = createStorage()
    const mutationLease = createInMemoryPhase7MutationLease()
    const options = {
      listenToStorage: false,
      mutationLease,
      now: () => '2026-09-28T00:00:00.000Z',
      storage
    } as const
    const writer = new MockDatabase(options)
    writer.loginAs('ADMIN', DEMO_ADMIN_ID)
    const state = writer.getPhase7AdminCmsStateForHandlers()
    const before = writer.getCanonicalAdminCmsSnapshot()
    const create = (suffix: string) =>
      state.createQuestion({
        actorId: DEMO_ADMIN_ID,
        assertAuthority: () =>
          writer.assertPhase7AdminCommandAuthority({
            actorId: DEMO_ADMIN_ID,
            requiresFresh: true
          }),
        request: createContent(suffix),
        requestId: crypto.randomUUID(),
        sources: writer.listCanonicalAdminQuestionSources()
      })
    const reviewerTab = new MockDatabase(options)
    reviewerTab.loginAs('ADMIN', DEMO_REVIEWER_ADMIN_ID)
    await expect(create('stale-after-actor-switch')).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(new MockDatabase(options).getCanonicalAdminCmsSnapshot()).toEqual(
      before
    )

    reviewerTab.logout()
    await expect(create('stale-after-logout')).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      disposition: 'DEFINITE_ROLLBACK'
    })
    const afterLogout = new MockDatabase(options)
    expect(afterLogout.getCurrentUser()).toBeNull()
    expect(afterLogout.getCanonicalAdminCmsSnapshot()).toEqual(before)
  })

  it('allows same-actor data persistence but rolls back when auth changes at the final fence', async () => {
    const storage = createStorage()
    const mutationLease = createInMemoryPhase7MutationLease()
    const options = {
      listenToStorage: false,
      mutationLease,
      now: () => '2026-09-28T00:00:00.000Z',
      storage
    } as const
    const writer = new MockDatabase(options)
    writer.loginAs('ADMIN', DEMO_ADMIN_ID)
    const sameActorTab = new MockDatabase(options)
    const state = writer.getPhase7AdminCmsStateForHandlers()
    let authorityChecks = 0
    const successful = await state.createQuestion({
      actorId: DEMO_ADMIN_ID,
      assertAuthority: () => {
        authorityChecks += 1
        writer.assertPhase7AdminCommandAuthority({
          actorId: DEMO_ADMIN_ID,
          requiresFresh: false
        })
        if (authorityChecks === 1) {
          sameActorTab.createStudySession({
            count: 1,
            level: 'N5',
            mode: 'RANDOM',
            subject: 'VOCABULARY'
          })
        }
      },
      request: createContent('same-actor-data-write'),
      requestId: crypto.randomUUID(),
      sources: writer.listCanonicalAdminQuestionSources()
    })
    expect(authorityChecks).toBe(2)
    expect(successful.questionId).toEqual(expect.any(String))

    const beforeRevocation = new MockDatabase(
      options
    ).getCanonicalAdminCmsSnapshot()
    authorityChecks = 0
    await expect(
      state.createQuestion({
        actorId: DEMO_ADMIN_ID,
        assertAuthority: () => {
          authorityChecks += 1
          if (authorityChecks === 2) sameActorTab.logout()
          writer.assertPhase7AdminCommandAuthority({
            actorId: DEMO_ADMIN_ID,
            requiresFresh: false
          })
        },
        request: createContent('revoked-at-final-fence'),
        requestId: crypto.randomUUID(),
        sources: writer.listCanonicalAdminQuestionSources()
      })
    ).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(authorityChecks).toBe(2)
    const afterRevocation = new MockDatabase(options)
    expect(afterRevocation.getCurrentUser()).toBeNull()
    expect(afterRevocation.getCanonicalAdminCmsSnapshot()).toEqual(
      beforeRevocation
    )
  })

  it('does not let stale non-CMS persistence revive a switched or logged-out actor', () => {
    const storage = createStorage()
    const mutationLease = createInMemoryPhase7MutationLease()
    const options = {
      listenToStorage: false,
      mutationLease,
      now: () => '2026-09-28T00:00:00.000Z',
      storage
    } as const
    const authorityTab = new MockDatabase(options)
    authorityTab.loginAs('ADMIN', DEMO_ADMIN_ID)
    const staleDataTab = new MockDatabase(options)

    authorityTab.loginAs('ADMIN', DEMO_REVIEWER_ADMIN_ID)
    staleDataTab.createStudySession({
      count: 1,
      level: 'N5',
      mode: 'RANDOM',
      subject: 'VOCABULARY'
    })
    expect(new MockDatabase(options).getCurrentUser()?.id).toBe(
      DEMO_REVIEWER_ADMIN_ID
    )

    authorityTab.logout()
    staleDataTab.createStudySession({
      count: 1,
      level: 'N5',
      mode: 'RANDOM',
      subject: 'VOCABULARY'
    })
    expect(new MockDatabase(options).getCurrentUser()).toBeNull()
  })

  it('rolls back a learner report when its actor logs out at the final fence', async () => {
    const storage = createStorage()
    const mutationLease = createInMemoryPhase7MutationLease()
    const options = {
      listenToStorage: false,
      mutationLease,
      now: () => '2026-09-28T00:00:00.000Z',
      storage
    } as const
    const reporter = new MockDatabase(options)
    reporter.loginAs('USER', DEMO_USER_ID)
    const sessionTab = new MockDatabase(options)
    const state = reporter.getPhase7AdminCmsStateForHandlers()
    const snapshot = reporter.getCanonicalAdminCmsSnapshot()
    const published = snapshot.versions.find(
      (version) => version.versionStatus === 'PUBLISHED'
    )
    if (!published) throw new Error('Published report target is unavailable.')
    const before = snapshot.reports
    let authorityChecks = 0

    await expect(
      state.createQuestionReport({
        actorId: DEMO_USER_ID,
        actorRole: 'USER',
        assertAuthority: () => {
          authorityChecks += 1
          if (authorityChecks === 2) sessionTab.logout()
          reporter.assertPhase7QuestionReportAuthority(DEMO_USER_ID)
        },
        request: {
          description: '교차 탭 로그아웃 rollback 검증 신고입니다.',
          questionVersionId: published.questionVersionId,
          reason: 'OTHER'
        },
        resolveEntitledQuestionId: () => published.questionId
      })
    ).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(authorityChecks).toBe(2)
    expect(
      new MockDatabase(options).getCanonicalAdminCmsSnapshot().reports
    ).toEqual(before)
  })

  it('rolls back a learner report when its historical session proof disappears at the final fence', async () => {
    const storage = createStorage()
    const mutationLease = createInMemoryPhase7MutationLease()
    const options = {
      listenToStorage: false,
      mutationLease,
      now: () => '2026-09-28T00:00:00.000Z',
      storage
    } as const
    const reporter = new MockDatabase(options)
    reporter.loginAs('USER', DEMO_USER_ID)
    const publicQuestion = reporter.listCanonicalPublicQuestionRecords()[0]
    const identity = publicQuestion
      ? getPhase7QuestionContractIdentity(publicQuestion)
      : null
    if (!publicQuestion || !identity) {
      throw new Error('Historical report fixture is unavailable.')
    }
    const pinnedSession = reporter.createStudySession({
      canonicalContractVersion: 2,
      count: 1,
      level: publicQuestion.level,
      mode: 'RANDOM',
      questionIds: [publicQuestion.id],
      subject: publicQuestion.subject
    }).session

    reporter.loginAs('ADMIN', DEMO_ADMIN_ID)
    const state = reporter.getPhase7AdminCmsStateForHandlers()
    const beforeRetirement = reporter.getCanonicalAdminCmsSnapshot()
    const targetQuestion = beforeRetirement.questions.find(
      (question) => question.questionId === identity.questionId
    )
    const targetVersion = beforeRetirement.versions.find(
      (version) => version.questionVersionId === identity.questionVersionId
    )
    if (!targetQuestion || !targetVersion) {
      throw new Error('Historical report target is unavailable.')
    }
    await state.retireQuestionVersion({
      actorId: DEMO_ADMIN_ID,
      assertAuthority: () =>
        reporter.assertPhase7AdminCommandAuthority({
          actorId: DEMO_ADMIN_ID,
          requiresFresh: true
        }),
      request: {
        expectedQuestionRowVersion: targetQuestion.rowVersion,
        expectedRowVersion: targetVersion.rowVersion
      },
      requestId: crypto.randomUUID(),
      sources: reporter.listCanonicalAdminQuestionSources(),
      versionId: identity.questionVersionId
    })
    reporter.loginAs('USER', DEMO_USER_ID)
    expect(
      reporter.resolvePhase7QuestionReportEntitlement(
        DEMO_USER_ID,
        identity.questionVersionId
      )
    ).toBe(identity.questionId)

    const beforeReports = reporter.getCanonicalAdminCmsSnapshot().reports
    const beforeDedicated = storage.getLatestItem?.(
      PHASE7_ADMIN_CMS_STORAGE_KEY
    )
    let authorityChecks = 0
    let entitlementChecks = 0
    const removePinnedSession = (): void => {
      const serialized = storage.getLatestItem?.(MOCK_DATABASE_STORAGE_KEY)
      if (!serialized) throw new Error('Main mock state is unavailable.')
      const persisted = JSON.parse(serialized) as {
        canonicalDrafts: Array<{ readonly studySessionId: string }>
        sessionMetadata: Array<[string, unknown]>
        sessionQuestionSnapshots: Array<[string, unknown]>
        sessions: Array<{ readonly id: string }>
      }
      storage.setItem(
        MOCK_DATABASE_STORAGE_KEY,
        JSON.stringify({
          ...persisted,
          canonicalDrafts: persisted.canonicalDrafts.filter(
            (draft) => draft.studySessionId !== pinnedSession.id
          ),
          sessionMetadata: persisted.sessionMetadata.filter(
            ([sessionId]) => sessionId !== pinnedSession.id
          ),
          sessionQuestionSnapshots: persisted.sessionQuestionSnapshots.filter(
            ([sessionId]) => sessionId !== pinnedSession.id
          ),
          sessions: persisted.sessions.filter(
            (session) => session.id !== pinnedSession.id
          )
        })
      )
    }

    await expect(
      state.createQuestionReport({
        actorId: DEMO_USER_ID,
        actorRole: 'USER',
        assertAuthority: () => {
          authorityChecks += 1
          if (authorityChecks === 2) removePinnedSession()
          reporter.assertPhase7QuestionReportAuthority(DEMO_USER_ID)
        },
        request: {
          description: '교차 탭 entitlement drift rollback 검증 신고입니다.',
          questionVersionId: identity.questionVersionId,
          reason: 'OTHER'
        },
        resolveEntitledQuestionId: (disposition) => {
          entitlementChecks += 1
          return reporter.resolvePhase7QuestionReportEntitlement(
            DEMO_USER_ID,
            identity.questionVersionId,
            disposition
          )
        }
      })
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(authorityChecks).toBe(2)
    expect(entitlementChecks).toBe(3)
    expect(storage.getLatestItem?.(PHASE7_ADMIN_CMS_STORAGE_KEY)).toBe(
      beforeDedicated
    )
    expect(
      new MockDatabase(options).getCanonicalAdminCmsSnapshot().reports
    ).toEqual(beforeReports)
  })

  it('propagates same-actor reauthentication monotonically without reviving logged-out or other actors', async () => {
    const storage = createStorage()
    const mutationLease = createInMemoryPhase7MutationLease()
    let now = '2026-09-28T00:00:00.000Z'
    const options = {
      listenToStorage: false,
      mutationLease,
      now: () => now,
      storage
    } as const
    const first = new MockDatabase(options)
    const staleTab = new MockDatabase(options)
    first.loginAs('ADMIN', DEMO_ADMIN_ID)
    staleTab.loginAs('ADMIN', DEMO_ADMIN_ID)

    now = '2026-09-28T00:06:00.000Z'
    await first.getPhase7AdminCmsStateForHandlers().reauthenticate({
      actorId: DEMO_ADMIN_ID,
      assertAuthority: () =>
        first.assertPhase7AdminCommandAuthority({
          actorId: DEMO_ADMIN_ID,
          requiresFresh: false
        }),
      requestId: crypto.randomUUID()
    })

    expect(
      staleTab
        .getPhase7AdminCmsStateForHandlers()
        .hasFreshAssurance(DEMO_ADMIN_ID, Date.parse(now))
    ).toBe(false)
    expect(staleTab.hasAuthoritativePhase7FreshAssurance(DEMO_ADMIN_ID)).toBe(
      true
    )

    await staleTab.getPhase7AdminCmsStateForHandlers().createQuestion({
      actorId: DEMO_ADMIN_ID,
      assertAuthority: () =>
        staleTab.assertPhase7AdminCommandAuthority({
          actorId: DEMO_ADMIN_ID,
          requiresFresh: true
        }),
      request: createContent('reauth-propagation'),
      requestId: crypto.randomUUID(),
      sources: staleTab.listCanonicalAdminQuestionSources()
    })
    expect(
      staleTab
        .getPhase7AdminCmsStateForHandlers()
        .hasFreshAssurance(DEMO_ADMIN_ID, Date.parse(now))
    ).toBe(true)

    const afterMutationReload = new MockDatabase(options)
    expect(
      afterMutationReload
        .getPhase7AdminCmsStateForHandlers()
        .hasFreshAssurance(DEMO_ADMIN_ID, Date.parse(now))
    ).toBe(true)

    staleTab.logout()
    const afterLogoutReload = new MockDatabase(options)
    expect(
      afterLogoutReload
        .getPhase7AdminCmsStateForHandlers()
        .hasFreshAssurance(DEMO_ADMIN_ID, Date.parse(now))
    ).toBe(false)

    afterLogoutReload.loginAs('ADMIN', DEMO_REVIEWER_ADMIN_ID)
    const reviewerReload = new MockDatabase(options)
    const reviewerState = reviewerReload.getPhase7AdminCmsStateForHandlers()
    expect(
      reviewerState.hasFreshAssurance(DEMO_REVIEWER_ADMIN_ID, Date.parse(now))
    ).toBe(true)
    expect(
      reviewerState.hasFreshAssurance(DEMO_ADMIN_ID, Date.parse(now))
    ).toBe(false)
  })
})
