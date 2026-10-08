import { cachedSessionStorage } from '@libs/storage'
import {
  parseStudyDraftWorkingCopy,
  studyDraftWorkingCopySchema,
  type StudyDraftWorkingCopy
} from '@app/practice/draft/studyDraftWorkingCopy'

const STORAGE_KEY_PREFIX = 'jlpt-drill-note:study-draft-working-copy:v1:'
const memoryRecords = new Map<string, StudyDraftWorkingCopy>()

export class StudyDraftWorkingCopyPersistenceError extends Error {
  constructor() {
    super('이 탭의 학습 작업을 안전하게 저장하지 못했습니다.')
    this.name = 'StudyDraftWorkingCopyPersistenceError'
  }
}

export const getStudyDraftWorkingCopyStorageKey = (
  principalScope: string,
  sessionId: string
): string =>
  `${STORAGE_KEY_PREFIX}${encodeURIComponent(principalScope)}:${encodeURIComponent(sessionId)}`

export const readStudyDraftWorkingCopy = (
  principalScope: string,
  sessionId: string
): StudyDraftWorkingCopy | null => {
  const key = getStudyDraftWorkingCopyStorageKey(principalScope, sessionId)
  const cached = memoryRecords.get(key)
  if (cached) {
    return cached
  }

  const serialized = cachedSessionStorage.getItem(key)
  if (!serialized) {
    return null
  }

  try {
    const parsedValue: unknown = JSON.parse(serialized)
    const record = parseStudyDraftWorkingCopy(parsedValue, {
      principalScope,
      sessionId
    })
    if (!record) {
      cachedSessionStorage.removeItem(key)
      return null
    }
    memoryRecords.set(key, record)
    return record
  } catch {
    cachedSessionStorage.removeItem(key)
    return null
  }
}

export const writeStudyDraftWorkingCopy = (
  record: StudyDraftWorkingCopy
): StudyDraftWorkingCopy => {
  const shapeChecked = studyDraftWorkingCopySchema.parse(record)
  const parsed = parseStudyDraftWorkingCopy(shapeChecked, {
    principalScope: shapeChecked.principalScope,
    sessionId: shapeChecked.sessionId
  })
  if (!parsed) {
    throw new StudyDraftWorkingCopyPersistenceError()
  }
  const key = getStudyDraftWorkingCopyStorageKey(
    parsed.principalScope,
    parsed.sessionId
  )
  const serialized = JSON.stringify(parsed)

  if (!cachedSessionStorage.setItem(key, serialized)) {
    throw new StudyDraftWorkingCopyPersistenceError()
  }

  memoryRecords.set(key, parsed)
  return parsed
}

export const clearStudyDraftWorkingCopy = (
  principalScope: string,
  sessionId: string
): void => {
  const key = getStudyDraftWorkingCopyStorageKey(principalScope, sessionId)
  memoryRecords.delete(key)
  cachedSessionStorage.removeItem(key)
}

const collectStoredKeys = (): string[] => {
  if (typeof window === 'undefined') {
    return []
  }

  const keys: string[] = []
  try {
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index)
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        keys.push(key)
      }
    }
  } catch {
    return []
  }
  return keys
}

export const clearAllStudyDraftWorkingCopies = (): void => {
  memoryRecords.clear()
  collectStoredKeys().forEach((key) => cachedSessionStorage.removeItem(key))
}

export const clearGuestStudyDraftWorkingCopies = (): void => {
  const guestPrefix = `${STORAGE_KEY_PREFIX}${encodeURIComponent('GUEST')}:`
  for (const key of [...memoryRecords.keys()]) {
    if (key.startsWith(guestPrefix)) {
      memoryRecords.delete(key)
    }
  }
  collectStoredKeys()
    .filter((key) => key.startsWith(guestPrefix))
    .forEach((key) => cachedSessionStorage.removeItem(key))
}

export const clearStudyDraftWorkingCopyMemoryCache = (): void => {
  memoryRecords.clear()
}
