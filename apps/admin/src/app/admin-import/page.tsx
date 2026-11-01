import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import { Link } from 'react-router'
import type {
  AdminImportValidationResponse,
  ValidateQuestionImportRequest
} from '@nihongo/contracts/admin/content-operations'
import { Button } from '@nihongo/browser/common/components/Button'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import {
  captureAuthTransitionEpoch,
  assertCurrentAuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { AdminNavigation } from '@app/admin/components/AdminNavigation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import {
  useValidateImport,
  useApplyImport,
  useImportOnline
} from '@app/admin-import/hooks/useAdminImport'
import { ImportFileError, readImportFile } from '@app/admin-import/importFile'
const errorCode = (error: unknown): string | null =>
  error &&
  typeof error === 'object' &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : null
export const AdminQuestionImportPage = (): ReactElement => {
  const { user, role } = useAuth()
  const epoch = captureAuthTransitionEpoch()
  return user && role === 'ADMIN' ? (
    <ImportPage key={`${user.id}:${epoch}`} actorId={user.id} epoch={epoch} />
  ) : (
    <></>
  )
}
const ImportPage = ({
  actorId,
  epoch
}: {
  actorId: string
  epoch: number
}): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const { locale } = useUiLocale()
  const online = useImportOnline()
  const validation = useValidateImport()
  const applyImport = useApplyImport()
  const [request, setRequest] = useState<ValidateQuestionImportRequest | null>(
    null
  )
  const [validated, setValidated] = useState<{
    request: ValidateQuestionImportRequest
    result: AdminImportValidationResponse
    revision: number
  } | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<'FORMAT' | 'SIZE' | null>(null)
  const [reading, setReading] = useState(false)
  const [createdCount, setCreatedCount] = useState<number | null>(null)
  const [appliedDigests, setAppliedDigests] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const selectionRevision = useRef(0)
  const operationInFlight = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  useEffect(
    () => () => {
      selectionRevision.current += 1
    },
    []
  )
  const pending = validation.isPending || applyImport.isPending
  const assertActor = (): void =>
    assertCurrentAuthActorTransitionFence(
      { actorId, epoch, role: 'ADMIN' },
      useAppStore.getState().currentUser
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
    setValidated(null)
    setCreatedCount(null)
    setFileError(null)
    setFileName(file?.name ?? '')
    setReading(Boolean(file))
    if (!file) return
    try {
      assertActor()
      const parsed = await readImportFile(file)
      assertActor()
      if (selectionRevision.current !== revision) return
      setRequest(parsed)
    } catch (error) {
      if (selectionRevision.current !== revision) return
      try {
        assertActor()
      } catch {
        return
      }
      setFileError(error instanceof ImportFileError ? error.kind : 'FORMAT')
      fileInput.current?.focus()
    } finally {
      if (selectionRevision.current === revision) setReading(false)
    }
  }
  const validate = async (): Promise<void> => {
    if (!request || reading || !online || pending || operationInFlight.current)
      return
    operationInFlight.current = true
    const revision = selectionRevision.current
    const input = request
    setValidated(null)
    setCreatedCount(null)
    applyImport.reset()
    try {
      const result = await validation.mutateAsync(input)
      if (selectionRevision.current !== revision) return
      assertActor()
      setValidated({ request: input, result, revision })
      requestAnimationFrame(() => {
        if (selectionRevision.current === revision)
          resultHeading.current?.focus()
      })
    } catch {
      /* The current mutation exposes the canonical error. */
    } finally {
      operationInFlight.current = false
    }
  }
  const apply = async (): Promise<void> => {
    if (
      !request ||
      !validated ||
      validated.request !== request ||
      validated.revision !== selectionRevision.current ||
      !validated.result.valid ||
      appliedDigests.has(validated.result.validationDigest) ||
      reading ||
      !online ||
      pending ||
      operationInFlight.current
    )
      return
    operationInFlight.current = true
    const revision = selectionRevision.current
    const digest = validated.result.validationDigest
    try {
      const result = await applyImport.mutateAsync({
        items: validated.request.items,
        validationDigest: digest
      })
      if (selectionRevision.current !== revision) return
      assertActor()
      setCreatedCount(result.createdCount)
      setAppliedDigests((previous) => new Set([...previous, digest]))
      requestAnimationFrame(() => {
        if (selectionRevision.current === revision) heading.current?.focus()
      })
    } catch (error) {
      if (
        selectionRevision.current === revision &&
        ['IMPORT_VALIDATION_FAILED', 'IMPORT_IDENTITY_CONFLICT'].includes(
          errorCode(error) ?? ''
        )
      )
        setValidated(null)
    } finally {
      operationInFlight.current = false
    }
  }
  const operationError = applyImport.error ?? validation.error
  const needsFresh = errorCode(applyImport.error) === 'FRESH_ASSURANCE_REQUIRED'
  const canApply = Boolean(
    validated &&
      validated.request === request &&
      validated.result.valid &&
      !appliedDigests.has(validated.result.validationDigest) &&
      !pending &&
      !reading &&
      online
  )
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <AdminNavigation />
      <nav aria-label={t('common.breadcrumbLabel')}>
        <Link
          className="inline-flex min-h-11 items-center rounded-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          to="/questions"
        >
          {t('common.questions')}
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span aria-current="page">{t('common.import')}</span>
      </nav>
      <header className="my-6">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          {t('import.eyebrow')}
        </p>
        <h1
          ref={heading}
          tabIndex={-1}
          className="mt-2 rounded-sm text-3xl font-black sm:text-4xl"
        >
          {t('import.title')}
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-muted">
          {t('import.description')}
        </p>
      </header>
      <ol
        className="my-6 flex flex-wrap items-center gap-3 border-b border-line pb-6 text-sm"
        aria-label={t('common.import')}
      >
        <li className="font-semibold">{t('import.validate')}</li>
        <li aria-hidden="true">
          <Icon name="arrow-right" className="size-4" />
        </li>
        <li>{t('import.apply')}</li>
      </ol>
      <section
        className="border-b border-line py-6"
        aria-labelledby="import-file-heading"
      >
        <h2 id="import-file-heading" className="text-xl font-bold">
          {t('import.fileLabel')}
        </h2>
        <p id="import-file-hint" className="mt-3 text-sm text-muted">
          {t('import.fileHint')}
        </p>
        <label htmlFor="import-file" className="mt-6 block font-semibold">
          {t('import.fileLabel')}
        </label>
        <input
          ref={fileInput}
          id="import-file"
          name="question-import-file"
          type="file"
          accept="application/json,.json"
          disabled={pending}
          aria-busy={reading}
          aria-invalid={fileError ? true : undefined}
          aria-describedby={`import-file-hint${reading ? ' import-reading' : ''}${fileError ? ' import-file-error' : ''}`}
          className="mt-3 min-h-11 w-full rounded-lg border border-line-interactive bg-surface p-3 file:mr-4 file:min-h-11 file:rounded-control file:border file:border-line file:bg-surface file:px-3 file:font-semibold file:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          onChange={(event) => void selectFile(event)}
        />
        {reading ? (
          <p id="import-reading" role="status" className="mt-3">
            {t('import.readingFile')}
          </p>
        ) : null}
        {fileName ? (
          <p className="mt-3 break-words text-sm text-muted">
            {t('common.selectedFile', { fileName })}
          </p>
        ) : null}
        {fileError ? (
          <p
            id="import-file-error"
            role="alert"
            className="mt-3 text-danger-strong"
          >
            {t(
              fileError === 'SIZE'
                ? 'import.fileSizeError'
                : 'import.fileFormatError'
            )}
          </p>
        ) : null}
        <Button
          className="mt-6"
          disabled={!request || reading || pending || !online}
          isLoading={validation.isPending}
          onClick={() => void validate()}
        >
          {t('import.validate')}
        </Button>
      </section>
      {!online ? (
        <p role="status" className="my-4">
          {t('common.cachedPausedDescription')}
        </p>
      ) : null}
      {operationError ? (
        <div className="my-6">
          <ErrorState
            title={t('import.error')}
            description={presentError(operationError)}
          />
          {needsFresh ? (
            <>
              <p className="mt-4 text-sm leading-7">
                {t('import.freshRevalidateHint')}
              </p>
              <Button
                className="mt-3"
                disabled={pending || !online}
                onClick={() => {
                  try {
                    assertActor()
                    appDocumentNavigation.assign(
                      '/login?redirect=' +
                        encodeURIComponent('/admin/questions/import')
                    )
                  } catch {
                    /* A changed actor cannot start fresh from this page. */
                  }
                }}
              >
                {t('reportDetail.fresh')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {validated ? (
        <section
          className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6"
          aria-labelledby="import-result-heading"
        >
          <h2
            ref={resultHeading}
            tabIndex={-1}
            id="import-result-heading"
            className="rounded-sm text-xl font-bold"
          >
            {t(validated.result.valid ? 'import.valid' : 'import.invalid')}
          </h2>
          <p className="mt-3">
            {t('import.resultCount', {
              formattedCount: formatNumber(validated.result.itemCount, locale)
            })}
          </p>
          <Badge className="mt-3">
            {t(validated.result.valid ? 'import.valid' : 'import.invalid')}
          </Badge>
          {validated.result.errors.length ? (
            <ul className="mt-5 grid gap-3">
              {validated.result.errors.map((issue) => (
                <li
                  key={`${issue.itemIndex}:${issue.fieldPath}:${issue.code}`}
                  className="break-words rounded-lg border border-line p-3"
                >
                  {t('import.issueLabel', {
                    code: t(`enums.importIssueCodes.${issue.code}`),
                    item: formatNumber(issue.itemIndex + 1, locale),
                    field: issue.fieldPath
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            className="mt-6"
            disabled={!canApply}
            isLoading={applyImport.isPending}
            onClick={() => void apply()}
          >
            {t('import.apply')}
          </Button>
        </section>
      ) : null}
      {createdCount !== null ? (
        <p role="status" className="mt-6 font-semibold">
          {t('import.applied', {
            formattedCount: formatNumber(createdCount, locale)
          })}
        </p>
      ) : null}
    </section>
  )
}
