import { useQuery } from '@tanstack/react-query'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { dailyQuestionQueries } from '@app/home/queries/dailyQuestionQueries'

export const useGetDailyQuestion = (level: JlptLevel) =>
  useQuery(dailyQuestionQueries.get(level))
