import type { ReactElement } from 'react'
import { Link } from 'react-router'
import { Button } from '@nihongo/browser/common/components/Button'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { captureAuthTransitionEpoch } from '@nihongo/browser/libs/authTransitionFence'
import { WideScreenNotice } from '@app/admin/components/WideScreenNotice'
import {
  ReauthDialogButton,
  ReauthRequiredNotice
} from '@app/admin/reauth/ReauthRequiredNotice'
import { useAdminReauth } from '@app/admin/reauth/useAdminReauth'
import { useQuestionImport } from '@app/admin-import/hooks/useQuestionImport'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { PageContainer } from '@nihongo/browser/common/components/PageContainer'
import { Eyebrow } from '@nihongo/browser/common/components/Eyebrow'

export const AdminQuestionImportPage = (): ReactElement => {
  const { user, role } = useAuth()
  const epoch = captureAuthTransitionEpoch()
  return user && role === 'ADMIN' ? (
    <ImportPage key={`${user.id}:${epoch}`} actorId={user.id} epoch={epoch} />
  ) : (
    <></>
  )
}
type ImportState = ReturnType<typeof useQuestionImport>

/** Breadcrumb back to the question list, eyebrow, title and description. */
const ImportHeader = ({ state }: { state: ImportState }): ReactElement => {
  const { t, heading } = state
  return (
    <>
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
        <Eyebrow>{t('import.eyebrow')}</Eyebrow>
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
    </>
  )
}

/** File picker with reading, file name and file error messages. */
const ImportFileSection = ({ state }: { state: ImportState }): ReactElement => {
  const {
    t,
    online,
    validation,
    request,
    fileName,
    fileError,
    reading,
    fileInput,
    pending,
    selectFile,
    validate
  } = state
  return (
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
  )
}

/** Validate or apply failure, recovery hint and the re-verification path. */
const ImportOperationError = ({
  state
}: {
  state: ImportState
}): ReactElement | null => {
  const { t, presentError, recovery, operationError, needsFresh } = state
  const reauth = useAdminReauth()
  if (!operationError) return null
  if (needsFresh)
    // The chosen file cannot be kept; the notice asks for it again.
    return (
      <div className="my-6">
        <ReauthRequiredNotice
          command={t('common.import')}
          keeps="file"
          reauth={reauth}
        />
        <div className="mt-3">
          <ReauthDialogButton reauth={reauth} />
        </div>
      </div>
    )
  return (
    <div className="my-6">
      <ErrorState
        title={t('import.error')}
        description={presentError(operationError)}
      />
      {recovery ? (
        <p role="status" className="mt-4 text-sm leading-7">
          {t(`import.recovery.${recovery}`)}
        </p>
      ) : null}
    </div>
  )
}

/** Validation outcome, item issues and the apply command. */
const ImportValidationResult = ({
  state
}: {
  state: ImportState
}): ReactElement | null => {
  const { t, applyImport, validated, resultHeading, apply, canApply } = state
  const { locale } = useUiLocale()
  if (!validated) return null
  const verdict = validated.result.valid ? 'import.valid' : 'import.invalid'
  return (
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
        {t(verdict)}
      </h2>
      <p className="mt-3">
        {t('import.resultCount', {
          formattedCount: formatNumber(validated.result.itemCount, locale)
        })}
      </p>
      <Badge className="mt-3">{t(verdict)}</Badge>
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
  )
}

const ImportPage = ({
  actorId,
  epoch
}: {
  actorId: string
  epoch: number
}): ReactElement => {
  const state = useQuestionImport({ actorId, epoch })
  const { t, online, createdCount } = state
  const { locale } = useUiLocale()
  return (
    <PageContainer width="6xl">
      <ImportHeader state={state} />
      <WideScreenNotice />
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
      <ImportFileSection state={state} />
      {!online ? (
        <p role="status" className="my-4">
          {t('common.cachedPausedDescription')}
        </p>
      ) : null}
      <ImportOperationError state={state} />
      <ImportValidationResult state={state} />
      {createdCount !== null ? (
        <p role="status" className="mt-6 font-semibold">
          {t('import.applied', {
            formattedCount: formatNumber(createdCount, locale)
          })}
        </p>
      ) : null}
    </PageContainer>
  )
}
