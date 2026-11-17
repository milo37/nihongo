import { useTranslation } from 'react-i18next'
import type { ReactElement, Ref } from 'react'

// #1096 N-4: after trimming, 2 to 12 characters, each code point one
// character, no line break. Kept here like the sign-up check schemas: the
// contract module's zod schemas would ride along untouched.
const NICKNAME_MAX_CHARACTERS = 12
const CONTROL_CHARACTER = /[\p{Cc}\u2028\u2029]/u

export const isNickname = (value: string): boolean => {
  const trimmed = value.trim()
  const length = Array.from(trimmed).length
  return (
    length >= 2 &&
    length <= NICKNAME_MAX_CHARACTERS &&
    !CONTROL_CHARACTER.test(trimmed)
  )
}

type NicknameFieldProps = {
  id: string
  value: string
  invalid: boolean
  inputRef?: Ref<HTMLInputElement>
  onChange: (value: string) => void
}

/**
 * One nickname input with its grey 2~12 line, which turns into the red error
 * in the same place after a failed submit (r6/04). A 13th character never
 * goes in, pasted or typed, and raises no error.
 */
export const NicknameField = ({
  id,
  value,
  invalid,
  inputRef,
  onChange
}: NicknameFieldProps): ReactElement => {
  const { t } = useTranslation('auth')
  return (
    <div className="nickname-field">
      <label htmlFor={id}>{t('nickname.label')}</label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        autoComplete="nickname"
        enterKeyHint="done"
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-note`}
        onChange={(event) =>
          onChange(
            Array.from(event.currentTarget.value)
              .slice(0, NICKNAME_MAX_CHARACTERS)
              .join('')
          )
        }
      />
      <p
        id={`${id}-note`}
        className={invalid ? 'nickname-error' : 'nickname-hint'}
        role={invalid ? 'alert' : undefined}
      >
        {invalid ? t('nickname.invalid') : t('nickname.hint')}
      </p>
    </div>
  )
}
