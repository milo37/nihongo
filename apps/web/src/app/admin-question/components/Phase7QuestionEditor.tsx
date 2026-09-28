import { useEffect, useMemo, useState } from 'react'
import { useBlocker } from 'react-router'
import type { KeyboardEvent, ReactElement } from 'react'
import {
  createAdminQuestionRequestSchema,
  listAdminTagsQuerySchema,
  normalizePhase7TagKey,
  updateQuestionVersionRequestSchema,
  type CreateAdminQuestionRequest,
  type PreviewQuestionVersionResponse,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { usePhase7AdminTags } from '@app/admin-question/hooks/usePhase7AdminQueries'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { Input } from '@common/components/Input'
import { Select } from '@common/components/Select'
import { Textarea } from '@common/components/Textarea'

const levels = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
const subjects = ['VOCABULARY', 'GRAMMAR', 'READING'] as const
const difficulties = ['EASY', 'NORMAL', 'HARD'] as const
const questionTypes = [
  'KANJI_READING',
  'ORTHOGRAPHY',
  'CONTEXT_VOCABULARY',
  'PARAPHRASE',
  'WORD_USAGE',
  'GRAMMAR_SELECT',
  'SENTENCE_ORDER',
  'TEXT_GRAMMAR',
  'SHORT_READING',
  'MEDIUM_READING',
  'LONG_READING',
  'INFO_RETRIEVAL'
] as const

interface EditorOption {
  readonly identity: string
  readonly serverId: string | null
  readonly text: string
}

interface EditorState {
  readonly correctIdentity: string
  readonly difficulty: (typeof difficulties)[number]
  readonly explanationJa: string
  readonly explanationKo: string
  readonly level: (typeof levels)[number]
  readonly options: readonly EditorOption[]
  readonly passage: string
  readonly questionText: string
  readonly questionType: (typeof questionTypes)[number]
  readonly subject: (typeof subjects)[number]
  readonly tagNames: readonly string[]
}

interface Phase7QuestionEditorProps {
  readonly expectedRowVersion?: number
  readonly initialPreview?: PreviewQuestionVersionResponse
  readonly isSubmitting: boolean
  readonly mode: 'create' | 'update'
  readonly rowVersionRevision?: number
  readonly requiresConflictResolution?: boolean
  readonly serverFieldErrors?: Readonly<Record<string, readonly string[]>>
  readonly serverMessage?: string
  readonly submitLabel: string
  readonly onDirtyChange?: (isDirty: boolean) => void
  readonly onSubmit: (
    input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
  ) => Promise<void>
}

const conflictFieldLabels: ReadonlyArray<readonly [keyof EditorState, string]> =
  [
    ['level', 'JLPT 급수'],
    ['subject', '과목'],
    ['questionType', '문제 유형'],
    ['difficulty', '난이도'],
    ['questionText', '문제 문장'],
    ['passage', '지문'],
    ['options', '보기 내용·순서'],
    ['correctIdentity', '정답'],
    ['explanationKo', '한국어 해설'],
    ['explanationJa', '일본어 해설'],
    ['tagNames', '태그']
  ]

const createOptionKey = (index: number): string =>
  `option-${index + 1}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`

const createInitialState = (
  preview?: PreviewQuestionVersionResponse
): EditorState => {
  if (!preview) {
    const options = Array.from({ length: 4 }, (_, index) => ({
      identity: createOptionKey(index),
      serverId: null,
      text: ''
    }))
    return {
      correctIdentity: options[0]!.identity,
      difficulty: 'NORMAL',
      explanationJa: '',
      explanationKo: '',
      level: 'N3',
      options,
      passage: '',
      questionText: '',
      questionType: 'GRAMMAR_SELECT',
      subject: 'GRAMMAR',
      tagNames: []
    }
  }
  return {
    correctIdentity: preview.adminAnswer.correctOptionId,
    difficulty: preview.question.difficulty,
    explanationJa: preview.adminAnswer.explanationJa ?? '',
    explanationKo: preview.adminAnswer.explanationKo,
    level: preview.question.level,
    options: preview.question.options.map((option) => ({
      identity: option.id,
      serverId: option.id,
      text: option.text
    })),
    passage: preview.question.passage ?? '',
    questionText: preview.question.questionText,
    questionType: preview.question.questionType,
    subject: preview.question.subject,
    tagNames: preview.question.tags.map((tag) => tag.label)
  }
}

const toCreateRequest = (state: EditorState): CreateAdminQuestionRequest => ({
  correctOptionKey: state.correctIdentity,
  difficulty: state.difficulty,
  explanationJa: state.explanationJa,
  explanationKo: state.explanationKo,
  level: state.level,
  options: state.options.map((option) => ({
    clientOptionKey: option.identity,
    text: option.text
  })),
  passage: state.passage.length > 0 ? state.passage : null,
  questionText: state.questionText,
  questionType: state.questionType,
  subject: state.subject,
  tagNames: [...state.tagNames]
})

const toUpdateRequest = (
  state: EditorState,
  expectedRowVersion: number
): UpdateQuestionVersionRequest => ({
  correctOptionId: state.correctIdentity,
  difficulty: state.difficulty,
  explanationJa: state.explanationJa,
  explanationKo: state.explanationKo,
  expectedRowVersion,
  level: state.level,
  options: state.options.map((option, index) => ({
    id: option.serverId ?? option.identity,
    ordinal: index + 1,
    text: option.text
  })),
  passage: state.passage.length > 0 ? state.passage : null,
  questionText: state.questionText,
  questionType: state.questionType,
  subject: state.subject,
  tagNames: [...state.tagNames]
})

export const Phase7QuestionEditor = ({
  expectedRowVersion,
  initialPreview,
  isSubmitting,
  mode,
  onDirtyChange,
  onSubmit,
  rowVersionRevision = 0,
  requiresConflictResolution = false,
  serverFieldErrors,
  serverMessage,
  submitLabel
}: Phase7QuestionEditorProps): ReactElement => {
  const [initialState] = useState(() => createInitialState(initialPreview))
  const [baselineState, setBaselineState] = useState(initialState)
  const [state, setState] = useState(initialState)
  const [submissionRowVersion, setSubmissionRowVersion] = useState(
    expectedRowVersion ?? 0
  )
  const [synchronizedExpectedRowVersion, setSynchronizedExpectedRowVersion] =
    useState(expectedRowVersion)
  const [synchronizedPreview, setSynchronizedPreview] = useState(initialPreview)
  const [acceptedRowVersionRevision, setAcceptedRowVersionRevision] =
    useState(rowVersionRevision)
  const [tagQuery, setTagQuery] = useState('')
  const [activeTagIndex, setActiveTagIndex] = useState(-1)
  const [clientErrors, setClientErrors] = useState<
    Readonly<Record<string, string>>
  >({})
  const [orderAnnouncement, setOrderAnnouncement] = useState('')
  const normalizedTagQuery = normalizePhase7TagKey(tagQuery)
  const parsedTagQuery = listAdminTagsQuerySchema.safeParse({
    q: normalizedTagQuery,
    limit: 8
  })
  const tagQueryError =
    tagQuery.length > 0 && !parsedTagQuery.success
      ? '태그 검색어는 정규화 후 100자 이하여야 합니다.'
      : undefined
  const tagSearch = usePhase7AdminTags(
    parsedTagQuery.success
      ? parsedTagQuery.data
      : { q: 'unavailable-tag-query', limit: 8 },
    normalizedTagQuery.length > 0 && parsedTagQuery.success
  )
  const isDirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(baselineState),
    [baselineState, state]
  )
  const blocker = useBlocker(isDirty && !isSubmitting)
  const isConflictRebasePending =
    isDirty && acceptedRowVersionRevision !== rowVersionRevision
  const conflictFields = useMemo(() => {
    if (!isConflictRebasePending || !initialPreview) return []
    const serverState = createInitialState(initialPreview)
    return conflictFieldLabels.flatMap(([key, label]) =>
      JSON.stringify(state[key]) === JSON.stringify(serverState[key])
        ? []
        : [label]
    )
  }, [initialPreview, isConflictRebasePending, state])

  if (
    !isDirty &&
    initialPreview &&
    (synchronizedPreview !== initialPreview ||
      synchronizedExpectedRowVersion !== expectedRowVersion)
  ) {
    const nextState = createInitialState(initialPreview)
    setSynchronizedPreview(initialPreview)
    setSynchronizedExpectedRowVersion(expectedRowVersion)
    setAcceptedRowVersionRevision(rowVersionRevision)
    setBaselineState(nextState)
    setState(nextState)
    setSubmissionRowVersion(expectedRowVersion ?? 0)
  } else if (!isDirty && acceptedRowVersionRevision !== rowVersionRevision) {
    setAcceptedRowVersionRevision(rowVersionRevision)
    setSubmissionRowVersion(expectedRowVersion ?? 0)
  }

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(
    () => () => {
      onDirtyChange?.(false)
    },
    [onDirtyChange]
  )

  useEffect(() => {
    if (!isDirty) return
    const preventUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventUnload)
    return () => window.removeEventListener('beforeunload', preventUnload)
  }, [isDirty])

  useEffect(() => {
    const firstPath = Object.entries(serverFieldErrors ?? {}).find(
      ([, messages]) => messages.length > 0
    )?.[0]
    if (!firstPath) return
    document
      .querySelector<HTMLElement>(`[data-field="${CSS.escape(firstPath)}"]`)
      ?.focus()
  }, [serverFieldErrors])

  const updateField = <Key extends keyof EditorState>(
    key: Key,
    value: EditorState[Key]
  ): void => {
    setState((current) => ({ ...current, [key]: value }))
  }

  const moveOption = (fromIndex: number, direction: -1 | 1): void => {
    const toIndex = fromIndex + direction
    if (toIndex < 0 || toIndex >= state.options.length) return
    setState((current) => {
      const options = [...current.options]
      const [option] = options.splice(fromIndex, 1)
      if (!option) return current
      options.splice(toIndex, 0, option)
      return { ...current, options }
    })
    setOrderAnnouncement(
      `${fromIndex + 1}번 보기를 ${toIndex + 1}번 위치로 이동했습니다. 정답 ID는 유지됩니다.`
    )
  }

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    index: number
  ): void => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    moveOption(index, event.key === 'ArrowUp' ? -1 : 1)
  }

  const addTag = (label: string): void => {
    if (
      state.tagNames.some(
        (tag) => normalizePhase7TagKey(tag) === normalizePhase7TagKey(label)
      )
    ) {
      setTagQuery('')
      setActiveTagIndex(-1)
      return
    }
    updateField('tagNames', [...state.tagNames, label])
    setTagQuery('')
    setActiveTagIndex(-1)
  }

  const submit = async (): Promise<void> => {
    const candidate =
      mode === 'create'
        ? toCreateRequest(state)
        : toUpdateRequest(state, submissionRowVersion)
    const result =
      mode === 'create'
        ? createAdminQuestionRequestSchema.safeParse(candidate)
        : updateQuestionVersionRequestSchema.safeParse(candidate)
    if (!result.success) {
      const nextErrors: Record<string, string> = {}
      result.error.issues.forEach((issue) => {
        const path = issue.path.join('.') || 'form'
        nextErrors[path] ??= issue.message
      })
      setClientErrors(nextErrors)
      const firstPath = result.error.issues[0]?.path.join('.')
      if (firstPath) {
        document
          .querySelector<HTMLElement>(`[data-field="${CSS.escape(firstPath)}"]`)
          ?.focus()
      }
      return
    }
    setClientErrors({})
    try {
      await onSubmit(result.data)
      setBaselineState(state)
    } catch {
      // The mutation owner renders the canonical API error. Keep this local
      // draft dirty and prevent an expected rejection from escaping the form.
    }
  }

  const fieldError = (path: string): string | undefined =>
    clientErrors[path] ?? serverFieldErrors?.[path]?.[0]

  return (
    <>
      <form
        className="grid gap-8"
        noValidate
        aria-busy={isSubmitting}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {serverMessage ? (
          <p
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"
            role="alert"
          >
            {serverMessage}
          </p>
        ) : null}

        <fieldset className="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:grid-cols-2">
          <legend className="px-2 text-lg font-bold">분류와 본문</legend>
          <Select
            data-field="level"
            label="JLPT 급수"
            name="level"
            value={state.level}
            onChange={(event) =>
              updateField(
                'level',
                event.currentTarget.value as EditorState['level']
              )
            }
          >
            {levels.map((level) => (
              <option key={level}>{level}</option>
            ))}
          </Select>
          <Select
            data-field="subject"
            label="과목"
            name="subject"
            value={state.subject}
            onChange={(event) =>
              updateField(
                'subject',
                event.currentTarget.value as EditorState['subject']
              )
            }
          >
            {subjects.map((subject) => (
              <option key={subject}>{subject}</option>
            ))}
          </Select>
          <Select
            data-field="questionType"
            error={fieldError('questionType')}
            label="문제 유형"
            name="questionType"
            value={state.questionType}
            onChange={(event) =>
              updateField(
                'questionType',
                event.currentTarget.value as EditorState['questionType']
              )
            }
          >
            {questionTypes.map((questionType) => (
              <option key={questionType}>{questionType}</option>
            ))}
          </Select>
          <Select
            data-field="difficulty"
            label="난이도"
            name="difficulty"
            value={state.difficulty}
            onChange={(event) =>
              updateField(
                'difficulty',
                event.currentTarget.value as EditorState['difficulty']
              )
            }
          >
            {difficulties.map((difficulty) => (
              <option key={difficulty}>{difficulty}</option>
            ))}
          </Select>
          <div className="sm:col-span-2">
            <Textarea
              data-field="questionText"
              error={fieldError('questionText')}
              label="문제 문장"
              name="questionText"
              rows={4}
              value={state.questionText}
              onChange={(event) =>
                updateField('questionText', event.currentTarget.value)
              }
            />
          </div>
          <div className="sm:col-span-2">
            <Textarea
              data-field="passage"
              error={fieldError('passage')}
              hint="독해 문제에는 필수이며, 그 외에는 TEXT_GRAMMAR에서만 사용할 수 있습니다."
              label="지문"
              name="passage"
              rows={6}
              value={state.passage}
              onChange={(event) =>
                updateField('passage', event.currentTarget.value)
              }
            />
          </div>
        </fieldset>

        <fieldset className="grid gap-4 rounded-2xl border border-line bg-white p-5">
          <legend className="px-2 text-lg font-bold">보기와 정답</legend>
          <p className="text-sm text-muted">
            이동 버튼 또는 보기 입력란에서 Alt+위/아래 화살표로 순서를 바꿀 수
            있습니다.
          </p>
          <p className="sr-only" aria-live="polite">
            {orderAnnouncement}
          </p>
          {state.options.map((option, index) => (
            <div
              className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-[auto_1fr_auto]"
              key={option.identity}
            >
              <label className="flex min-h-11 items-center gap-2 font-semibold">
                <input
                  checked={state.correctIdentity === option.identity}
                  className="size-5 accent-emerald-700"
                  name="correct-option"
                  type="radio"
                  onChange={() =>
                    updateField('correctIdentity', option.identity)
                  }
                />
                정답 {index + 1}
              </label>
              <Textarea
                data-field={`options.${index}.text`}
                error={fieldError(`options.${index}.text`)}
                hideLabel
                label={`${index + 1}번 보기`}
                name={`option-${option.identity}`}
                rows={2}
                value={option.text}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                onChange={(event) => {
                  const text = event.currentTarget.value
                  updateField(
                    'options',
                    state.options.map((candidate) =>
                      candidate.identity === option.identity
                        ? { ...candidate, text }
                        : candidate
                    )
                  )
                }}
              />
              <div className="flex gap-2 sm:flex-col">
                <Button
                  aria-label={`${index + 1}번 보기 위로 이동`}
                  disabled={index === 0}
                  size="sm"
                  variant="outline"
                  onClick={() => moveOption(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  aria-label={`${index + 1}번 보기 아래로 이동`}
                  disabled={index === state.options.length - 1}
                  size="sm"
                  variant="outline"
                  onClick={() => moveOption(index, 1)}
                >
                  ↓
                </Button>
              </div>
            </div>
          ))}
        </fieldset>

        <fieldset className="grid gap-5 rounded-2xl border border-line bg-white p-5">
          <legend className="px-2 text-lg font-bold">해설과 태그</legend>
          <Textarea
            data-field="explanationKo"
            error={fieldError('explanationKo')}
            label="한국어 해설"
            name="explanationKo"
            rows={5}
            value={state.explanationKo}
            onChange={(event) =>
              updateField('explanationKo', event.currentTarget.value)
            }
          />
          <Textarea
            data-field="explanationJa"
            error={fieldError('explanationJa')}
            label="일본어 해설"
            name="explanationJa"
            rows={4}
            value={state.explanationJa}
            onChange={(event) =>
              updateField('explanationJa', event.currentTarget.value)
            }
          />
          <div className="grid gap-2">
            <Input
              aria-activedescendant={
                activeTagIndex >= 0
                  ? `admin-tag-suggestion-${activeTagIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls="admin-tag-suggestions"
              aria-expanded={Boolean(
                tagSearch.data && tagSearch.data.items.length > 0
              )}
              data-field="tagNames"
              error={fieldError('tagNames') ?? tagQueryError}
              label="등록된 태그 검색"
              maxLength={500}
              name="tag-search"
              role="combobox"
              value={tagQuery}
              onKeyDown={(event) => {
                const items = tagSearch.data?.items ?? []
                if (event.key === 'ArrowDown' && items.length > 0) {
                  event.preventDefault()
                  setActiveTagIndex((current) =>
                    Math.min(current + 1, items.length - 1)
                  )
                } else if (event.key === 'ArrowUp' && items.length > 0) {
                  event.preventDefault()
                  setActiveTagIndex((current) => Math.max(current - 1, 0))
                } else if (
                  event.key === 'Enter' &&
                  activeTagIndex >= 0 &&
                  items[activeTagIndex]
                ) {
                  event.preventDefault()
                  addTag(items[activeTagIndex].label)
                } else if (event.key === 'Escape') {
                  setTagQuery('')
                  setActiveTagIndex(-1)
                }
              }}
              onChange={(event) => {
                setTagQuery(event.currentTarget.value)
                setActiveTagIndex(-1)
              }}
            />
            {tagSearch.isError ? (
              <p className="text-sm font-semibold text-red-700" role="alert">
                태그 목록을 불러오지 못했습니다.
              </p>
            ) : null}
            {tagSearch.data && tagSearch.data.items.length > 0 ? (
              <ul
                className="grid gap-1 rounded-xl border border-line bg-white p-2 shadow-sm"
                id="admin-tag-suggestions"
                role="listbox"
              >
                {tagSearch.data.items.map((tag, index) => (
                  <li
                    id={`admin-tag-suggestion-${index}`}
                    key={tag.id}
                    role="option"
                    aria-selected={activeTagIndex === index}
                  >
                    <button
                      className="min-h-11 w-full rounded-lg px-3 text-left hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                      type="button"
                      onClick={() => addTag(tag.label)}
                    >
                      {tag.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2" aria-label="선택된 태그">
              {state.tagNames.map((tag) => (
                <Badge key={normalizePhase7TagKey(tag)}>
                  {tag}
                  <button
                    className="ml-2 min-h-11 min-w-11 rounded-md font-bold"
                    type="button"
                    aria-label={`${tag} 태그 제거`}
                    onClick={() =>
                      updateField(
                        'tagNames',
                        state.tagNames.filter((candidate) => candidate !== tag)
                      )
                    }
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </fieldset>

        {isConflictRebasePending ? (
          <section
            className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
            role="alert"
          >
            <h3 className="font-bold">
              서버 최신본과 로컬 초안을 비교했습니다
            </h3>
            <p className="mt-2 text-sm">
              다음 필드가 다릅니다. 자동 병합하거나 저장하지 않았습니다.
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {(conflictFields.length > 0
                ? conflictFields
                : ['rowVersion만 변경됨']
              ).map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
            <Button
              className="mt-4"
              type="button"
              variant="outline"
              onClick={() => {
                setSubmissionRowVersion(expectedRowVersion ?? 0)
                setAcceptedRowVersionRevision(rowVersionRevision)
                setOrderAnnouncement(
                  '로컬 초안을 최신 rowVersion에 적용하도록 명시적으로 선택했습니다.'
                )
              }}
            >
              검토한 로컬 초안을 최신 rowVersion에 적용
            </Button>
          </section>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            disabled={
              !isDirty ||
              isSubmitting ||
              requiresConflictResolution ||
              isConflictRebasePending
            }
            isLoading={isSubmitting}
            loadingLabel="저장 중…"
            type="submit"
          >
            {submitLabel}
          </Button>
        </div>
      </form>

      <Dialog
        open={blocker.state === 'blocked'}
        title="저장하지 않은 변경사항이 있습니다"
        description="이 페이지를 떠나면 현재 편집 내용이 사라집니다."
        onOpenChange={(open) => {
          if (!open) blocker.reset?.()
        }}
        footer={
          <>
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              계속 편집
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              변경사항 버리고 이동
            </Button>
          </>
        }
      />
    </>
  )
}
