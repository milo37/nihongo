import type { ReactElement } from 'react'
import { Link } from 'react-router'
import { Button } from '@nihongo/browser/common/components/Button'
import type { QuestionDetailState } from '@app/admin-question/hooks/useQuestionDetail'

/** Back link, heading with edit toggle, and live announcement. */
export const QuestionDetailHeader = ({
  state
}: {
  state: QuestionDetailState
}): ReactElement => {
  const {
    t,
    searchParams,
    setSearchParams,
    selected,
    preview,
    returnTo,
    heading,
    dirty,
    editing,
    setEditing,
    setEditorSnapshot,
    announcement,
    locked,
    canEdit,
    questionId
  } = state
  return (
    <>
      <nav aria-label={t('common.breadcrumbLabel')}>
        <Link
          to={returnTo.slice('/admin'.length)}
          className="inline-flex min-h-11 items-center rounded-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {t('common.questions')}
        </Link>
      </nav>
      <header className="my-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1
            ref={heading}
            tabIndex={-1}
            className="rounded-sm text-3xl font-black"
          >
            {t('questionDetail.title')}
          </h1>
          <p className="mt-3 break-all font-mono text-sm" translate="no">
            {questionId}
          </p>
        </div>
        {canEdit ? (
          <Button
            variant="outline"
            disabled={locked || dirty}
            onClick={() => {
              if (!editing && selected && preview.data) {
                setEditorSnapshot({
                  preview: preview.data,
                  rowVersion: selected.rowVersion
                })
                const next = new URLSearchParams(searchParams)
                next.set('version', selected.questionVersionId)
                setSearchParams(next, { replace: true })
              }
              setEditing((value) => !value)
            }}
          >
            {t(
              editing
                ? 'questionDetail.previewTitle'
                : 'questionDetail.editDraft'
            )}
          </Button>
        ) : null}
      </header>
      <p role="status" className="my-3">
        {announcement}
      </p>
    </>
  )
}
