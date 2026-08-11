import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useBlocker } from 'react-router'
import { z } from 'zod'
import type { FieldErrors } from 'react-hook-form'
import type { ReactElement } from 'react'
import type { CreateAdminQuestionRequest } from '@api/admin-question/createAdminQuestion/schema'
import type { QuestionRecord } from '@common/types/domain'
import {
  LEVELS,
  OPTION_LABELS,
  QUESTION_DIFFICULTIES,
  QUESTION_STATUSES,
  QUESTION_TYPES,
  SUBJECTS
} from '@common/types/domain'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { Input } from '@common/components/Input'
import { RadioGroup } from '@common/components/RadioGroup'
import { Select } from '@common/components/Select'
import { Textarea } from '@common/components/Textarea'

const TAG_SEPARATOR_REGEX = /[,，\n]/
const OPTION_LABEL_SET: ReadonlySet<string> = new Set(OPTION_LABELS)

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const

const questionTypeLabels = {
  KANJI_READING: '한자 읽기',
  ORTHOGRAPHY: '표기',
  CONTEXT_VOCABULARY: '문맥 어휘',
  PARAPHRASE: '바꿔 말하기',
  WORD_USAGE: '단어 용법',
  GRAMMAR_SELECT: '문법 선택',
  SENTENCE_ORDER: '문장 배열',
  TEXT_GRAMMAR: '지문 문법',
  SHORT_READING: '단문 독해',
  MEDIUM_READING: '중문 독해',
  LONG_READING: '장문 독해',
  INFO_RETRIEVAL: '정보 검색'
} as const

const difficultyLabels = {
  EASY: '쉬움',
  NORMAL: '보통',
  HARD: '어려움'
} as const

const statusLabels = {
  DRAFT: '초안',
  PUBLISHED: '게시'
} as const

const formOptionSchema = z
  .object({
    id: z.string().optional(),
    label: z.enum(OPTION_LABELS),
    text: z.string().trim().min(1, '보기 내용을 입력해 주세요.')
  })
  .strict()

export const questionFormSchema = z
  .object({
    level: z.enum(LEVELS, { error: '급수를 선택해 주세요.' }),
    subject: z.enum(SUBJECTS, { error: '과목을 선택해 주세요.' }),
    questionType: z.enum(QUESTION_TYPES, {
      error: '문제 유형을 선택해 주세요.'
    }),
    passage: z.string(),
    questionText: z.string().trim().min(1, '질문을 입력해 주세요.'),
    options: z
      .array(formOptionSchema)
      .length(4, '보기는 정확히 4개여야 합니다.'),
    correctOptionId: z
      .string()
      .refine(
        (value) => OPTION_LABEL_SET.has(value),
        '정답은 보기 중 정확히 하나를 선택해 주세요.'
      ),
    explanationKo: z.string().trim().min(1, '한국어 해설을 입력해 주세요.'),
    explanationJa: z.string(),
    difficulty: z.enum(QUESTION_DIFFICULTIES, {
      error: '난이도를 선택해 주세요.'
    }),
    tagsText: z.string().refine((value) => {
      return value
        .split(TAG_SEPARATOR_REGEX)
        .some((tag) => tag.trim().length > 0)
    }, '태그를 1개 이상 입력해 주세요.'),
    status: z.enum(QUESTION_STATUSES, {
      error: '게시 상태를 선택해 주세요.'
    })
  })
  .strict()
  .superRefine((value, context) => {
    if (value.subject === 'READING' && value.passage.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['passage'],
        message: '독해 문제는 지문을 입력해 주세요.'
      })
    }

    const normalizedOptions = value.options
      .map((option) => option.text.trim())
      .filter((option) => option.length > 0)

    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      context.addIssue({
        code: 'custom',
        path: ['options', 'root'],
        message: '동일한 보기를 중복해서 입력할 수 없습니다.'
      })
    }
  })

export type QuestionFormValues = z.infer<typeof questionFormSchema>

type QuestionFormProps = {
  initialQuestion?: QuestionRecord
  isSubmitting: boolean
  onSubmit: (input: CreateAdminQuestionRequest) => Promise<void>
  submitLabel: string
  submittingLabel: string
  cancelHref?: string
  serverError?: string
}

const parseTags = (value: string): string[] => {
  const tags: string[] = []
  const seenTags = new Set<string>()

  for (const rawTag of value.split(TAG_SEPARATOR_REGEX)) {
    const tag = rawTag.trim()

    if (tag.length === 0 || seenTags.has(tag)) {
      continue
    }

    seenTags.add(tag)
    tags.push(tag)
  }

  return tags
}

const createDefaultValues = (question?: QuestionRecord): QuestionFormValues => {
  if (!question) {
    return {
      level: 'N3',
      subject: 'GRAMMAR',
      questionType: 'GRAMMAR_SELECT',
      passage: '',
      questionText: '',
      options: OPTION_LABELS.map((label) => ({
        label,
        text: ''
      })),
      correctOptionId: '',
      explanationKo: '',
      explanationJa: '',
      difficulty: 'NORMAL',
      tagsText: '',
      status: 'DRAFT'
    }
  }

  const optionByLabel = new Map(
    question.options.map((option) => [option.label, option])
  )
  const correctOption = question.options.find((option) => option.isCorrect)

  return {
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    passage: question.passage ?? '',
    questionText: question.questionText,
    options: OPTION_LABELS.map((label) => {
      const option = optionByLabel.get(label)

      return {
        id: option?.id,
        label,
        text: option?.text ?? ''
      }
    }),
    correctOptionId: correctOption?.label ?? '',
    explanationKo: question.explanationKo,
    explanationJa: question.explanationJa ?? '',
    difficulty: question.difficulty,
    tagsText: question.tags.join(', '),
    status: question.status
  }
}

const toAdminQuestionInput = (
  values: QuestionFormValues
): CreateAdminQuestionRequest => {
  const passage = values.passage.trim()
  const explanationJa = values.explanationJa.trim()

  return {
    level: values.level,
    subject: values.subject,
    questionType: values.questionType,
    passage: passage.length > 0 ? passage : null,
    questionText: values.questionText.trim(),
    options: values.options.map((option) => {
      const optionId = option.id?.trim()

      return {
        ...(optionId ? { id: optionId } : {}),
        label: option.label,
        text: option.text.trim()
      }
    }),
    correctOptionId: values.correctOptionId,
    explanationKo: values.explanationKo.trim(),
    explanationJa: explanationJa.length > 0 ? explanationJa : null,
    difficulty: values.difficulty,
    tags: parseTags(values.tagsText),
    status: values.status
  }
}

export const QuestionForm = ({
  cancelHref = '/admin/questions',
  initialQuestion,
  isSubmitting,
  onSubmit,
  serverError,
  submitLabel,
  submittingLabel
}: QuestionFormProps): ReactElement => {
  const [defaultValues] = useState(() => createDefaultValues(initialQuestion))
  const {
    control,
    formState: { errors, isDirty, isSubmitting: isFormSubmitting },
    handleSubmit,
    register,
    setFocus,
    setValue
  } = useForm<QuestionFormValues>({
    defaultValues,
    resolver: zodResolver(questionFormSchema),
    shouldFocusError: true
  })
  const subject = useWatch({ control, name: 'subject' })
  const correctOptionId = useWatch({ control, name: 'correctOptionId' })
  const shouldBlockNavigation = isDirty && !isSubmitting && !isFormSubmitting
  const blocker = useBlocker(shouldBlockNavigation)

  useEffect(() => {
    if (!shouldBlockNavigation) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [shouldBlockNavigation])

  const handleInvalidSubmit = (
    formErrors: FieldErrors<QuestionFormValues>
  ): void => {
    if (formErrors.options?.root) {
      setFocus('options.0.text')
      return
    }

    if (formErrors.correctOptionId) {
      document
        .getElementById('correct-answer-group')
        ?.querySelector<HTMLInputElement>('input[type="radio"]')
        ?.focus()
    }
  }

  const submitForm = handleSubmit(async (values) => {
    await onSubmit(toAdminQuestionInput(values))
  }, handleInvalidSubmit)

  return (
    <>
      <form
        className="grid gap-8"
        aria-busy={isSubmitting || isFormSubmitting}
        noValidate
        onSubmit={(event) => void submitForm(event)}
      >
        {serverError ? (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            role="alert"
          >
            {serverError}
          </div>
        ) : null}

        <fieldset
          className="grid gap-8"
          disabled={isSubmitting || isFormSubmitting}
        >
          <legend className="sr-only">관리자 문제 정보 입력</legend>
          <section
            className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-7"
            aria-labelledby="question-basic-information"
          >
            <div className="border-b border-line pb-5">
              <h2
                className="text-balance text-xl font-bold"
                id="question-basic-information"
              >
                기본 정보
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                급수, 과목, 문제 유형과 공개 상태를 설정합니다.
              </p>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label="JLPT 급수"
                error={errors.level?.message}
                options={LEVELS.map((level) => ({
                  value: level,
                  label: level
                }))}
                {...register('level')}
              />
              <Select
                label="과목"
                error={errors.subject?.message}
                options={SUBJECTS.map((value) => ({
                  value,
                  label: subjectLabels[value]
                }))}
                {...register('subject')}
              />
              <Select
                label="문제 유형"
                error={errors.questionType?.message}
                options={QUESTION_TYPES.map((value) => ({
                  value,
                  label: questionTypeLabels[value]
                }))}
                {...register('questionType')}
              />
              <Select
                label="난이도"
                error={errors.difficulty?.message}
                options={QUESTION_DIFFICULTIES.map((value) => ({
                  value,
                  label: difficultyLabels[value]
                }))}
                {...register('difficulty')}
              />
              <Select
                label="게시 상태"
                error={errors.status?.message}
                options={QUESTION_STATUSES.map((value) => ({
                  value,
                  label: statusLabels[value]
                }))}
                {...register('status')}
              />
              <div className="rounded-lg border border-line bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-ink">문제 출처</p>
                <p className="mt-1 text-sm text-muted">
                  자체 제작 문제(ORIGINAL)로 저장됩니다.
                </p>
              </div>
            </div>
          </section>

          <section
            className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-7"
            aria-labelledby="question-content"
          >
            <div className="border-b border-line pb-5">
              <h2
                className="text-balance text-xl font-bold"
                id="question-content"
              >
                문제와 보기
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                실제 JLPT 기출이 아닌 자체 제작 문항을 입력해 주세요.
              </p>
            </div>

            <div className="mt-6 grid gap-6">
              <Textarea
                label={subject === 'READING' ? '지문 (필수)' : '지문 (선택)'}
                hint="독해 문제는 질문과 분리된 일본어 지문이 필요합니다."
                error={errors.passage?.message}
                rows={7}
                placeholder="예: 안내문이나 짧은 설명문을 입력해 주세요…"
                {...register('passage')}
              />
              <Textarea
                label="질문"
                error={errors.questionText?.message}
                rows={4}
                placeholder="예: 글의 내용과 맞는 것을 고르세요…"
                {...register('questionText')}
              />

              <div>
                <h3 className="text-base font-bold">보기 4개</h3>
                <p className="mt-1 text-sm leading-6 text-muted">
                  빈 보기와 동일한 보기는 저장할 수 없습니다.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {OPTION_LABELS.map((label, index) => (
                    <div key={label}>
                      <input
                        type="hidden"
                        {...register(`options.${index}.id`)}
                      />
                      <input
                        type="hidden"
                        value={label}
                        {...register(`options.${index}.label`)}
                      />
                      <Input
                        label={`보기 ${label}`}
                        error={errors.options?.[index]?.text?.message}
                        placeholder={`보기 ${label} 내용을 입력해 주세요…`}
                        {...register(`options.${index}.text`)}
                      />
                    </div>
                  ))}
                </div>
                {errors.options?.root?.message ? (
                  <p
                    className="mt-3 text-sm font-medium text-red-700"
                    role="alert"
                  >
                    {errors.options.root.message}
                  </p>
                ) : null}
              </div>

              <div id="correct-answer-group">
                <input type="hidden" {...register('correctOptionId')} />
                <RadioGroup
                  name="correct-answer"
                  legend="정답"
                  value={correctOptionId}
                  error={errors.correctOptionId?.message}
                  orientation="horizontal"
                  options={OPTION_LABELS.map((label) => ({
                    value: label,
                    label: `보기 ${label}`
                  }))}
                  onValueChange={(value) => {
                    setValue('correctOptionId', value, {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: true
                    })
                  }}
                />
              </div>
            </div>
          </section>

          <section
            className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-7"
            aria-labelledby="question-explanation"
          >
            <div className="border-b border-line pb-5">
              <h2
                className="text-balance text-xl font-bold"
                id="question-explanation"
              >
                해설과 태그
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                정답 근거와 오답 이유를 학습자가 이해할 수 있게 설명합니다.
              </p>
            </div>

            <div className="mt-6 grid gap-6">
              <Textarea
                label="한국어 해설"
                error={errors.explanationKo?.message}
                rows={6}
                placeholder="정답 근거와 다른 보기가 오답인 이유를 입력해 주세요…"
                {...register('explanationKo')}
              />
              <Textarea
                label="일본어 해설 (선택)"
                error={errors.explanationJa?.message}
                rows={5}
                placeholder="必要な場合、日本語の解説を入力してください…"
                {...register('explanationJa')}
              />
              <Input
                label="태그"
                hint="쉼표 또는 줄바꿈으로 구분합니다. 최소 1개가 필요합니다."
                error={errors.tagsText?.message}
                placeholder="예: 조사, 문맥, 접속 표현…"
                {...register('tagsText')}
              />
            </div>
          </section>
        </fieldset>

        <div className="sticky bottom-0 z-20 -mx-4 flex flex-col-reverse gap-3 border-t border-line bg-white/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:rounded-xl sm:border sm:px-5">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            to={cancelHref}
          >
            목록으로 돌아가기
          </Link>
          <Button
            type="submit"
            isLoading={isSubmitting || isFormSubmitting}
            loadingLabel={submittingLabel}
          >
            {submitLabel}
          </Button>
        </div>
      </form>

      <Dialog
        open={blocker.state === 'blocked'}
        title="작성 중인 내용을 나가시겠습니까?"
        description="저장하지 않은 변경사항은 복구할 수 없습니다."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (blocker.state === 'blocked') {
                  blocker.reset()
                }
              }}
            >
              계속 작성
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (blocker.state === 'blocked') {
                  blocker.proceed()
                }
              }}
            >
              변경사항 버리기
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') {
            blocker.reset()
          }
        }}
      />
    </>
  )
}
