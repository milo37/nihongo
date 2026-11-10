import { adminSessionFreshSql } from '../auth/adminFreshAuthority.js'
import {
  type AdminExecutionDisposition,
  type AdminInternalFailureReason
} from '@nihongo/contracts/admin/content-operations'
import type { StableErrorCode } from '@nihongo/contracts/common/error'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  type AuthorityProbeRow,
  type AdminAuthorityClassificationRow,
  AUTHORITY_FAILURE_MESSAGES,
  rawDatabaseIdentity,
  AdminRuleViolation
} from './adminRepositoryCommon.js'

import { v1PrincipalQuery } from '../auth/ownedSessionAuthority.js'

import {
  type AdminQuestionDomainOperation,
  type AdminCommandAuthority,
  CONTENT_OPERATIONS,
  FRESH_OPERATIONS
} from './adminQuestionCommandModel.js'
import { operatorActorOf } from './operatorAdminAuthority.js'

export class AdminQuestionCommandRepositoryError extends Error {
  readonly code: StableErrorCode
  readonly disposition: AdminExecutionDisposition
  readonly fieldErrors: Record<string, string[]> | undefined
  readonly internalReason: AdminInternalFailureReason | undefined
  readonly retryAfterSeconds: number | undefined

  constructor(input: {
    code: StableErrorCode
    message: string
    disposition: AdminExecutionDisposition
    fieldErrors?: Record<string, string[]>
    internalReason?: AdminInternalFailureReason
    retryAfterSeconds?: number
    cause?: unknown
  }) {
    super(input.message, { cause: input.cause })
    this.name = 'AdminQuestionCommandRepositoryError'
    this.code = input.code
    this.disposition = input.disposition
    this.fieldErrors = input.fieldErrors
    this.internalReason = input.internalReason
    this.retryAfterSeconds = input.retryAfterSeconds
  }
}

export const rawSqlState = (error: unknown): string | undefined => {
  if (error instanceof AdminRuleViolation) return error.sqlState
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010' ||
    typeof error.meta !== 'object' ||
    error.meta === null
  ) {
    return undefined
  }
  const meta = error.meta as Record<string, unknown>
  const states: string[] = []
  if (typeof meta.code === 'string') states.push(meta.code)
  const driver = meta.driverAdapterError
  if (typeof driver === 'object' && driver !== null) {
    const cause = (driver as Record<string, unknown>).cause
    if (typeof cause === 'object' && cause !== null) {
      const originalCode = (cause as Record<string, unknown>).originalCode
      if (typeof originalCode === 'string') states.push(originalCode)
    }
  }
  const [first, ...rest] = states
  return first && rest.every((state) => state === first) ? first : undefined
}

export const repositoryFailure = (
  code: StableErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>
): AdminQuestionCommandRepositoryError =>
  new AdminQuestionCommandRepositoryError({
    code,
    message,
    disposition: 'NO_TX',
    ...(fieldErrors ? { fieldErrors } : {})
  })

export const mapTransactionError = (
  operation: AdminQuestionDomainOperation,
  error: unknown
): AdminQuestionCommandRepositoryError => {
  if (error instanceof AdminQuestionCommandRepositoryError) {
    return new AdminQuestionCommandRepositoryError({
      code: error.code,
      message: error.message,
      disposition: 'DEFINITE_ROLLBACK',
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      ...(error.internalReason ? { internalReason: error.internalReason } : {}),
      ...(error.retryAfterSeconds
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
      cause: error
    })
  }

  const identity = rawDatabaseIdentity(error)
  const sqlState = rawSqlState(error)
  if (sqlState === '40001' || sqlState === '40P01') {
    if (
      identity?.message === 'Question target changed before arm.' ||
      identity?.message === 'QuestionVersion target changed before arm.'
    ) {
      return new AdminQuestionCommandRepositoryError({
        code: 'VERSION_CONFLICT',
        message:
          '다른 요청이 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: error
      })
    }
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '동시 콘텐츠 변경을 안전하게 확정할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    identity.message === 'Cross-question canonical duplicate is forbidden.' &&
    operation === 'publishQuestionVersion'
  ) {
    return duplicateRaceFailure(error)
  }
  if (
    identity?.sqlState === '23514' &&
    identity.message === 'Cross-question canonical duplicate is forbidden.' &&
    CONTENT_OPERATIONS.has(operation)
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'DUPLICATE_QUESTION_CONTENT',
      message: '동일한 내용의 문제가 이미 존재합니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '42501' &&
    identity.message ===
      'QuestionVersion content updates require the locked live author.' &&
    operation === 'updateQuestionVersion'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'FORBIDDEN',
      message: '작성자만 문제 버전을 수정할 수 있습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    identity.message ===
      'Review request must be authored by the version author.' &&
    operation === 'requestContentReview'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'FORBIDDEN',
      message: '작성자만 검수를 요청할 수 있습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23514' &&
    [
      'Admin content command requires an ACTIVE Question.',
      'QUESTION_VERSION_CREATE requires no open candidate.',
      'REVIEW_REQUEST target state is invalid.',
      'Review decision target state is invalid.',
      'APPROVAL_WITHDRAWAL target state is invalid.',
      'Invalid QuestionVersion status transition.'
    ].includes(identity.message)
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'INVALID_STATE_TRANSITION',
      message: '현재 상태에서는 요청한 전이를 수행할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    operation === 'updateQuestionVersion' &&
    identity?.sqlState === '23514' &&
    [
      'QUESTION_VERSION_UPDATE target is not editable.',
      'Reviewed/published QuestionVersion content is immutable.',
      'QuestionVersion children require an editable unpinned parent.'
    ].includes(identity.message)
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'QUESTION_VERSION_IMMUTABLE',
      message: '검수 또는 학습에 사용된 문제 버전은 수정할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '42501' &&
    identity.message === 'Authority expired before commit.'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: FRESH_OPERATIONS.has(operation)
        ? 'FRESH_ASSURANCE_REQUIRED'
        : 'AUTH_SESSION_EXPIRED',
      message: '관리자 세션 권한을 다시 확인해 주세요.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '동시 요청을 안전하게 확정할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    sqlState !== undefined &&
    (['55P03', '57014'].includes(sqlState) ||
      ['22', '23', '25', '2D', '40', '42'].some((prefix) =>
        sqlState.startsWith(prefix)
      ))
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '관리자 명령을 안전하게 완료할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P1001', 'P1002', 'P2024'].includes(error.code))
  ) {
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '관리자 명령 결과를 확인할 수 없습니다.',
      disposition: 'COMMIT_UNKNOWN',
      cause: error
    })
  }
  return new AdminQuestionCommandRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message: '관리자 명령 결과를 확인할 수 없습니다.',
    disposition: 'COMMIT_UNKNOWN',
    cause: error
  })
}

export const mapPreflightError = (
  error: unknown
): AdminQuestionCommandRepositoryError => {
  if (error instanceof AdminQuestionCommandRepositoryError) return error
  return new AdminQuestionCommandRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message: '관리자 명령 대상을 확인할 수 없습니다.',
    disposition: 'NO_TX',
    cause: error
  })
}

export const isSerializationFailure = (error: unknown): boolean =>
  ['40001', '40P01'].includes(rawSqlState(error) ?? '') ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034')

export const duplicateRaceFailure = (cause: unknown) =>
  new AdminQuestionCommandRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message: '동시 콘텐츠 중복으로 요청을 확정하지 못했습니다.',
    disposition: 'DEFINITE_ROLLBACK',
    internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE',
    cause
  })

export const postRollbackVersionConflict = (cause: unknown) =>
  new AdminQuestionCommandRepositoryError({
    code: 'VERSION_CONFLICT',
    message: '다른 요청이 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.',
    disposition: 'DEFINITE_ROLLBACK',
    cause
  })

export const postRollbackImmutableVersion = (cause: unknown) =>
  new AdminQuestionCommandRepositoryError({
    code: 'QUESTION_VERSION_IMMUTABLE',
    message: '검수 또는 학습에 사용된 문제 버전은 수정할 수 없습니다.',
    disposition: 'DEFINITE_ROLLBACK',
    cause
  })

/** Shared by the question command and workflow repositories. */
export const createAuthorityFailureClassifier =
  <Operation extends string>(freshOperations: ReadonlySet<Operation>) =>
  async (
    client: Pick<PrismaClient, '$queryRawUnsafe'>,
    operation: Operation,
    authority: AdminCommandAuthority,
    error: unknown
  ): Promise<AdminQuestionCommandRepositoryError | null> => {
    const identity = rawDatabaseIdentity(error)
    if (
      identity?.sqlState !== '42501' ||
      !AUTHORITY_FAILURE_MESSAGES.has(identity.message)
    ) {
      return null
    }
    // An operator command has no Session to probe: its actor stopped being
    // an ACTIVE ADMIN (JLP-828).
    if (operatorActorOf(authority) !== null) {
      return new AdminQuestionCommandRepositoryError({
        code: 'ADMIN_REQUIRED',
        message: '관리자 권한이 필요합니다.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: error
      })
    }

    let rows: AuthorityProbeRow[]
    try {
      rows = await client.$queryRawUnsafe<AuthorityProbeRow[]>(
        `SELECT principal."userId" AS "principalUserId",
         principal."role" AS "principalRole",
         CASE WHEN principal."userId" IS NULL THEN NULL
           ELSE ${adminSessionFreshSql('$1')}
         END AS "isFresh"
       FROM (${v1PrincipalQuery('$1')}) AS principal`,
        authority.rawSessionToken
      )
    } catch (probeError: unknown) {
      return new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 세션 상태를 다시 확인할 수 없습니다.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: probeError
      })
    }
    const probe = rows.length === 1 ? rows[0] : undefined
    if (!probe) {
      let classificationRows: AdminAuthorityClassificationRow[]
      try {
        classificationRows = await client.$queryRawUnsafe<
          AdminAuthorityClassificationRow[]
        >(
          'SELECT * FROM "classify_admin_authority"($1)',
          authority.rawSessionToken
        )
      } catch (classificationError: unknown) {
        return new AdminQuestionCommandRepositoryError({
          code: 'SERVICE_UNAVAILABLE',
          message: '관리자 세션 상태를 다시 확인할 수 없습니다.',
          disposition: 'DEFINITE_ROLLBACK',
          cause: classificationError
        })
      }
      const outcome = classificationRows[0]?.outcome
      if (
        classificationRows.length !== 1 ||
        (outcome !== 'ADMIN_REQUIRED' && outcome !== 'AUTH_SESSION_EXPIRED')
      ) {
        return new AdminQuestionCommandRepositoryError({
          code: 'SERVICE_UNAVAILABLE',
          message: '관리자 세션 상태를 안전하게 분류할 수 없습니다.',
          disposition: 'DEFINITE_ROLLBACK',
          cause: error
        })
      }
      return new AdminQuestionCommandRepositoryError({
        code: outcome,
        message:
          outcome === 'ADMIN_REQUIRED'
            ? '관리자 권한이 필요합니다.'
            : '로그인 세션이 만료됐습니다.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: error
      })
    }
    if (probe.principalUserId !== authority.actorId) {
      return new AdminQuestionCommandRepositoryError({
        code: 'AUTH_SESSION_EXPIRED',
        message: '로그인 세션이 만료됐습니다.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: error
      })
    }
    if (probe.principalRole !== 'ADMIN') {
      return new AdminQuestionCommandRepositoryError({
        code: 'ADMIN_REQUIRED',
        message: '관리자 권한이 필요합니다.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: error
      })
    }
    if (freshOperations.has(operation) && probe.isFresh !== true) {
      return new AdminQuestionCommandRepositoryError({
        code: 'FRESH_ASSURANCE_REQUIRED',
        message: '민감한 관리자 작업을 위해 비밀번호를 다시 확인해 주세요.',
        disposition: 'DEFINITE_ROLLBACK',
        cause: error
      })
    }
    return new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '관리자 세션 권한을 안전하게 확정할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }

export const classifyAuthorityFailure =
  createAuthorityFailureClassifier(FRESH_OPERATIONS)
