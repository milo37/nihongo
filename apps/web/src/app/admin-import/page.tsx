import { useRef, useState } from 'react'
import { Link } from 'react-router'
import type { ChangeEvent, ReactElement } from 'react'
import {
  parsePhase7JsonBytes,
  validateQuestionImportRequestSchema,
  type ValidateQuestionImportRequest
} from '@nihongo/contracts/admin/phase7'
import { FreshAssuranceDialog } from '@app/admin-question/components/FreshAssuranceDialog'
import { adminImportIssueCodeKey } from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
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
  const { formatAdminNumber, presentError, t } = useAdminPresentation()
  const freshAssurance = useFreshAssurance()
  const [request, setRequest] = useState<ValidateQuestionImportRequest | null>(
    null
  )
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<'FORMAT' | 'SIZE' | null>(null)
  const [appliedCount, setAppliedCount] = useState<number | null>(null)
  const [appliedDigest, setAppliedDigest] = useState<string | null>(null)
  const [isReadingFile, setIsReadingFile] = useState(false)
  const selectionRevision = useRef(0)
  const validation = useValidatePhase7QuestionImport()
  const applyImport = useApplyPhase7QuestionImport(
    (createdCount) => {
      setAppliedCount(createdCount)
      setAppliedDigest(validation.data?.validationDigest ?? null)
    },
    (error) => {
      if (
        isPhase7UiApiError(error) &&
        error.code === 'FRESH_ASSURANCE_REQUIRED'
      ) {
        freshAssurance.open({
          reasonCode: 'IMPORT_APPLY'
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
    setAppliedCount(null)
    setAppliedDigest(null)
    setFileError(null)
    if (!file) {
      setFileName('')
      setIsReadingFile(false)
      return
    }
    setFileName(file.name)
    setIsReadingFile(true)
    if (file.size === 0 || file.size > MAX_IMPORT_BYTES) {
      setFileError('SIZE')
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
      setFileError('FORMAT')
    } finally {
      if (selectionRevision.current === revision) setIsReadingFile(false)
    }
  }

  const operationError = validation.error ?? applyImport.error
  const isOperationPending = validation.isPending || applyImport.isPending

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label={t('common.breadcrumbLabel')}>
        <Link
          className="font-semibold text-brand underline"
          to="/admin/questions"
        >
          {t('common.questions')}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span aria-current="page">{t('common.import')}</span>
      </nav>
      <header className="mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          {t('import.eyebrow')}
        </p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">
          {t('import.title')}
        </h1>
        <p className="mt-4 leading-7 text-muted">{t('import.description')}</p>
      </header>

      <div className="mt-8 rounded-2xl border border-line bg-white p-5">
        <label className="block font-semibold" htmlFor="phase7-import-file">
          {t('import.fileLabel')}
        </label>
        <input
          aria-busy={isReadingFile}
          aria-describedby={`phase7-import-file-hint${isReadingFile ? ' phase7-import-file-status' : ''}${fileError ? ' phase7-import-file-error' : ''}`}
          aria-invalid={fileError ? true : undefined}
          className="mt-3 min-h-11 w-full rounded-lg border border-line p-3 file:mr-4 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:font-semibold file:text-brand"
          id="phase7-import-file"
          accept="application/json,.json"
          disabled={isOperationPending}
          type="file"
          onChange={(event) => void selectFile(event)}
        />
        <p className="mt-2 text-sm text-muted" id="phase7-import-file-hint">
          {t('import.fileHint')}
        </p>
        {isReadingFile ? (
          <p
            className="mt-2 text-sm text-muted"
            id="phase7-import-file-status"
            role="status"
          >
            {t('import.readingFile')}
          </p>
        ) : null}
        {fileName ? (
          <p className="mt-2 break-all text-sm">
            {t('common.selectedFile', { fileName })}
          </p>
        ) : null}
        {fileError ? (
          <p
            className="mt-3 text-sm font-semibold text-red-700"
            id="phase7-import-file-error"
            role="alert"
          >
            {t(
              fileError === 'SIZE'
                ? 'import.fileSizeError'
                : 'import.fileFormatError'
            )}
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
          {t('import.validate')}
        </Button>
      </div>

      {validation.data ? (
        <section
          className={`mt-6 rounded-2xl border p-5 ${validation.data.valid ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}
          aria-live="polite"
        >
          <h2 className="text-lg font-bold">
            {t(validation.data.valid ? 'import.valid' : 'import.invalid')} ·{' '}
            {t('import.resultCount', {
              formattedCount: formatAdminNumber(validation.data.itemCount)
            })}
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
                  <strong>{t(adminImportIssueCodeKey[issue.code])}</strong>
                  <p className="mt-1 break-all text-sm">
                    {t('import.issueLabel', {
                      code: issue.code,
                      field: issue.fieldPath,
                      item: formatAdminNumber(issue.itemIndex + 1)
                    })}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <Button
              className="mt-5"
              disabled={
                isOperationPending ||
                appliedDigest === validation.data.validationDigest
              }
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
              {t('import.apply')}
            </Button>
          )}
        </section>
      ) : null}

      {operationError ? (
        <ErrorState
          className="mt-6"
          description={
            isPhase7UiApiError(operationError)
              ? presentError(operationError)
              : t('import.error')
          }
        />
      ) : null}
      {appliedCount === null ? null : (
        <p
          className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 font-semibold"
          role="status"
        >
          {t('import.applied', {
            formattedCount: formatAdminNumber(appliedCount)
          })}
        </p>
      )}
      {freshAssurance.completionMessage ? (
        <p
          className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 font-semibold"
          role="status"
        >
          {freshAssurance.completionMessage}
        </p>
      ) : null}
      <FreshAssuranceDialog controller={freshAssurance} />
    </section>
  )
}
