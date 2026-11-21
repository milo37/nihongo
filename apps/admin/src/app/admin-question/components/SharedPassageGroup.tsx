import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Link } from 'react-router'
import type { AdminPassageGroup } from '@nihongo/contracts/admin/content-operations'
import { Button } from '@nihongo/browser/common/components/Button'
import { Textarea } from '@nihongo/browser/common/components/Textarea'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import {
  questionErrorCode,
  questionFieldErrors
} from '@app/admin-question/detail/questionWorkflow'
import { useEditReadingPassage } from '@app/admin-question/hooks/useEditReadingPassage'

/** #1196: two or more questions read this passage, so it changes as one. */
export const isSharedPassage = (
  group: AdminPassageGroup | null | undefined
): group is AdminPassageGroup => (group?.questions.length ?? 0) >= 2

/**
 * #1196: under the preview passage. Lists the questions that share it and
 * edits it for all of them at once. A question with an open version blocks
 * the edit (the server refuses too), so those are listed to settle first.
 */
export const SharedPassageGroup = ({
  group,
  isOffline,
  passage,
  questionId
}: {
  group: AdminPassageGroup
  isOffline: boolean
  passage: string
  questionId: string
}): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const edit = useEditReadingPassage()
  const [text, setText] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const count = group.questions.length
  const refused = new Set(
    questionFieldErrors(edit.error).expectedQuestions ?? []
  )
  const blocked = group.questions.filter(
    (item) => item.openVersionId !== null || refused.has(item.questionId)
  )
  const code = edit.isError ? questionErrorCode(edit.error) : null
  const textError = questionFieldErrors(edit.error).text
    ? t('questionDetail.sharedPassage.textError')
    : undefined
  const save = (event: FormEvent): void => {
    event.preventDefault()
    if (text === null) return
    edit.mutate(
      {
        operation: 'editReadingPassage',
        params: { passageId: group.passageId },
        query: {},
        body: {
          text,
          expectedQuestions: group.questions.map((item) => ({
            questionId: item.questionId,
            expectedQuestionRowVersion: item.questionRowVersion
          }))
        }
      },
      {
        onSuccess: () => {
          setText(null)
          setDone(true)
        }
      }
    )
  }
  return (
    <section aria-labelledby="shared-passage" className="mt-6">
      <h3 id="shared-passage" className="font-bold">
        {t('questionDetail.sharedPassage.title')}
      </h3>
      <p className="mt-2 leading-7">
        {t(
          group.editing
            ? 'questionDetail.sharedPassage.editing'
            : 'questionDetail.sharedPassage.shared',
          { count }
        )}
      </p>
      <ol className="mt-3 grid gap-2">
        {group.questions.map((item) => (
          <li key={item.questionId} className="leading-6">
            {item.questionId === questionId ? (
              <strong>{t('questionDetail.sharedPassage.thisQuestion')} </strong>
            ) : null}
            <Link className="underline" to={`/questions/${item.questionId}`}>
              {item.level} · {t(`enums.questionTypes.${item.questionType}`)}
            </Link>{' '}
            <span lang="ja">{item.questionTextPreview}</span>
            {item.openVersionStatus ? (
              <span className="text-muted">
                {' '}
                ({t(`enums.versionStatuses.${item.openVersionStatus}`)})
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {done ? (
        <p role="status" className="mt-3">
          {t('questionDetail.sharedPassage.saved', { count })}
        </p>
      ) : null}
      {/* Outside the form: a refusal reloads the group, which may hide the
          form (another admin's edit is now open), and the reason must stay. */}
      {edit.isError && !textError && refused.size === 0 ? (
        <p role="alert" className="mt-3">
          {code === 'VERSION_CONFLICT'
            ? t('questionDetail.sharedPassage.conflict')
            : presentError(edit.error)}
        </p>
      ) : null}
      {group.editing ? null : blocked.length > 0 ? (
        <div role="alert" className="mt-3">
          <p>{t('questionDetail.sharedPassage.blocked')}</p>
          <ul className="mt-1 list-disc pl-5">
            {blocked.map((item) => (
              <li key={item.questionId}>
                <Link
                  className="underline"
                  to={`/questions/${item.questionId}`}
                >
                  {item.level} · {t(`enums.questionTypes.${item.questionType}`)}
                </Link>
                {item.openVersionStatus
                  ? ` (${t(`enums.versionStatuses.${item.openVersionStatus}`)})`
                  : null}
              </li>
            ))}
          </ul>
        </div>
      ) : text === null ? (
        <Button
          className="mt-3"
          variant="outline"
          disabled={isOffline}
          onClick={() => {
            edit.reset()
            setDone(false)
            setText(passage)
          }}
        >
          {t('questionDetail.sharedPassage.edit')}
        </Button>
      ) : (
        <form className="mt-3 grid gap-3" onSubmit={save} noValidate>
          <Textarea
            name="sharedPassage"
            label={t('questionDetail.sharedPassage.editLabel')}
            hint={t('questionDetail.sharedPassage.editHint', { count })}
            error={textError}
            lang="ja"
            rows={7}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={isOffline || edit.isPending || text.trim() === ''}
            >
              {t('questionDetail.sharedPassage.save', { count })}
            </Button>
            <Button
              variant="secondary"
              disabled={edit.isPending}
              onClick={() => {
                edit.reset()
                setText(null)
              }}
            >
              {t('questionDetail.sharedPassage.cancel')}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
