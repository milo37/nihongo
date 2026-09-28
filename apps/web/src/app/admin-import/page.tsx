import { useRef, useState } from 'react'
import { Link } from 'react-router'
import type { ChangeEvent, ReactElement } from 'react'
import {
  parsePhase7JsonBytes,
  validateQuestionImportRequestSchema,
  type ValidateQuestionImportRequest
} from '@nihongo/contracts/admin/phase7'
import { FreshAssuranceDialog } from '@app/admin-question/components/FreshAssuranceDialog'
import {
  isPhase7UiApiError,
  useApplyPhase7QuestionImport,
  useValidatePhase7QuestionImport
} from '@app/admin-question/hooks/usePhase7AdminMutations'
import { useFreshAssurance } from '@app/admin-question/hooks/useFreshAssurance'
import { Button } from '@common/components/Button'
import { ErrorState } from '@common/components/ErrorState'

const MAX_IMPORT_BYTES = 2 * 1024 * 1024

export const AdminQuestionImportPage = (): ReactElement => {
  const freshAssurance = useFreshAssurance()
  const [request, setRequest] = useState<ValidateQuestionImportRequest | null>(
    null
  )
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [isReadingFile, setIsReadingFile] = useState(false)
  const selectionRevision = useRef(0)
  const validation = useValidatePhase7QuestionImport()
  const applyImport = useApplyPhase7QuestionImport(
    (createdCount) => {
      setAnnouncement(`${createdCount}개 초안을 원자적으로 만들었습니다.`)
    },
    (error) => {
      if (
        isPhase7UiApiError(error) &&
        error.code === 'FRESH_ASSURANCE_REQUIRED'
      ) {
        freshAssurance.open({
          reason: '가져오기 적용은 여러 문제를 만드는 민감한 관리자 작업입니다.'
        })
      }
    }
  )

  const selectFile = async (
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const revision = selectionRevision.current + 1
    selectionRevision.current = revision
    const file = event.currentTarget.files?.[0]
    validation.reset()
    applyImport.reset()
    setRequest(null)
    setAnnouncement('')
    setFileError(null)
    if (!file) {
      setFileName('')
      setIsReadingFile(false)
      return
    }
    setFileName(file.name)
    setIsReadingFile(true)
    if (file.size === 0 || file.size > MAX_IMPORT_BYTES) {
      setFileError('파일은 1 byte 이상 2 MiB 이하여야 합니다.')
      setIsReadingFile(false)
      return
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (selectionRevision.current !== revision) return
      const parsed = parsePhase7JsonBytes(bytes)
      const nextRequest = validateQuestionImportRequestSchema.parse(parsed)
      setRequest(nextRequest)
      setFileError(null)
    } catch {
      if (selectionRevision.current !== revision) return
      setFileError(
        '중복 JSON 키가 없고 canonical import request 형식인 UTF-8 JSON 파일이 필요합니다.'
      )
    } finally {
      if (selectionRevision.current === revision) setIsReadingFile(false)
    }
  }

  const operationError = validation.error ?? applyImport.error
  const isOperationPending = validation.isPending || applyImport.isPending

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label="현재 위치">
        <Link
          className="font-semibold text-brand underline"
          to="/admin/questions"
        >
          문제 관리
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span aria-current="page">가져오기</span>
      </nav>
      <header className="mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          ATOMIC IMPORT
        </p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">
          문제 초안 가져오기
        </h1>
        <p className="mt-4 leading-7 text-muted">
          먼저 write 0 검증을 수행한 뒤, 동일 items와 validation digest에
          한해서만 전체 적용합니다.
        </p>
      </header>

      <div className="mt-8 rounded-2xl border border-line bg-white p-5">
        <label className="block font-semibold" htmlFor="phase7-import-file">
          JSON 파일
        </label>
        <input
          className="mt-3 min-h-11 w-full rounded-lg border border-line p-3 file:mr-4 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:font-semibold file:text-brand"
          id="phase7-import-file"
          accept="application/json,.json"
          disabled={isOperationPending}
          type="file"
          onChange={(event) => void selectFile(event)}
        />
        <p className="mt-2 text-sm text-muted">
          최대 2 MiB · 최대 100개 · UTF-8 strict JSON
        </p>
        {fileName ? <p className="mt-2 text-sm">선택: {fileName}</p> : null}
        {fileError ? (
          <p className="mt-3 text-sm font-semibold text-red-700" role="alert">
            {fileError}
          </p>
        ) : null}
        <Button
          className="mt-5"
          disabled={!request || isReadingFile || isOperationPending}
          isLoading={validation.isPending}
          onClick={() => {
            if (request) validation.mutate(request)
          }}
        >
          쓰기 없이 검증
        </Button>
      </div>

      {validation.data ? (
        <section
          className={`mt-6 rounded-2xl border p-5 ${validation.data.valid ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}
          aria-live="polite"
        >
          <h2 className="text-lg font-bold">
            {validation.data.valid ? '검증 통과' : '검증 오류'} ·{' '}
            {validation.data.itemCount}개
          </h2>
          <p className="mt-2 break-all text-xs text-muted">
            digest {validation.data.validationDigest}
          </p>
          {validation.data.errors.length > 0 ? (
            <ol className="mt-4 grid gap-2">
              {validation.data.errors.map((issue) => (
                <li
                  className="rounded-lg bg-white p-3"
                  key={`${issue.itemIndex}:${issue.fieldPath}:${issue.code}`}
                >
                  <strong>{issue.code}</strong>
                  <p className="mt-1 break-all text-sm">
                    {issue.fieldPath}: {issue.message}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <Button
              className="mt-5"
              disabled={isOperationPending}
              isLoading={applyImport.isPending}
              variant="dark"
              onClick={() => {
                if (request) {
                  applyImport.mutate({
                    items: request.items,
                    validationDigest: validation.data.validationDigest
                  })
                }
              }}
            >
              동일 검증 결과 원자 적용
            </Button>
          )}
        </section>
      ) : null}

      {operationError ? (
        <ErrorState
          className="mt-6"
          description={
            isPhase7UiApiError(operationError)
              ? `${operationError.serverMessage ?? operationError.message}${
                  operationError.retryAfterMs
                    ? ` ${Math.ceil(operationError.retryAfterMs / 1000)}초 뒤 다시 시도해 주세요.`
                    : ''
                }`
              : '가져오기 요청을 처리하지 못했습니다.'
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
