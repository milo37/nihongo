import {
  createBookmarkErrorSchema,
  createBookmarkResponseSchema
} from '@nihongo/contracts/bookmark/create-bookmark'
import { deleteBookmarkErrorSchema } from '@nihongo/contracts/bookmark/delete-bookmark'
import {
  listBookmarksErrorSchema,
  listBookmarksResponseSchema
} from '@nihongo/contracts/bookmark/list-bookmarks'
import { describe, expect, it, vi } from 'vitest'
import { getContractQuestionId } from '@mocks/adapters/questionContractAdapter'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const BASE_URL = 'http://localhost/api/v1/bookmarks'
const SOURCE_QUESTION_ID = 'n5-vocabulary-01'
const QUESTION_ID = getContractQuestionId(SOURCE_QUESTION_ID)
const writeHeaders = {
  'Content-Type': 'application/json',
  Origin: 'http://localhost'
}

describe('canonical bookmark MSW handlers', () => {
  it('guest list/create/delete를 401로 닫고 cookie나 row를 만들지 않는다', async () => {
    const responses = await Promise.all([
      fetch(`${BASE_URL}?page=1&pageSize=20`),
      fetch(`${BASE_URL}/${QUESTION_ID}`, {
        method: 'PUT',
        headers: writeHeaders,
        body: '{}'
      }),
      fetch(`${BASE_URL}/${QUESTION_ID}`, {
        method: 'DELETE',
        headers: { Origin: 'http://localhost' }
      })
    ])

    expect(
      listBookmarksErrorSchema.parse(await responses[0]?.json()).code
    ).toBe('AUTHENTICATION_REQUIRED')
    expect(
      createBookmarkErrorSchema.parse(await responses[1]?.json()).code
    ).toBe('AUTHENTICATION_REQUIRED')
    expect(
      deleteBookmarkErrorSchema.parse(await responses[2]?.json()).code
    ).toBe('AUTHENTICATION_REQUIRED')
    responses.forEach((response) => {
      expect(response.status).toBe(401)
      expect(response.headers.get('Set-Cookie')).toBeNull()
    })
  })

  it('PUT 201→200과 single/repeated questionIds list를 canonical headers로 제공한다', async () => {
    mockDatabase.loginAs('USER')
    const put = () =>
      fetch(`${BASE_URL}/${QUESTION_ID}`, {
        method: 'PUT',
        headers: writeHeaders,
        body: '{}'
      })

    const created = await put()
    const createdBody = createBookmarkResponseSchema.parse(await created.json())
    const existing = await put()
    const existingBody = createBookmarkResponseSchema.parse(
      await existing.json()
    )
    const [single, repeated] = await Promise.all([
      fetch(`${BASE_URL}?page=1&pageSize=20&questionIds=${QUESTION_ID}`),
      fetch(
        `${BASE_URL}?page=1&pageSize=20&questionIds=${QUESTION_ID}&questionIds=${crypto.randomUUID()}`
      )
    ])

    expect(created.status).toBe(201)
    expect(existing.status).toBe(200)
    expect(existingBody).toEqual(createdBody)
    expect(created.headers.get('Location')).toBe(
      `/api/v1/bookmarks/${QUESTION_ID}`
    )
    expect(created.headers.get('Cache-Control')).toBe('private, no-store')
    expect(created.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/u)
    expect(
      listBookmarksResponseSchema.parse(await single.json())
    ).toMatchObject({ items: [{ questionId: QUESTION_ID }], total: 1 })
    expect(
      listBookmarksResponseSchema.parse(await repeated.json())
    ).toMatchObject({ items: [{ questionId: QUESTION_ID }], total: 1 })
  })

  it('Question archive 뒤에도 Bookmark와 safe summary를 ARCHIVED로 보존한다', async () => {
    mockDatabase.loginAs('USER')
    await fetch(`${BASE_URL}/${QUESTION_ID}`, {
      method: 'PUT',
      headers: writeHeaders,
      body: '{}'
    })

    expect(mockDatabase.deleteQuestion(SOURCE_QUESTION_ID)).toBe(true)
    const response = await fetch(`${BASE_URL}?page=1&pageSize=20`)
    const body = listBookmarksResponseSchema.parse(await response.json())

    expect(body.items).toEqual([
      expect.objectContaining({
        questionId: QUESTION_ID,
        availability: 'ARCHIVED'
      })
    ])
    expect(JSON.stringify(body)).not.toMatch(
      /correctOptionId|explanationKo|explanationJa|isCorrect/u
    )
  })

  it('published→draft 편집 중에는 마지막 공개 summary만 ARCHIVED로 노출한다', async () => {
    mockDatabase.loginAs('USER')
    const created = await fetch(`${BASE_URL}/${QUESTION_ID}`, {
      method: 'PUT',
      headers: writeHeaders,
      body: '{}'
    })
    const original = createBookmarkResponseSchema.parse(await created.json())
    const source = mockDatabase.getAdminQuestion(SOURCE_QUESTION_ID)
    const correctOption = source.options.find(({ isCorrect }) => isCorrect)
    if (!correctOption) {
      throw new Error('Bookmark archive fixture의 정답이 필요합니다.')
    }

    mockDatabase.updateQuestion(SOURCE_QUESTION_ID, {
      level: source.level,
      subject: source.subject,
      questionType: source.questionType,
      passage: source.passage,
      questionText: '아직 공개되지 않은 편집 내용',
      options: source.options.map(({ id, label, text }) => ({
        id,
        label,
        text
      })),
      correctOptionId: correctOption.id,
      explanationKo: '비공개 해설',
      explanationJa: source.explanationJa,
      difficulty: source.difficulty,
      tags: source.tags,
      status: 'DRAFT'
    })

    const response = await fetch(`${BASE_URL}?page=1&pageSize=20`)
    const body = listBookmarksResponseSchema.parse(await response.json())

    expect(body.items).toEqual([
      {
        ...original,
        availability: 'ARCHIVED'
      }
    ])
    expect(JSON.stringify(body)).not.toContain('아직 공개되지 않은 편집 내용')
    expect(JSON.stringify(body)).not.toContain('비공개 해설')
  })

  it('DELETE는 반복 호출 모두 body/Content-Type 없는 204로 수렴한다', async () => {
    mockDatabase.loginAs('USER')
    await fetch(`${BASE_URL}/${QUESTION_ID}`, {
      method: 'PUT',
      headers: writeHeaders,
      body: '{}'
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${BASE_URL}/${QUESTION_ID}`, {
        method: 'DELETE',
        headers: { Origin: 'http://localhost' }
      })
      expect(response.status).toBe(204)
      expect(response.headers.get('Content-Type')).toBeNull()
      expect(await response.text()).toBe('')
    }
  })

  it('strict body, duplicate query, oversized body, invalid ID와 origin을 parity 오류로 닫는다', async () => {
    mockDatabase.loginAs('USER')
    const [strict, duplicate, oversized, invalidId, untrusted] =
      await Promise.all([
        fetch(`${BASE_URL}/${QUESTION_ID}`, {
          method: 'PUT',
          headers: writeHeaders,
          body: JSON.stringify({ extra: true })
        }),
        fetch(
          `${BASE_URL}?page=1&pageSize=20&questionIds=${QUESTION_ID}&questionIds=${QUESTION_ID}`
        ),
        fetch(`${BASE_URL}/${QUESTION_ID}`, {
          method: 'PUT',
          headers: writeHeaders,
          body: `${' '.repeat(16 * 1_024)}{}`
        }),
        fetch(`${BASE_URL}/not-an-id`, {
          method: 'DELETE',
          headers: { Origin: 'http://localhost' }
        }),
        fetch(`${BASE_URL}/${QUESTION_ID}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://evil.example'
          },
          body: '{}'
        })
      ])

    expect(createBookmarkErrorSchema.parse(await strict.json()).code).toBe(
      'INVALID_REQUEST'
    )
    expect(listBookmarksErrorSchema.parse(await duplicate.json()).code).toBe(
      'VALIDATION_ERROR'
    )
    expect(createBookmarkErrorSchema.parse(await oversized.json()).code).toBe(
      'INVALID_REQUEST'
    )
    expect(deleteBookmarkErrorSchema.parse(await invalidId.json()).code).toBe(
      'INVALID_ID'
    )
    expect(createBookmarkErrorSchema.parse(await untrusted.json()).code).toBe(
      'UNTRUSTED_ORIGIN'
    )
  })

  it('unexpected persistence error의 내부 message를 500 body에서 숨긴다', async () => {
    mockDatabase.loginAs('USER')
    const secret = 'bookmark-secret-detail'
    vi.spyOn(mockDatabase, 'createCanonicalBookmark').mockImplementationOnce(
      () => {
        throw new MockDatabaseError('PERSISTENCE_FAILED', 500, secret)
      }
    )

    const response = await fetch(`${BASE_URL}/${QUESTION_ID}`, {
      method: 'PUT',
      headers: writeHeaders,
      body: '{}'
    })
    const body = createBookmarkErrorSchema.parse(await response.json())

    expect(response.status).toBe(500)
    expect(body).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      retryable: true
    })
    expect(body.message).not.toContain(secret)
  })
})
