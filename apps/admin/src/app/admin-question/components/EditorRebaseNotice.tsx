import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export const editorFields = [
  'level',
  'subject',
  'questionType',
  'difficulty',
  'questionText',
  'passage',
  'options',
  'correctOptionId',
  'explanationKo',
  'explanationJa',
  'tagNames'
] as const
const fieldKeys = {
  level: 'level',
  subject: 'subject',
  questionType: 'questionType',
  difficulty: 'difficulty',
  questionText: 'questionText',
  passage: 'passage',
  options: 'options',
  correctOptionId: 'correctIdentity',
  explanationKo: 'explanationKo',
  explanationJa: 'explanationJa',
  tagNames: 'tagNames'
} as const

/** Lists fields that changed on the server and offers to rebase the draft. */
export const EditorRebaseNotice = ({
  changed,
  disabled,
  onRebase
}: {
  changed: readonly (typeof editorFields)[number][]
  disabled: boolean
  onRebase: () => void
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <section
      className="rounded-xl border border-line p-4"
      aria-labelledby="rebase-title"
    >
      <h3 id="rebase-title" className="font-bold">
        {t('editor.conflictTitle')}
      </h3>
      <p>{t('editor.conflictDescription')}</p>
      <ul>
        {(changed.length ? changed : []).map((field) => (
          <li key={field}>{t(`editor.fields.${fieldKeys[field]}`)}</li>
        ))}
        {!changed.length ? <li>{t('editor.rowVersionOnly')}</li> : null}
      </ul>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={onRebase}
      >
        {t('editor.rebaseAction')}
      </Button>
    </section>
  )
}
