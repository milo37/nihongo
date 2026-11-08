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

/** Breadcrumb back to the question list, title and description. */
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
      <header className="mb-8 mt-4">
        <h1
          ref={heading}
          tabIndex={-1}
          className="rounded-sm text-3xl font-black sm:text-4xl"
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
      className="border-y border-line py-8"
      aria-labelledby="import-file-heading"
    >
      <h2 id="import-file-heading" className="text-xl font-bold">
        {t('import.fileLabel')}
      </h2>
      <p id="import-file-hint" className="mt-1 text-sm text-muted">
        {t('import.fileHint')}
      </p>
      {/* The section heading names the input; the visible label is the
          translated picker button, so the browser's own text never shows. */}
      <div className="mt-2 flex min-h-14 items-center gap-3 rounded-lg border border-line-interactive bg-surface px-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand">
        <input
          ref={fileInput}
          id="import-file"
          name="question-import-file"
          type="file"
          accept="application/json,.json"
          disabled={pending}
          aria-labelledby="import-file-heading"
          aria-busy={reading}
          aria-invalid={fileError ? true : undefined}
          aria-describedby={`import-file-hint import-file-name${reading ? ' import-reading' : ''}${fileError ? ' import-file-error' : ''}`}
          className="peer sr-only"
          onChange={(event) => void selectFile(event)}
        />
        <label
          htmlFor="import-file"
          aria-hidden="true"
          className="inline-flex min-h-10 shrink-0 cursor-pointer items-center rounded-control border border-line-interactive bg-surface px-3 text-sm font-semibold text-brand hover:bg-surface-muted peer-disabled:cursor-not-allowed peer-disabled:text-disabled-text"
        >
          {t('import.chooseFile')}
        </label>
        <span
          id="import-file-name"
          className={`min-w-0 break-words text-sm ${fileName ? '' : 'text-muted'}`}
        >
          {fileName ?? t('import.noFileChosen')}
        </span>
      </div>
      {reading ? (
        <p id="import-reading" role="status" className="mt-3">
          {t('import.readingFile')}
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
        variant="outline"
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
  const { valid, itemCount, errors } = validated.result
  return (
    <section
      className={`mt-8 rounded-card border p-4 sm:p-6 ${valid ? 'border-line bg-surface' : 'border-danger-line bg-danger-soft'}`}
      aria-labelledby="import-result-heading"
    >
      {/* Focus lands here, so the verdict is part of the heading. */}
      <h2
        ref={resultHeading}
        tabIndex={-1}
        id="import-result-heading"
        className="flex flex-wrap items-center gap-3 rounded-sm text-xl font-bold"
      >
        {t('import.resultTitle')}
        <Badge
          variant={valid ? 'success' : 'danger'}
          className="inline-flex items-center gap-1"
        >
          <Icon
            name={valid ? 'circle-check' : 'circle-alert'}
            className="size-3.5 shrink-0"
          />
          {t(valid ? 'import.valid' : 'import.invalid')}
        </Badge>
      </h2>
      <p className="mt-4 flex items-baseline gap-2">
        <span className="text-sm text-muted">
          {t(valid ? 'import.resultCountLabel' : 'import.issueCountLabel')}
        </span>
        <span className="text-xl font-bold tabular-nums">
          {t('import.resultCount', {
            formattedCount: formatNumber(
              valid ? itemCount : errors.length,
              locale
            )
          })}
        </span>
      </p>
      {errors.length ? (
        <ul className="mt-4 grid list-disc gap-1 pl-5">
          {errors.map((issue) => (
            <li
              key={`${issue.itemIndex}:${issue.fieldPath}:${issue.code}`}
              className="break-words"
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
      {valid ? (
        <div className="mt-6 flex justify-end">
          <Button
            className="w-full sm:w-auto"
            disabled={!canApply}
            isLoading={applyImport.isPending}
            onClick={() => void apply()}
          >
            {t('import.apply', {
              formattedCount: formatNumber(itemCount, locale)
            })}
          </Button>
        </div>
      ) : null}
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
