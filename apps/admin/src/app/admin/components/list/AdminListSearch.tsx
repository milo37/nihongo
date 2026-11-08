import { Button } from '@nihongo/browser/common/components/Button'
import { Input } from '@nihongo/browser/common/components/Input'
import type { ComponentProps, FormEvent, ReactElement, ReactNode } from 'react'
import { AdminListIcon } from '@app/admin/components/list/AdminListIcon'

type AdminListSearchProps = Omit<
  ComponentProps<typeof Input>,
  'hideLabel' | 'enterKeyHint'
> & {
  readonly submitLabel: string
  readonly onSearch: (event: FormEvent<HTMLFormElement>) => void
  /** Extra controls after the submit button, e.g. a clear button. */
  readonly actions?: ReactNode
  readonly formKey?: string
}

/**
 * Search box with a leading icon; the label stays for screen readers. The
 * submit button is hidden on narrow screens, where the keyboard submits.
 */
export const AdminListSearch = ({
  submitLabel,
  onSearch,
  actions,
  formKey,
  className,
  ...inputProps
}: AdminListSearchProps): ReactElement => (
  <form
    key={formKey}
    role="search"
    className="flex items-start gap-2"
    onSubmit={onSearch}
    noValidate
  >
    <div className="relative min-w-0 flex-1 md:max-w-[32.5rem]">
      <AdminListIcon
        name="search"
        className="pointer-events-none absolute left-3 top-3 size-5 text-muted"
      />
      <Input
        {...inputProps}
        hideLabel
        enterKeyHint="search"
        className={`pl-10 ${className ?? ''}`}
      />
    </div>
    <div className="hidden md:block">
      <Button variant="outline" type="submit">
        {submitLabel}
      </Button>
    </div>
    {actions}
  </form>
)
