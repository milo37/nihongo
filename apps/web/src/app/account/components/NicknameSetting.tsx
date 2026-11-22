import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { Avatar } from '@app/account/components/Avatar'
import { useUpdateNickname } from '@app/account/hooks/useUpdateNickname'
import {
  isNickname,
  NicknameField,
  toNickname
} from '@app/login/components/NicknameField'

// Same reading time as the target level's saved message (JLP-861).
const SAVED_TOAST_MS = 6000

/**
 * #1096 N-1: the name at the top of My page with a quiet [바꾸기]. Editing
 * swaps the name for one field with [저장]/[취소] in the same place; the
 * avatar follows the new first letter once /me is read again.
 */
export const NicknameSetting = ({ name }: { name: string }): ReactElement => {
  const { t } = useTranslation('auth')
  const { t: accountT } = useTranslation('account')
  const { addToast } = useToast()
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const changeButton = useRef<HTMLButtonElement>(null)
  const editing = draft !== null
  const opened = useRef(false)
  // Opening moves the focus into the field; closing gives it back.
  useEffect(() => {
    if (editing) input.current?.focus()
    else if (opened.current) changeButton.current?.focus()
    opened.current = editing
  }, [editing])
  const save = useUpdateNickname({
    onSaved: () => {
      setDraft(null)
      addToast({
        key: 'nickname',
        title: t('nickname.saved'),
        variant: 'success',
        durationMs: SAVED_TOAST_MS
      })
    },
    onInvalid: () => setInvalid(true)
  })
  const close = (): void => {
    setDraft(null)
    setInvalid(false)
    save.reset()
  }
  const submit = (): void => {
    if (!editing) return
    if (!isNickname(draft)) {
      setInvalid(true)
      input.current?.focus()
      return
    }
    if (draft.trim() === name) {
      close()
      return
    }
    save.mutate(draft.trim())
  }

  return (
    <header className="nickname-header">
      <Avatar name={name} size="lg" />
      {!editing ? (
        <div className="nickname-name-row">
          <h1 className="nickname-name">{name}</h1>
          <button
            ref={changeButton}
            type="button"
            className="nickname-change"
            onClick={() => setDraft(toNickname(name))}
          >
            {t('nickname.change')}
          </button>
        </div>
      ) : (
        <form
          className="nickname-edit"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <NicknameField
            id="account-nickname"
            value={draft}
            invalid={invalid}
            inputRef={input}
            onChange={(value) => {
              setDraft(value)
              setInvalid(false)
              if (save.isError) save.reset()
            }}
          />
          {save.isError && !invalid ? (
            <p className="nickname-error" role="alert">
              {accountT('targetLevel.error')}
            </p>
          ) : null}
          <div className="nickname-actions">
            <Button type="submit" variant="outline" isLoading={save.isPending}>
              {accountT('targetLevel.saveAction')}
            </Button>
            <button
              type="button"
              className="nickname-cancel"
              disabled={save.isPending}
              onClick={close}
            >
              {t('signup.cancel')}
            </button>
          </div>
        </form>
      )}
    </header>
  )
}
