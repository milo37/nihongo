import { z } from 'zod'
import type { CreateAdminQuestionRequest } from '@api/admin-question/createAdminQuestion/schema'
import {
  createAdminQuestionRequestSchema,
  countUnicodeScalars,
  isWellFormedContentText,
  normalizeContentText,
  type PreviewQuestionVersionResponse
} from '@nihongo/contracts/admin/content-operations'
import {
  LEVELS,
  OPTION_LABELS,
  QUESTION_DIFFICULTIES,
  QUESTION_TYPES,
  SUBJECTS
} from '@nihongo/browser/common/types/domain'

const TAG_SEPARATOR_REGEX = /[,，\n]/
const OPTION_LABEL_SET: ReadonlySet<string> = new Set(OPTION_LABELS)

export const VALIDATION_KEY_PREFIX = 'editor.form.validation.'

const formOptionSchema = z
  .object({
    id: z.string().optional(),
    label: z.enum(OPTION_LABELS),
    text: z.string().trim().min(1, 'editor.form.validation.option')
  })
  .strict()

export const questionFormSchema = z
  .object({
    level: z.enum(LEVELS, { error: 'editor.form.validation.level' }),
    subject: z.enum(SUBJECTS, { error: 'editor.form.validation.subject' }),
    questionType: z.enum(QUESTION_TYPES, {
      error: 'editor.form.validation.questionType'
    }),
    passage: z.string(),
    questionText: z.string().trim().min(1, 'editor.form.validation.question'),
    options: z
      .array(formOptionSchema)
      .length(4, 'editor.form.validation.optionCount'),
    correctOptionId: z
      .string()
      .refine(
        (value) => OPTION_LABEL_SET.has(value),
        'editor.form.validation.correct'
      ),
    explanationKo: z
      .string()
      .trim()
      .min(1, 'editor.form.validation.explanationKo'),
    explanationJa: z.string(),
    difficulty: z.enum(QUESTION_DIFFICULTIES, {
      error: 'editor.form.validation.difficulty'
    }),
    tagsText: z.string().refine((value) => {
      return value
        .split(TAG_SEPARATOR_REGEX)
        .some((tag) => tag.trim().length > 0)
    }, 'editor.form.validation.tags')
  })
  .strict()
  .superRefine((value, context) => {
    if (value.subject === 'READING' && value.passage.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['passage'],
        message: 'editor.form.validation.passage'
      })
    }

    const canonical = createAdminQuestionRequestSchema.safeParse(
      toCreateContent(value)
    )
    if (!canonical.success) {
      for (const issue of canonical.error.issues) {
        const field =
          issue.path[0] === 'tagNames'
            ? 'tagsText'
            : issue.path[0] === 'correctOptionKey'
              ? 'correctOptionId'
              : issue.path[0]
        context.addIssue({
          code: 'custom',
          path:
            field === undefined
              ? []
              : field === 'tagsText'
                ? ['tagsText']
                : [field, ...issue.path.slice(1)],
          message:
            issue.code === 'custom' &&
            issue.path.length === 1 &&
            issue.path[0] === 'questionText' &&
            canonical.error.issues.filter(
              (candidate) =>
                candidate.path.length === 1 &&
                candidate.path[0] === 'questionText'
            ).length === 1 &&
            isWellFormedContentText(value.questionText) &&
            countUnicodeScalars(normalizeContentText(value.questionText)) > 2000
              ? 'editor.form.validation.questionLength'
              : issue.code === 'custom' && issue.path[0] === 'passage'
                ? value.subject === 'READING'
                  ? 'editor.form.validation.passage'
                  : 'editor.form.validation.passageNotAllowed'
                : issue.code === 'custom' && issue.path[0] === 'questionType'
                  ? 'editor.form.validation.combination'
                  : issue.message
        })
      }
    }

    const normalizedOptions = value.options
      .map((option) => option.text.trim())
      .filter((option) => option.length > 0)

    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      context.addIssue({
        code: 'custom',
        path: ['options', 'root'],
        message: 'editor.form.validation.optionDuplicate'
      })
    }
  })

export type QuestionFormValues = z.infer<typeof questionFormSchema>

export const parseTags = (value: string): string[] => {
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

export const createDefaultValues = (
  preview?: PreviewQuestionVersionResponse
): QuestionFormValues => {
  const question = preview?.question
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
      tagsText: ''
    }
  }

  const optionByLabel = new Map(
    question.options.map((option) => [option.label, option])
  )
  const correctOption = question.options.find(
    (option) => option.id === preview?.adminAnswer.correctOptionId
  )

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
    explanationKo: preview?.adminAnswer.explanationKo ?? '',
    explanationJa: preview?.adminAnswer.explanationJa ?? '',
    difficulty: question.difficulty,
    tagsText: question.tags.map((tag) => tag.label).join(', ')
  }
}

export const toCreateContent = (
  values: QuestionFormValues
): CreateAdminQuestionRequest => ({
  level: values.level,
  subject: values.subject,
  questionType: values.questionType,
  passage: values.passage.trim() || null,
  questionText: values.questionText,
  options: values.options.map((option) => ({
    clientOptionKey: option.label,
    text: option.text
  })),
  correctOptionKey: values.correctOptionId,
  explanationKo: values.explanationKo,
  explanationJa: values.explanationJa.trim() || null,
  difficulty: values.difficulty,
  tagNames: parseTags(values.tagsText)
})
