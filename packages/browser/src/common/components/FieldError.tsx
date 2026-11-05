import type { ReactElement, ReactNode } from 'react'

type FieldErrorProps = {
  id: string | undefined
  children: ReactNode
}

/** Validation message under a form control; `id` is its aria-describedby target. */
export const FieldError = ({ id, children }: FieldErrorProps): ReactElement => (
  <p
    className="field-error text-sm font-medium text-danger"
    id={id}
    role="alert"
  >
    {children}
  </p>
)
