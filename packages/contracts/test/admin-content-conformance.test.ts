import { describe, expect, it } from 'vitest'

import * as contentOperations from '@nihongo/contracts/admin/content-operations'
import * as legacyOperations from '@nihongo/contracts/admin/phase7'
import * as contentConformance from '@nihongo/contracts/testing/admin-content-conformance'
import * as legacyConformance from '@nihongo/contracts/testing/phase7-admin-conformance'

import {
  assertOperationFailureResponse,
  assertErrorPolicyManifest,
  assertOperationManifest,
  assertOperationSchemaManifest,
  buildPhase7OperationFailureResponse,
  computeRetryability,
  phase7ErrorSurfaceByOperation,
  dormantAfterSlice3AOperationManifest,
  dormantAfterSlice3RA1OperationManifest,
  dormantAfterSlice3RA2OperationManifest,
  dormantAfterSlice4OperationManifest,
  dormantAfterSlice5OperationManifest,
  phase7OperationManifest,
  operationSchemaManifest,
  phase7OperationSchemas,
  activeThroughSlice3AOperationManifest,
  activeThroughSlice3RA1OperationManifest,
  activeThroughSlice3RA2OperationManifest,
  activeThroughSlice4OperationManifest,
  activeThroughSlice5OperationManifest,
  slice3ACommandOperationManifest,
  slice3RRemediationOperationManifest,
  slice4CacheInvalidationContractByOperation,
  slice4CacheInvalidationTargets,
  slice4OperationManifest,
  slice5OperationManifest,
  phase7Slice2ReadOperationManifest
} from '../src/admin/content-operations.js'
import {
  assertSlice2ConformanceManifest,
  deferredOperationManifest,
  operationErrorConformanceManifest,
  slice2ExpectedOperations,
  slice2ReadConformanceManifest
} from '../src/testing/admin-content-conformance.js'

const requestId = '019a1234-5678-7abc-8def-0123456789ab'

const failure = (code: string, retryable: boolean) => ({
  code,
  message: 'contract failure',
  requestId,
  retryable
})

describe('Phase 7 operation and Slice 2 conformance manifests', () => {
  it('keeps the additive contract paths and aliases identical', () => {
    const oldOperation: legacyOperations.Phase7Operation =
      'createQuestionReport'
    const newOperation: contentOperations.ContentOperation = oldOperation
    const roundTrip: legacyOperations.Phase7Operation = newOperation

    expect(roundTrip).toBe(oldOperation)
    expect(contentOperations.contentOperationManifest).toBe(
      legacyOperations.phase7OperationManifest
    )
    expect(contentOperations.contentOperationSchemas).toBe(
      legacyOperations.phase7OperationSchemas
    )
    expect(contentOperations.parseJsonBytes).toBe(
      legacyOperations.parseJsonBytes
    )
    expect(contentOperations.parsePhase7JsonBytes).toBe(
      legacyOperations.parsePhase7JsonBytes
    )
    expect(contentOperations.JsonParseError).toBe(
      legacyOperations.JsonParseError
    )
    expect(contentOperations.Phase7JsonParseError).toBe(
      legacyOperations.Phase7JsonParseError
    )
    expect(contentConformance.assertSlice2ConformanceManifest).toBe(
      legacyConformance.assertSlice2ConformanceManifest
    )

    try {
      contentOperations.parseJsonBytes(new Uint8Array([123]))
      throw new Error('expected malformed JSON to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(legacyOperations.JsonParseError)
      expect(error).toBeInstanceOf(contentOperations.Phase7JsonParseError)
      if (!(error instanceof legacyOperations.JsonParseError)) throw error
      expect(error.name).toBe('Phase7JsonParseError')
      expect(error.kind).toBe('INVALID_JSON')
    }
  })

  it('closes exactly 28 operations with exactly eight active GET reads', () => {
    expect(() => assertOperationManifest()).not.toThrow()
    expect(phase7OperationManifest).toHaveLength(28)
    expect(phase7Slice2ReadOperationManifest).toHaveLength(8)
    expect(
      phase7Slice2ReadOperationManifest.every((entry) => entry.method === 'GET')
    ).toBe(true)
  })

  it('fixes the exact ordered Slice 3A, Slice 3R, and Slice 4 activation tuples', () => {
    const tuple = (entry: (typeof phase7OperationManifest)[number]) => [
      entry.operation,
      entry.operationId,
      entry.method,
      entry.path,
      entry.successStatus,
      entry.requiresFreshAssurance
    ]
    expect(slice3ACommandOperationManifest.map(tuple)).toEqual([
      [
        'createAdminQuestion',
        'admin.createAdminQuestion',
        'POST',
        '/api/v1/admin/questions',
        201,
        false
      ],
      [
        'createAdminQuestionVersion',
        'admin.createAdminQuestionVersion',
        'POST',
        '/api/v1/admin/questions/:questionId/versions',
        201,
        false
      ],
      [
        'updateQuestionVersion',
        'admin.updateQuestionVersion',
        'PATCH',
        '/api/v1/admin/question-versions/:versionId',
        200,
        false
      ],
      [
        'requestContentReview',
        'admin.requestContentReview',
        'POST',
        '/api/v1/admin/question-versions/:versionId/review-request',
        200,
        false
      ],
      [
        'requestQuestionChanges',
        'admin.requestQuestionChanges',
        'POST',
        '/api/v1/admin/question-versions/:versionId/change-request',
        200,
        false
      ]
    ])
    expect(slice3RRemediationOperationManifest.map(tuple)).toEqual([
      [
        'approveQuestionVersion',
        'admin.approveQuestionVersion',
        'POST',
        '/api/v1/admin/question-versions/:versionId/approval',
        200,
        true
      ],
      [
        'withdrawQuestionApproval',
        'admin.withdrawQuestionApproval',
        'POST',
        '/api/v1/admin/question-versions/:versionId/approval-withdrawal',
        200,
        true
      ],
      [
        'reauthenticateAdmin',
        'admin.reauthenticateAdmin',
        'POST',
        '/api/v1/admin/reauthentication',
        200,
        false
      ]
    ])
    expect(
      activeThroughSlice3AOperationManifest.map((entry) => entry.operation)
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            entry.slice2Route ||
            slice3ACommandOperationManifest.includes(entry as never)
        )
        .map((entry) => entry.operation)
    )
    expect(activeThroughSlice3AOperationManifest).toHaveLength(13)
    expect(dormantAfterSlice3AOperationManifest).toHaveLength(15)
    expect(
      dormantAfterSlice3AOperationManifest.map((entry) => entry.operation)
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            !activeThroughSlice3AOperationManifest.includes(entry as never)
        )
        .map((entry) => entry.operation)
    )

    expect(activeThroughSlice3RA1OperationManifest).toHaveLength(14)
    expect(dormantAfterSlice3RA1OperationManifest).toHaveLength(14)
    expect(
      activeThroughSlice3RA1OperationManifest.map((entry) => entry.operation)
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            activeThroughSlice3AOperationManifest.includes(entry as never) ||
            entry.operation === 'reauthenticateAdmin'
        )
        .map((entry) => entry.operation)
    )
    expect(
      dormantAfterSlice3RA1OperationManifest.map((entry) => entry.operation)
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            !activeThroughSlice3RA1OperationManifest.includes(entry as never)
        )
        .map((entry) => entry.operation)
    )

    expect(activeThroughSlice3RA2OperationManifest).toHaveLength(16)
    expect(dormantAfterSlice3RA2OperationManifest).toHaveLength(12)
    expect(
      activeThroughSlice3RA2OperationManifest.map((entry) => entry.operation)
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            activeThroughSlice3RA1OperationManifest.includes(entry as never) ||
            entry.operation === 'approveQuestionVersion' ||
            entry.operation === 'withdrawQuestionApproval'
        )
        .map((entry) => entry.operation)
    )
    expect(
      dormantAfterSlice3RA2OperationManifest.map((entry) => entry.operation)
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            !activeThroughSlice3RA2OperationManifest.includes(entry as never)
        )
        .map((entry) => entry.operation)
    )

    expect(slice4OperationManifest.map(tuple)).toEqual([
      [
        'archiveAdminQuestion',
        'admin.archiveAdminQuestion',
        'POST',
        '/api/v1/admin/questions/:questionId/archive',
        200,
        true
      ],
      [
        'publishQuestionVersion',
        'admin.publishQuestionVersion',
        'POST',
        '/api/v1/admin/question-versions/:versionId/publication',
        200,
        true
      ],
      [
        'retireQuestionVersion',
        'admin.retireQuestionVersion',
        'POST',
        '/api/v1/admin/question-versions/:versionId/retirement',
        200,
        true
      ]
    ])
    expect(activeThroughSlice4OperationManifest).toHaveLength(19)
    expect(dormantAfterSlice4OperationManifest).toHaveLength(9)
    expect(
      activeThroughSlice4OperationManifest.map((entry) => entry.operation)
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            activeThroughSlice3RA2OperationManifest.includes(entry as never) ||
            slice4OperationManifest.includes(entry as never)
        )
        .map((entry) => entry.operation)
    )
    expect(
      dormantAfterSlice4OperationManifest.map((entry) => entry.operation)
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            !activeThroughSlice4OperationManifest.includes(entry as never)
        )
        .map((entry) => entry.operation)
    )

    expect(slice5OperationManifest.map(tuple)).toEqual([
      [
        'requestContentReviewBatch',
        'admin.requestContentReviewBatch',
        'POST',
        '/api/v1/admin/question-versions/review-request-batch',
        200,
        true
      ],
      [
        'validateQuestionImport',
        'admin.validateQuestionImport',
        'POST',
        '/api/v1/admin/questions/import-validation',
        200,
        false
      ],
      [
        'applyQuestionImport',
        'admin.applyQuestionImport',
        'POST',
        '/api/v1/admin/questions/import-application',
        201,
        true
      ],
      [
        'exportAdminQuestions',
        'admin.exportAdminQuestions',
        'POST',
        '/api/v1/admin/questions/export',
        200,
        true
      ],
      [
        'createQuestionReport',
        'report.createQuestionReport',
        'POST',
        '/api/v1/question-reports',
        201,
        false
      ],
      [
        'listAdminQuestionReports',
        'admin.listAdminQuestionReports',
        'GET',
        '/api/v1/admin/question-reports',
        200,
        false
      ],
      [
        'getAdminQuestionReport',
        'admin.getAdminQuestionReport',
        'GET',
        '/api/v1/admin/question-reports/:reportId',
        200,
        false
      ],
      [
        'triageAdminQuestionReport',
        'admin.triageAdminQuestionReport',
        'POST',
        '/api/v1/admin/question-reports/:reportId/triage',
        200,
        false
      ],
      [
        'resolveAdminQuestionReport',
        'admin.resolveAdminQuestionReport',
        'POST',
        '/api/v1/admin/question-reports/:reportId/resolution',
        200,
        true
      ]
    ])
    expect(activeThroughSlice5OperationManifest).toHaveLength(28)
    expect(dormantAfterSlice5OperationManifest).toHaveLength(0)
    expect(
      activeThroughSlice5OperationManifest.map((entry) => entry.operation)
    ).toEqual(phase7OperationManifest.map((entry) => entry.operation))
  })

  it('closes the exact post-commit Slice 4 cache invalidation contract', () => {
    expect(slice4CacheInvalidationTargets).toEqual([
      'adminQuestions.allLists',
      'adminQuestions.detail',
      'adminQuestionVersions.history',
      'adminQuestionVersions.reviews',
      'adminAuditLog.allLists',
      'publicQuestions.allLists',
      'publicQuestions.detail',
      'practiceCandidates',
      'bookmarks.allLists',
      'bookmarks.detailAvailability',
      'wrongNotes.allLists',
      'wrongNotes.detail',
      'wrongNotes.reviewQueue',
      'dashboard'
    ])
    expect(slice4CacheInvalidationTargets).toHaveLength(14)
    expect(Object.keys(slice4CacheInvalidationContractByOperation)).toEqual([
      'publishQuestionVersion',
      'retireQuestionVersion',
      'archiveAdminQuestion'
    ])
    Object.values(slice4CacheInvalidationContractByOperation).forEach(
      (contract) => {
        expect(contract).toEqual({
          timing: 'POST_COMMIT',
          dispatch: 'PARALLEL',
          settlement: 'AWAIT_ALL',
          failureAction: 'NONE',
          staleActorAction: 'NONE',
          targets: slice4CacheInvalidationTargets
        })
      }
    )
  })

  it('exports one named ErrorCodeSchema for every manifest operation', async () => {
    const phase7Exports = await import('../src/admin/content-operations.js')
    const actual = Object.keys(phase7Exports)
      .filter((name) => name.endsWith('ErrorCodeSchema'))
      .sort()
    const expected = phase7OperationManifest
      .map((entry) => entry.operation + 'ErrorCodeSchema')
      .sort()
    expect(actual).toEqual(expected)
  })

  it('binds every operation to exact closed request and response schemas', () => {
    expect(() => assertOperationSchemaManifest()).not.toThrow()
    expect(Object.keys(phase7OperationSchemas)).toEqual(
      phase7OperationManifest.map((entry) => entry.operation)
    )
    expect(operationSchemaManifest).toHaveLength(28)
    operationSchemaManifest.forEach((entry) => {
      expect(entry.schemas).toBe(phase7OperationSchemas[entry.operation])
      expect(
        [
          entry.schemas.params,
          entry.schemas.query,
          entry.schemas.body,
          entry.schemas.success,
          entry.schemas.error
        ].every((schema) => typeof schema.safeParse === 'function')
      ).toBe(true)
    })
  })

  it('fixes the canonical Slice 2 route order and 20 deferred operations', () => {
    expect(() => assertSlice2ConformanceManifest()).not.toThrow()
    expect(
      slice2ReadConformanceManifest.map((entry) => entry.operation)
    ).toEqual(slice2ExpectedOperations)
    expect(deferredOperationManifest).toHaveLength(20)
    expect(
      slice2ReadConformanceManifest.every(
        (entry) =>
          entry.cacheControl === 'private, no-store' &&
          entry.requestIdHeader === 'X-Request-Id' &&
          entry.rateLimitGroup === 'ADMIN_READ'
      )
    ).toBe(true)
  })

  it('classifies every operation into the exact retryability surface matrix', () => {
    expect(() => assertErrorPolicyManifest()).not.toThrow()
    expect(operationErrorConformanceManifest).toHaveLength(28)
    expect(
      operationErrorConformanceManifest.reduce<Record<string, number>>(
        (counts, entry) => ({
          ...counts,
          [entry.errorSurface]: (counts[entry.errorSurface] ?? 0) + 1
        }),
        {}
      )
    ).toEqual({
      GET_READ: 10,
      KEYLESS_MUTATION: 14,
      VALIDATION_WRITE_ZERO: 1,
      APPLY_IMPORT: 1,
      EXPORT: 1,
      REAUTHENTICATION: 1
    })
    operationErrorConformanceManifest.forEach((entry) => {
      expect(entry.errorSurface).toBe(
        phase7ErrorSurfaceByOperation[entry.operation]
      )
      expect(entry.deterministic4xxRetryable).toBe(false)
      expect(entry.rateLimitedRetryable).toBe(true)
      expect(entry.rateLimitedRetryAfterRequired).toBe(true)
    })
  })

  it('enforces wire retryability for all 28 named operation error schemas', () => {
    operationErrorConformanceManifest.forEach((entry) => {
      const schema = phase7OperationSchemas[entry.operation].error
      expect(
        schema.safeParse(failure('AUTHENTICATION_REQUIRED', false)).success
      ).toBe(true)
      expect(
        schema.safeParse(failure('AUTHENTICATION_REQUIRED', true)).success
      ).toBe(false)
      expect(schema.safeParse(failure('RATE_LIMITED', true)).success).toBe(true)
      expect(schema.safeParse(failure('RATE_LIMITED', false)).success).toBe(
        false
      )

      const transientExpectation =
        entry.errorSurface === 'GET_READ' ||
        entry.errorSurface === 'VALIDATION_WRITE_ZERO'
          ? true
          : entry.errorSurface === 'REAUTHENTICATION'
            ? false
            : null
      for (const code of [
        'INTERNAL_SERVER_ERROR',
        'SERVICE_UNAVAILABLE'
      ] as const) {
        if (transientExpectation === null) {
          expect(schema.safeParse(failure(code, true)).success).toBe(true)
          expect(schema.safeParse(failure(code, false)).success).toBe(true)
        } else {
          expect(
            schema.safeParse(failure(code, transientExpectation)).success
          ).toBe(true)
          expect(
            schema.safeParse(failure(code, !transientExpectation)).success
          ).toBe(false)
        }
      }
    })
  })

  it('computes transient retryability from operation and disposition', () => {
    operationErrorConformanceManifest.forEach((entry) => {
      expect(
        computeRetryability({
          operation: entry.operation,
          code: 'AUTHENTICATION_REQUIRED',
          disposition: 'NO_TX'
        })
      ).toBe(false)
      expect(
        computeRetryability({
          operation: entry.operation,
          code: 'RATE_LIMITED',
          disposition: 'NO_TX'
        })
      ).toBe(true)

      for (const disposition of [
        'NO_TX',
        'DEFINITE_ROLLBACK',
        'COMMIT_CONFIRMED',
        'COMMIT_UNKNOWN'
      ] as const) {
        const expected = entry.transientRetryabilityByDisposition[disposition]
        const compute = () =>
          computeRetryability({
            operation: entry.operation,
            code: 'SERVICE_UNAVAILABLE',
            disposition
          })
        if (expected === null) {
          expect(compute).toThrow()
        } else {
          expect(compute()).toBe(expected)
        }
      }
    })
    expect(() =>
      computeRetryability({
        operation: 'createAdminQuestion',
        code: 'RATE_LIMITED',
        disposition: 'DEFINITE_ROLLBACK'
      })
    ).toThrow()
  })

  it('closes the five duplicate-race exceptions without widening them', () => {
    const duplicateRaceOperations = operationErrorConformanceManifest
      .filter((entry) => entry.duplicateRaceRetryable === false)
      .map((entry) => entry.operation)
    expect(duplicateRaceOperations).toEqual([
      'createAdminQuestion',
      'createAdminQuestionVersion',
      'updateQuestionVersion',
      'publishQuestionVersion',
      'applyQuestionImport'
    ])
    duplicateRaceOperations.forEach((operation) => {
      expect(
        computeRetryability({
          operation,
          code: 'SERVICE_UNAVAILABLE',
          disposition: 'DEFINITE_ROLLBACK',
          internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE'
        })
      ).toBe(false)
    })
    expect(() =>
      computeRetryability({
        operation: 'archiveAdminQuestion',
        code: 'SERVICE_UNAVAILABLE',
        disposition: 'DEFINITE_ROLLBACK',
        internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE'
      })
    ).toThrow()
  })

  it('builds and asserts canonical status/body/header transport', () => {
    const deterministic = buildPhase7OperationFailureResponse({
      operation: 'listAdminQuestions',
      failure: {
        code: 'ADMIN_REQUIRED',
        message: '관리자 권한이 필요합니다.',
        requestId
      },
      disposition: 'NO_TX'
    })
    expect(deterministic).toEqual({
      status: 403,
      body: {
        code: 'ADMIN_REQUIRED',
        message: '관리자 권한이 필요합니다.',
        requestId,
        retryable: false
      },
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Request-Id': requestId
      }
    })
    expect(() =>
      assertOperationFailureResponse({
        operation: 'listAdminQuestions',
        response: deterministic,
        disposition: 'NO_TX'
      })
    ).not.toThrow()

    expect(() =>
      buildPhase7OperationFailureResponse({
        operation: 'listAdminQuestions',
        failure: {
          code: 'RATE_LIMITED',
          message: 'too many requests',
          requestId
        },
        disposition: 'NO_TX'
      })
    ).toThrow()
    const limited = buildPhase7OperationFailureResponse({
      operation: 'listAdminQuestions',
      failure: {
        code: 'RATE_LIMITED',
        message: 'too many requests',
        requestId
      },
      disposition: 'NO_TX',
      retryAfterSeconds: 7
    })
    expect(limited.status).toBe(429)
    expect(limited.body.retryable).toBe(true)
    expect(limited.headers['Retry-After']).toBe('7')

    const commitUnknown = buildPhase7OperationFailureResponse({
      operation: 'createAdminQuestion',
      failure: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'commit outcome unknown',
        requestId
      },
      disposition: 'COMMIT_UNKNOWN',
      retryAfterSeconds: 3
    })
    expect(commitUnknown.status).toBe(503)
    expect(commitUnknown.body.retryable).toBe(false)
    expect(commitUnknown.headers['Retry-After']).toBe('3')

    const reauthentication = buildPhase7OperationFailureResponse({
      operation: 'reauthenticateAdmin',
      failure: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'reauthentication failed',
        requestId
      },
      disposition: 'NO_TX'
    })
    expect(reauthentication.body.retryable).toBe(false)
  })

  it('rejects tampered status, no-store, request ID, and Retry-After transport', () => {
    const limited = buildPhase7OperationFailureResponse({
      operation: 'listAdminQuestions',
      failure: {
        code: 'RATE_LIMITED',
        message: 'too many requests',
        requestId
      },
      disposition: 'NO_TX',
      retryAfterSeconds: 7
    })
    const assertResponse = (
      response: typeof limited
    ): ReturnType<typeof assertOperationFailureResponse> =>
      assertOperationFailureResponse({
        operation: 'listAdminQuestions',
        response,
        disposition: 'NO_TX'
      })

    expect(() => assertResponse({ ...limited, status: 500 })).toThrow()
    expect(() =>
      assertResponse({
        ...limited,
        headers: { ...limited.headers, 'Cache-Control': 'public' }
      })
    ).toThrow()
    expect(() =>
      assertResponse({
        ...limited,
        headers: {
          ...limited.headers,
          'X-Request-Id': '019a1234-5678-7abc-8def-0123456789ac'
        }
      })
    ).toThrow()
    expect(() =>
      assertResponse({
        ...limited,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Request-Id': requestId
        }
      })
    ).toThrow()
    for (const retryAfter of ['0', '1e3', '1.0', ' 1']) {
      expect(() =>
        assertResponse({
          ...limited,
          headers: { ...limited.headers, 'Retry-After': retryAfter }
        })
      ).toThrow()
    }
  })
})
