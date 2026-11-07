import {
  questionVersionStatusSchema,
  type QuestionVersionStatus
} from '@nihongo/contracts/admin/content-operations'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { FormEvent } from 'react'
import type {
  JlptLevel,
  QuestionDifficulty,
  QuestionSubject
} from '@nihongo/browser/common/types/domain'
import {
  LEVELS,
  QUESTION_DIFFICULTIES,
  SUBJECTS
} from '@nihongo/browser/common/types/domain'

export type AdminQuestionSort = 'UPDATED_DESC' | 'LEVEL_ASC'

export const SORTS: readonly AdminQuestionSort[] = ['UPDATED_DESC', 'LEVEL_ASC']

/** 100 lets a batch action take a whole contract-sized batch from one page. */
export const PAGE_SIZES = [20, 100] as const
export type AdminQuestionPageSize = (typeof PAGE_SIZES)[number]

const LEVEL_SET: ReadonlySet<string> = new Set(LEVELS)
const SUBJECT_SET: ReadonlySet<string> = new Set(SUBJECTS)
const STATUS_SET: ReadonlySet<string> = new Set(
  questionVersionStatusSchema.options
)
const DIFFICULTY_SET: ReadonlySet<string> = new Set(QUESTION_DIFFICULTIES)
const SORT_SET: ReadonlySet<string> = new Set(SORTS)

const isJlptLevel = (value: string | null): value is JlptLevel => {
  return value !== null && LEVEL_SET.has(value)
}

const isQuestionSubject = (value: string | null): value is QuestionSubject => {
  return value !== null && SUBJECT_SET.has(value)
}

const isQuestionStatus = (
  value: string | null
): value is QuestionVersionStatus => {
  return value !== null && STATUS_SET.has(value)
}

const isQuestionDifficulty = (
  value: string | null
): value is QuestionDifficulty => {
  return value !== null && DIFFICULTY_SET.has(value)
}

const isAdminQuestionSort = (
  value: string | null
): value is AdminQuestionSort => {
  return value !== null && SORT_SET.has(value)
}

const parsePositiveInteger = (value: string | null): number => {
  const parsedValue = Number(value)
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 1
}

/** Question list filters, sort and page read from and written to the URL. */
export const useQuestionListSearch = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [unsupportedSort] = useState(
    () => searchParams.get('sort') === 'STATUS'
  )
  const search = searchParams.get('search')?.trim() ?? ''
  const rawLevel = searchParams.get('level')
  const rawSubject = searchParams.get('subject')
  const rawStatus = searchParams.get('status')
  const rawDifficulty = searchParams.get('difficulty')
  const rawSort = searchParams.get('sort')
  const level = isJlptLevel(rawLevel) ? rawLevel : undefined
  const subject = isQuestionSubject(rawSubject) ? rawSubject : undefined
  const status = isQuestionStatus(rawStatus) ? rawStatus : undefined
  const difficulty = isQuestionDifficulty(rawDifficulty)
    ? rawDifficulty
    : undefined
  const sort = isAdminQuestionSort(rawSort)
    ? rawSort
    : rawSort === 'LEVEL'
      ? 'LEVEL_ASC'
      : 'UPDATED_DESC'
  const page = parsePositiveInteger(searchParams.get('page'))
  const pageSize: AdminQuestionPageSize =
    searchParams.get('pageSize') === '100' ? 100 : 20
  const hasActiveFilters = Boolean(
    search ||
      level ||
      subject ||
      status ||
      difficulty ||
      sort !== 'UPDATED_DESC'
  )

  useEffect(() => {
    if (!rawSort || isAdminQuestionSort(rawSort)) return
    const next = new URLSearchParams(searchParams)
    if (rawSort === 'LEVEL') next.set('sort', 'LEVEL_ASC')
    else next.delete('sort')
    if (rawSort !== 'LEVEL' && rawSort !== 'RECENT') next.delete('page')
    setSearchParams(next, { replace: true })
  }, [rawSort, searchParams, setSearchParams])

  const setFilter = (key: string, value: string): void => {
    const nextParams = new URLSearchParams(searchParams)

    if (
      value.length === 0 ||
      (key === 'sort' && value === 'UPDATED_DESC') ||
      (key === 'pageSize' && value === '20')
    ) {
      nextParams.delete(key)
    } else {
      nextParams.set(key, value)
    }

    if (key !== 'page') {
      nextParams.delete('page')
    }

    setSearchParams(nextParams)
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nextSearch = String(formData.get('search') ?? '').trim()
    setFilter('search', nextSearch)
  }

  return {
    search,
    level,
    subject,
    status,
    difficulty,
    sort,
    page,
    pageSize,
    unsupportedSort,
    hasActiveFilters,
    searchParams,
    setSearchParams,
    setFilter,
    handleSearch,
    resetFilters: () => setSearchParams({})
  }
}
