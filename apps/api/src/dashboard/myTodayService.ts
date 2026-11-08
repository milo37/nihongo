import {
  MY_TODAY_DAILY_GOAL,
  MY_TODAY_TIME_ZONE,
  type GetMyTodayResponse
} from '@nihongo/contracts/dashboard/get-my-today'
import { ApplicationError } from '../errors/applicationError.js'
import type { StudyDraftRepository } from '../study/studyDraftRepository.js'
import { StudySubmissionRepositoryUnavailableError } from '../study/studySubmissionRepository.js'
import {
  MyTodayRepositoryIntegrityError,
  MyTodayRepositoryUnavailableError,
  type MyTodayRepository,
  type MyTodaySnapshotRecord
} from './myTodayRepository.js'

export interface MyTodayService {
  getMyToday: (userId: string) => Promise<GetMyTodayResponse>
}

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000

const previousCalendarDay = (calendarDate: string): string =>
  new Date(Date.parse(`${calendarDate}T00:00:00.000Z`) - DAY_MILLISECONDS)
    .toISOString()
    .slice(0, 10)

/**
 * A run still counts when it ends today, or yesterday while today has no
 * submit yet. An older run is broken: the learner starts again from 0.
 */
export const toStreakDays = ({
  latestStreak,
  today
}: Pick<MyTodaySnapshotRecord, 'latestStreak' | 'today'>): number => {
  if (!latestStreak) {
    return 0
  }
  return latestStreak.lastDay === today ||
    latestStreak.lastDay === previousCalendarDay(today)
    ? latestStreak.length
    : 0
}

const throwMappedError = (error: unknown): never => {
  if (
    error instanceof MyTodayRepositoryUnavailableError ||
    error instanceof StudySubmissionRepositoryUnavailableError
  ) {
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: '오늘의 학습 저장소에 연결할 수 없습니다.',
      retryable: true,
      cause: error
    })
  }
  if (error instanceof MyTodayRepositoryIntegrityError) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '오늘의 학습 집계 무결성을 확인하지 못했습니다.',
      retryable: true,
      cause: error
    })
  }
  throw error
}

export const createMyTodayService = (
  repository: MyTodayRepository,
  draftRepository: Pick<StudyDraftRepository, 'listOwnedResumable'>,
  now?: () => Date
): MyTodayService => ({
  getMyToday: async (userId) => {
    try {
      const snapshot = await repository.readOwnedSnapshot(userId, now?.())
      const resumable = await draftRepository.listOwnedResumable(
        { kind: 'USER', userId },
        { status: 'IN_PROGRESS', page: 1, pageSize: 1 },
        snapshot.observedAt
      )
      return {
        observedAt: snapshot.observedAt.toISOString(),
        timeZone: MY_TODAY_TIME_ZONE,
        today: snapshot.today,
        streakDays: toStreakDays(snapshot),
        studiedToday: snapshot.latestStreak?.lastDay === snapshot.today,
        todayAnsweredCount: snapshot.todayAnsweredCount,
        dailyGoal: MY_TODAY_DAILY_GOAL,
        reviewDueCount: snapshot.reviewDueCount,
        latestResumableSession: resumable.items[0] ?? null
      }
    } catch (error: unknown) {
      return throwMappedError(error)
    }
  }
})
