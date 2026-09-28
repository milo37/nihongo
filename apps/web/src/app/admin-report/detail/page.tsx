import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { ReactElement } from 'react'
import { resolveAdminQuestionReportRequestSchema } from '@nihongo/contracts/admin/phase7'
import { FreshAssuranceDialog } from '@app/admin-question/components/FreshAssuranceDialog'
import { useFreshAssurance } from '@app/admin-question/hooks/useFreshAssurance'
import {
  isPhase7UiApiError,
  useResolvePhase7AdminQuestionReport,
  useTriagePhase7AdminQuestionReport
} from '@app/admin-question/hooks/usePhase7AdminMutations'
import { usePhase7AdminQuestionReportDetail } from '@app/admin-question/hooks/usePhase7AdminQueries'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { ErrorState } from '@common/components/ErrorState'
import { Input } from '@common/components/Input'
import { LoadingState } from '@common/components/LoadingState'
import { Select } from '@common/components/Select'
import { Textarea } from '@common/components/Textarea'

export const AdminQuestionReportDetailPage = (): ReactElement => {
  const { reportId = '' } = useParams()
  const freshAssurance = useFreshAssurance()
  const [outcome, setOutcome] = useState<'RESOLVED' | 'DISMISSED'>('RESOLVED')
  const [reason, setReason] = useState('')
  const [remediationVersionId, setRemediationVersionId] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [conflictRefreshError, setConflictRefreshError] = useState<
    string | null
  >(null)
  const outcomeRef = useRef<HTMLSelectElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const remediationRef = useRef<HTMLInputElement>(null)
  const report = usePhase7AdminQuestionReportDetail(reportId)

  const triage = useTriagePhase7AdminQuestionReport(reportId, (status) => {
    setConflictRefreshError(null)
    setAnnouncement(`신고가 ${status} 상태로 변경됐습니다.`)
  })

  const resolve = useResolvePhase7AdminQuestionReport(
    reportId,
    (status) => {
      setConflictRefreshError(null)
      setAnnouncement(`신고를 ${status} 처리했습니다.`)
    },
    (error) => {
      if (
        isPhase7UiApiError(error) &&
        error.code === 'FRESH_ASSURANCE_REQUIRED'
      ) {
        freshAssurance.open({
          questionIds: report.data ? [report.data.questionId] : [],
          reportId,
          reason: '신고 최종 처리는 민감한 관리자 작업입니다.'
        })
      }
      if (isPhase7UiApiError(error)) {
        if (error.fieldErrors?.outcome?.length) outcomeRef.current?.focus()
        else if (error.fieldErrors?.reason?.length) reasonRef.current?.focus()
        else if (error.fieldErrors?.remediationVersionId?.length) {
          remediationRef.current?.focus()
        }
      }
    }
  )

  if (report.isPending && !report.data)
    return <LoadingState message="신고 상세를 불러오는 중입니다…" />
  if (!report.data) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <ErrorState
          autoFocus
          description={
            report.isError && isPhase7UiApiError(report.error)
              ? (report.error.serverMessage ?? report.error.message)
              : '신고 상세를 불러오지 못했습니다.'
          }
          headingLevel={1}
          onRetry={() => void report.refetch()}
        />
      </section>
    )
  }

  const mutationError = triage.error ?? resolve.error
  const hasVersionConflict =
    mutationError !== null &&
    isPhase7UiApiError(mutationError) &&
    mutationError.code === 'VERSION_CONFLICT'
  const resolutionRequest = resolveAdminQuestionReportRequestSchema.safeParse({
    expectedRowVersion: report.data.rowVersion,
    outcome,
    reason,
    remediationVersionId:
      outcome === 'RESOLVED' && remediationVersionId.trim()
        ? remediationVersionId.trim()
        : null
  })
  const serverFieldErrors =
    mutationError && isPhase7UiApiError(mutationError)
      ? mutationError.fieldErrors
      : undefined
  const outcomeError = serverFieldErrors?.outcome?.[0]
  const reasonError = resolutionRequest.success
    ? serverFieldErrors?.reason?.[0]
    : (resolutionRequest.error.issues.find(
        (issue) => issue.path[0] === 'reason'
      )?.message ?? serverFieldErrors?.reason?.[0])
  const remediationError = resolutionRequest.success
    ? serverFieldErrors?.remediationVersionId?.[0]
    : (resolutionRequest.error.issues.find(
        (issue) => issue.path[0] === 'remediationVersionId'
      )?.message ?? serverFieldErrors?.remediationVersionId?.[0])

  const focusFirstResolutionError = (): void => {
    const firstPath = resolutionRequest.success
      ? undefined
      : resolutionRequest.error.issues[0]?.path[0]
    if (firstPath === 'reason') reasonRef.current?.focus()
    else if (firstPath === 'remediationVersionId') {
      remediationRef.current?.focus()
    }
  }

  const refreshAfterConflict = async (): Promise<void> => {
    setConflictRefreshError(null)
    const refreshed = await report.refetch()
    if (!refreshed.isSuccess || !refreshed.data) {
      setConflictRefreshError(
        '최신 신고 상태를 확인하지 못했습니다. 입력은 유지됩니다. 네트워크를 확인한 뒤 다시 시도해 주세요.'
      )
      return
    }
    triage.reset()
    resolve.reset()
    setAnnouncement(
      '최신 신고 상태를 반영했습니다. 입력을 확인한 뒤 작업을 다시 실행해 주세요.'
    )
  }

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label="현재 위치">
        <Link
          className="font-semibold text-brand underline"
          to="/admin/reports"
        >
          신고 큐
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span aria-current="page">신고 상세</span>
      </nav>
      <header className="mt-6 border-b border-line pb-8">
        <Badge variant={report.data.status === 'OPEN' ? 'warning' : 'neutral'}>
          {report.data.status}
        </Badge>
        <h1 className="mt-3 text-3xl font-black">문제 신고 상세</h1>
        <p className="mt-2 font-mono text-xs text-muted">{report.data.id}</p>
      </header>

      {report.isError ? (
        <div
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="alert"
        >
          <p className="font-semibold">
            최신 신고 상세를 확인하지 못했습니다. 현재 처리 입력은 그대로
            유지됩니다.
          </p>
          <p className="mt-1 text-sm">
            {isPhase7UiApiError(report.error)
              ? (report.error.serverMessage ?? report.error.message)
              : '신고 상세를 불러오지 못했습니다.'}
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void report.refetch()}
          >
            신고 상세 다시 확인
          </Button>
        </div>
      ) : null}

      <dl className="mt-8 grid gap-4 rounded-2xl border border-line bg-white p-5 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-semibold text-muted">문제</dt>
          <dd className="mt-1 break-all">{report.data.questionId}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">버전</dt>
          <dd className="mt-1 break-all">{report.data.questionVersionId}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">사유</dt>
          <dd className="mt-1">{report.data.reason}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">rowVersion</dt>
          <dd className="mt-1">{report.data.rowVersion}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">신고자</dt>
          <dd className="mt-1">
            {report.data.reporter.label} · {report.data.reporter.actorId}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">담당자</dt>
          <dd className="mt-1">
            {report.data.assignee
              ? `${report.data.assignee.label} · ${report.data.assignee.actorId}`
              : '미할당'}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">생성일</dt>
          <dd className="mt-1">
            {new Date(report.data.createdAt).toLocaleString('ko-KR')}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted">수정일</dt>
          <dd className="mt-1">
            {new Date(report.data.updatedAt).toLocaleString('ko-KR')}
          </dd>
        </div>
      </dl>
      <article className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="text-lg font-bold">신고 설명</h2>
        <p className="mt-3 whitespace-pre-wrap break-words leading-7">
          {report.data.description ?? '설명이 입력되지 않았습니다.'}
        </p>
      </article>

      {report.data.status === 'OPEN' ? (
        <div className="mt-6 rounded-2xl border border-line bg-white p-5">
          <h2 className="text-lg font-bold">분류 시작</h2>
          <p className="mt-2 text-muted">
            현재 관리자에게 할당하고 TRIAGED 상태로 전환합니다.
          </p>
          <Button
            className="mt-4"
            isLoading={triage.isPending}
            onClick={() => triage.mutate(report.data.rowVersion)}
          >
            신고 분류 시작
          </Button>
        </div>
      ) : null}

      {report.data.status === 'TRIAGED' ? (
        <form
          className="mt-6 grid gap-4 rounded-2xl border border-line bg-white p-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (resolutionRequest.success) {
              resolve.mutate(resolutionRequest.data)
            } else {
              focusFirstResolutionError()
            }
          }}
        >
          <h2 className="text-lg font-bold">최종 처리</h2>
          <Select
            ref={outcomeRef}
            error={outcomeError}
            label="처리 결과"
            name="outcome"
            value={outcome}
            onChange={(event) =>
              setOutcome(event.currentTarget.value as 'RESOLVED' | 'DISMISSED')
            }
          >
            <option value="RESOLVED">해결</option>
            <option value="DISMISSED">기각</option>
          </Select>
          <Textarea
            ref={reasonRef}
            error={reasonError}
            label="처리 사유"
            maxLength={1000}
            name="resolution-reason"
            required
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          {outcome === 'RESOLVED' ? (
            <Input
              ref={remediationRef}
              error={remediationError}
              hint="선택 사항입니다. 같은 문제의 검증된 후속 버전 ID만 허용됩니다."
              label="개선 버전 ID"
              name="remediation-version-id"
              value={remediationVersionId}
              onChange={(event) =>
                setRemediationVersionId(event.currentTarget.value)
              }
            />
          ) : null}
          <Button isLoading={resolve.isPending} type="submit">
            최종 처리 실행
          </Button>
        </form>
      ) : null}

      {report.data.resolution ? (
        <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="font-bold">
            처리 완료: {report.data.resolution.outcome}
          </h2>
          <p className="mt-2 whitespace-pre-wrap">
            {report.data.resolution.reason}
          </p>
        </section>
      ) : null}

      {mutationError ? (
        <ErrorState
          className="mt-6"
          description={
            conflictRefreshError ??
            (isPhase7UiApiError(mutationError)
              ? `${mutationError.serverMessage ?? mutationError.message}${
                  mutationError.retryAfterMs
                    ? ` ${Math.max(1, Math.ceil(mutationError.retryAfterMs / 1000))}초 뒤 다시 시도해 주세요.`
                    : ''
                }`
              : '신고 상태를 변경하지 못했습니다.')
          }
          onRetry={
            hasVersionConflict ? () => void refreshAfterConflict() : undefined
          }
          retryLabel="최신 신고 상태 불러오기"
          title={
            hasVersionConflict
              ? '다른 작업에서 신고 상태가 변경됐습니다'
              : undefined
          }
        />
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announcement || freshAssurance.completionMessage}
      </p>
      <FreshAssuranceDialog controller={freshAssurance} />
    </section>
  )
}
