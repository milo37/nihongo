import { useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, Ref } from 'react'
import {
  contentTagKeySchema,
  normalizeContentTagKey
} from '@nihongo/contracts/admin/content-operations'
import type { QuestionSubject } from '@nihongo/browser/common/types/domain'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { Button } from '@nihongo/browser/common/components/Button'
import { FieldError } from '@nihongo/browser/common/components/FieldError'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { IconButton } from '@nihongo/browser/common/components/IconButton'
import { Input } from '@nihongo/browser/common/components/Input'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { classNames } from '@nihongo/browser/common/components/classNames'
import type { AdminTagListItem } from '@api/admin-tag/listAdminTags/schema'
import type { QuestionFormValues } from '@app/admin-question/components/questionFormSchema'
import { useListAdminTags } from '@app/admin-question/hooks/useListAdminTags'
import { ADMIN_TAG_PAGE_SIZE } from '@app/admin-question/queries/adminTagQueries'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export const MAX_QUESTION_TAGS = 2
const SEARCH_DEBOUNCE_MS = 250

type PickedTag = QuestionFormValues['tags'][number]

/** Normalized search key, '' for the whole subject, null when not searchable. */
const toSearchKey = (raw: string): string | null => {
  if (raw.trim().length === 0) return ''
  const parsed = contentTagKeySchema.safeParse(raw)
  return parsed.success && parsed.data.length > 0 ? parsed.data : null
}

/**
 * Tag field of the question form: search the fixed tag list of the question's
 * subject and pick up to two tags (#646). Tags cannot be created here.
 */
export const QuestionTagPicker = ({
  ref,
  value,
  onChange,
  subject,
  error,
  disabled = false
}: {
  ref?: Ref<{ focus: () => void }>
  value: readonly PickedTag[]
  onChange: (tags: PickedTag[]) => void
  subject: QuestionSubject
  error?: string
  disabled?: boolean
}): ReactElement => {
  const { t } = useAdminPresentation()
  const { locale } = useUiLocale()
  const id = useId()
  const listId = `${id}-list`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const inputRef = useRef<HTMLInputElement>(null)
  const removeRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  // Remove button index to focus once the tag list re-renders.
  const pendingFocusRef = useRef<number | null>(null)
  const comboRef = useRef<HTMLDivElement>(null)

  const isOverLimit = value.length > MAX_QUESTION_TAGS
  const isFull = value.length >= MAX_QUESTION_TAGS
  const searchDisabled = disabled || isFull
  const hasMismatch = value.some(
    (tag) => tag.subject !== null && tag.subject !== subject
  )

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(query),
      SEARCH_DEBOUNCE_MS
    )
    return () => window.clearTimeout(timer)
  }, [query])

  // A new subject is a new list: close the open one.
  const [listSubject, setListSubject] = useState(subject)
  if (listSubject !== subject) {
    setListSubject(subject)
    setOpen(false)
  }

  const searchKey = toSearchKey(debouncedQuery)
  const isListOpen = open && !searchDisabled
  const tagsQuery = useListAdminTags(
    searchKey ? { subject, q: searchKey } : { subject },
    isListOpen && searchKey !== null
  )
  const picked = new Set(value.map((tag) => normalizeContentTagKey(tag.label)))
  const isSettled = query === debouncedQuery && !tagsQuery.isFetching
  const items: AdminTagListItem[] =
    searchKey === null
      ? []
      : isSettled && tagsQuery.isSuccess
        ? tagsQuery.data.items.filter(
            (item) => !picked.has(item.normalizedName)
          )
        : []
  const isLoading = searchKey !== null && !isSettled
  const hasMore =
    searchKey === '' &&
    isSettled &&
    tagsQuery.data?.items.length === ADMIN_TAG_PAGE_SIZE
  const activeItem = items[Math.min(activeIndex, items.length - 1)]
  const optionId = (item: AdminTagListItem): string => `${id}-option-${item.id}`

  const resultsAnnouncement =
    isListOpen && !isLoading && !tagsQuery.isError
      ? t('editor.tagPicker.results', {
          count: formatNumber(items.length, locale)
        })
      : ''

  useEffect(() => {
    const removed = pendingFocusRef.current
    if (removed === null) return
    pendingFocusRef.current = null
    const target =
      removeRefs.current[removed] ??
      removeRefs.current[removed - 1] ??
      inputRef.current
    target?.focus()
  }, [value.length])

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (inputRef.current && !inputRef.current.disabled) {
        inputRef.current.focus()
      } else {
        removeRefs.current[0]?.focus()
      }
    }
  }))

  const openList = (): void => {
    setAnnouncement('')
    setOpen(true)
    setActiveIndex(0)
    inputRef.current?.scrollIntoView?.({ block: 'nearest' })
  }

  const pick = (item: AdminTagListItem): void => {
    onChange([...value, { label: item.label, subject: item.subject }])
    setQuery('')
    setDebouncedQuery('')
    setOpen(false)
    setAnnouncement(t('editor.tagPicker.added', { label: item.label }))
    // The last allowed tag disables the search field: focus its remove button.
    if (value.length + 1 >= MAX_QUESTION_TAGS)
      pendingFocusRef.current = value.length
  }

  const remove = (index: number): void => {
    const removed = value[index]
    if (!removed) return
    onChange(value.filter((_, position) => position !== index))
    setAnnouncement(t('editor.tagPicker.removed', { label: removed.label }))
    pendingFocusRef.current = index
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isListOpen) {
        openList()
        return
      }
      setActiveIndex((index) => Math.min(index + 1, items.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      // Enter picks a tag and never submits the question form.
      event.preventDefault()
      if (isListOpen && activeItem) pick(activeItem)
    } else if (event.key === 'Escape') {
      if (isListOpen) {
        setOpen(false)
      } else {
        setQuery('')
      }
    }
  }

  const guidance = isOverLimit
    ? t('editor.tagPicker.overLimit', {
        count: formatNumber(value.length, locale)
      })
    : isFull
      ? t('editor.tagPicker.max')
      : t('editor.tagPicker.hint')
  const errorMessage = hasMismatch
    ? t('editor.tagPicker.subjectMismatch')
    : error

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-ink" aria-hidden="true">
          {t('editor.fields.tagNames')}
        </span>
        <span
          className={classNames(
            'text-sm tabular-nums',
            isOverLimit ? 'font-semibold text-warning-strong' : 'text-muted'
          )}
        >
          {t('editor.tagPicker.count', {
            count: formatNumber(value.length, locale)
          })}
        </span>
      </div>

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((tag, index) => {
            const isMismatch = tag.subject !== null && tag.subject !== subject
            return (
              <li
                key={`${normalizeContentTagKey(tag.label)}-${index}`}
                className="flex max-w-full items-center gap-1"
              >
                <Badge
                  variant={isMismatch ? 'warning' : 'neutral'}
                  className="text-sm [word-break:keep-all]"
                >
                  {isMismatch ? (
                    <Icon name="circle-alert" className="shrink-0" />
                  ) : null}
                  {tag.label}
                </Badge>
                <IconButton
                  ref={(element) => {
                    removeRefs.current[index] = element
                  }}
                  variant="ghost"
                  icon={<Icon name="x" />}
                  label={t(
                    isMismatch
                      ? 'editor.tagPicker.removeMismatch'
                      : 'editor.tagPicker.remove',
                    { label: tag.label }
                  )}
                  disabled={disabled}
                  onClick={() => remove(index)}
                />
              </li>
            )
          })}
        </ul>
      ) : null}

      <div
        ref={comboRef}
        className="grid gap-2"
        // Tab into the list (e.g. its retry button) keeps the list open.
        onBlur={(event) => {
          if (!comboRef.current?.contains(event.relatedTarget)) setOpen(false)
        }}
      >
        <Input
          ref={inputRef}
          name="tags"
          label={t('editor.fields.tagNames')}
          hideLabel
          className="w-full"
          placeholder={t('editor.tagPicker.placeholder')}
          role="combobox"
          aria-expanded={isListOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            isListOpen && activeItem ? optionId(activeItem) : undefined
          }
          aria-describedby={[hintId, errorMessage ? errorId : undefined]
            .filter(Boolean)
            .join(' ')}
          aria-invalid={errorMessage ? true : undefined}
          value={query}
          disabled={searchDisabled}
          onChange={(event) => {
            setQuery(event.target.value)
            setAnnouncement('')
            setOpen(true)
            setActiveIndex(0)
          }}
          onFocus={openList}
          onKeyDown={handleKeyDown}
        />

        {isListOpen ? (
          <div className="rounded-lg border border-line bg-white">
            {isLoading ? (
              <p className="px-3 py-3 text-sm text-muted" role="status">
                {t('editor.tagPicker.loading')}
              </p>
            ) : tagsQuery.isError && searchKey !== null ? (
              <div className="grid justify-items-start gap-2 px-3 py-3">
                <p className="text-sm text-ink" role="alert">
                  {t('editor.tagPicker.error')}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  // Keep focus in the search field while retrying.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    inputRef.current?.focus()
                    void tagsQuery.refetch()
                  }}
                >
                  {t('editor.tagPicker.retry')}
                </Button>
              </div>
            ) : items.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted">
                {query.trim()
                  ? t('editor.tagPicker.empty', { query: query.trim() })
                  : t('editor.tagPicker.emptySubject')}
              </p>
            ) : null}
            <ul
              id={listId}
              role="listbox"
              aria-label={t('editor.fields.tagNames')}
              className={classNames(
                'max-h-[280px] overflow-y-auto',
                items.length === 0 && 'hidden'
              )}
            >
              {items.map((item) => {
                const isActive = item.id === activeItem?.id
                return (
                  <li
                    key={item.id}
                    id={optionId(item)}
                    role="option"
                    aria-selected={isActive}
                    className={classNames(
                      'flex min-h-11 cursor-pointer items-center border-l-2 px-3 py-2 text-sm text-ink [overflow-wrap:anywhere] [word-break:keep-all]',
                      isActive
                        ? 'border-brand bg-surface-muted'
                        : 'border-transparent hover:bg-surface-muted'
                    )}
                    // Keep focus in the search field while picking.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(item)}
                  >
                    {item.label}
                  </li>
                )
              })}
            </ul>
            {hasMore && items.length > 0 ? (
              <p className="border-t border-line px-3 py-2 text-sm text-muted">
                {t('editor.tagPicker.more')}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <p
        className={classNames(
          'text-sm',
          isOverLimit ? 'font-medium text-warning-strong' : 'text-muted'
        )}
        id={hintId}
      >
        {guidance}
      </p>
      {errorMessage ? (
        <FieldError id={errorId}>{errorMessage}</FieldError>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announcement || resultsAnnouncement}
      </p>
    </div>
  )
}
