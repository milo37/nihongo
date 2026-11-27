import type { ReactElement, ReactNode } from 'react'

type FieldErrorProps = {
  id: string | undefined
  children: ReactNode
}

/** Validation message under a form control; `id` is its aria-describedby target. */
export const FieldError = ({ id, children }: FieldErrorProps): ReactElement => (
  <p className="field-error ui-field-error" id={id} role="alert">
    {children}
  </p>
)
