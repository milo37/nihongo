import { randomUUID } from 'node:crypto'
import { decodeReviewEventCursor } from '@nihongo/contracts/wrong-note/list-review-events'
import { reviewCenterConformanceFixture } from '@nihongo/contracts/testing/review-center-conformance'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import {
  WrongNoteReviewCenterRepositoryIntegrityError,
  WrongNoteReviewCenterRepositoryUnavailableError,
  type ReviewEventHistoryRecord,
  type WrongNoteReviewCenterRepository
} from './wrongNoteReviewCenterRepository.js'
import { createWrongNoteReviewCenterService } from './wrongNoteReviewCenterService.js'

const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d2'
const QUESTION_ID = reviewCenterConformanceFixture.memo.questionId

const historyRecords: ReviewEventHistoryRecord[] =
  reviewCenterConformanceFixture.history.items.map((item) => ({
    ...item,
    occurredAt: new Date(item.occurredAt)
  }))

const createRepository = (): WrongNoteReviewCenterRepository => ({
  findOwnedMemo: vi.fn().mockResolvedValue({ found: true, memo: null }),
  listOwnedReviewEvents: vi.fn().mockResolvedValue({
    found: true,
    items: historyRecords
  }),
  updateOwnedMemo: vi.fn().mockResolvedValue({ found: true, memo: null })
})

describe('WrongNote review-center service', () => {
  it('memo Date를 ISO DTO로 변환하고 normalized body만 repository에 전달한다', async () => {
    const repository = createRepository()
    const memo = {
      questionId: QUESTION_ID,
      text: '川은 かわ라고 읽는다.',
      createdAt: new Date('2026-08-21T02:30:00.000Z'),
      updatedAt: new Date('2026-08-21T03:30:00.000Z')
    }
    vi.mocked(repository.findOwnedMemo).mockResolvedValue({
      found: true,
      memo
    })
    vi.mocked(repository.updateOwnedMemo).mockResolvedValue({
      found: true,
      memo
    })
    const service = createWrongNoteReviewCenterService(repository)

    await expect(service.getMemo(USER_ID, QUESTION_ID)).resolves.toEqual({
      questionId: QUESTION_ID,
      text: memo.text,
      createdAt: memo.createdAt.toISOString(),
      updatedAt: memo.updatedAt.toISOString()
    })
    await expect(
      service.updateMemo(USER_ID, QUESTION_ID, { memo: memo.text })
    ).resolves.toMatchObject({ text: memo.text })
    expect(repository.updateOwnedMemo).toHaveBeenCalledWith({
      userId: USER_ID,
      questionId: QUESTION_ID,
      memo: memo.text
    })
  })

  it('pageSize+1 batch를 visible page와 exact next cursor로 조립한다', async () => {
    const repository = createRepository()
    const extra = {
      ...historyRecords[1]!,
      id: randomUUID(),
      occurredAt: new Date('2026-08-21T00:00:00.000Z')
    }
    vi.mocked(repository.listOwnedReviewEvents).mockResolvedValue({
      found: true,
      items: [...historyRecords, extra]
    })
    const service = createWrongNoteReviewCenterService(repository)

    const response = await service.listReviewEvents(USER_ID, QUESTION_ID, {
      pageSize: 2
    })
    const last = response.items.at(-1)

    expect(response.items).toEqual(reviewCenterConformanceFixture.history.items)
    expect(last).toBeDefined()
    expect(decodeReviewEventCursor(response.nextCursor ?? '')).toEqual({
      v: 1,
      occurredAt: last?.occurredAt,
      id: last?.id
    })
    expect(repository.listOwnedReviewEvents).toHaveBeenCalledWith({
      userId: USER_ID,
      questionId: QUESTION_ID,
      cursor: null,
      limit: 3
    })
  })

  it('continuation cursor를 decode해 repository에 전달하고 final page를 닫는다', async () => {
    const repository = createRepository()
    vi.mocked(repository.listOwnedReviewEvents).mockResolvedValue({
      found: true,
      items: [historyRecords[1]!]
    })
    const service = createWrongNoteReviewCenterService(repository)

    const response = await service.listReviewEvents(USER_ID, QUESTION_ID, {
      cursor: reviewCenterConformanceFixture.nextHistoryCursor,
      pageSize: 20
    })

    expect(response.nextCursor).toBeNull()
    expect(repository.listOwnedReviewEvents).toHaveBeenCalledWith({
      userId: USER_ID,
      questionId: QUESTION_ID,
      cursor: decodeReviewEventCursor(
        reviewCenterConformanceFixture.nextHistoryCursor
      ),
      limit: 21
    })
  })

  it('owned note 없음은 memo/history/update 모두 동일한 404로 닫는다', async () => {
    const repository = createRepository()
    vi.mocked(repository.findOwnedMemo).mockResolvedValue({ found: false })
    vi.mocked(repository.updateOwnedMemo).mockResolvedValue({ found: false })
    vi.mocked(repository.listOwnedReviewEvents).mockResolvedValue({
      found: false
    })
    const service = createWrongNoteReviewCenterService(repository)

    for (const operation of [
      () => service.getMemo(USER_ID, QUESTION_ID),
      () => service.updateMemo(USER_ID, QUESTION_ID, { memo: null }),
      () => service.listReviewEvents(USER_ID, QUESTION_ID, { pageSize: 20 })
    ]) {
      await expect(operation()).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: '오답 노트를 찾을 수 없습니다.',
        retryable: false
      } satisfies Partial<ApplicationError>)
    }
  })

  it('repository unavailable/integrity를 raw cause 없이 closed 오류로 매핑한다', async () => {
    const unavailableRepository = createRepository()
    vi.mocked(unavailableRepository.findOwnedMemo).mockRejectedValue(
      new WrongNoteReviewCenterRepositoryUnavailableError({
        cause: new Error('raw memo sentinel')
      })
    )
    const integrityRepository = createRepository()
    vi.mocked(integrityRepository.listOwnedReviewEvents).mockRejectedValue(
      new WrongNoteReviewCenterRepositoryIntegrityError('raw owner sentinel')
    )

    await expect(
      createWrongNoteReviewCenterService(unavailableRepository).getMemo(
        USER_ID,
        QUESTION_ID
      )
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: '복습 센터 저장소에 연결할 수 없습니다.',
      retryable: true
    } satisfies Partial<ApplicationError>)
    await expect(
      createWrongNoteReviewCenterService(integrityRepository).listReviewEvents(
        USER_ID,
        QUESTION_ID,
        { pageSize: 20 }
      )
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '복습 센터 데이터 무결성을 확인하지 못했습니다.',
      retryable: true
    } satisfies Partial<ApplicationError>)
  })
})
