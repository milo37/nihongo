import { useMutation } from '@tanstack/react-query'
import {
  assertCurrentCreateStudySessionAction,
  studySessionMutations
} from '@app/practice/queries/studySessionQueries'

export const useCreateStudySession = () => {
  return useMutation({
    ...studySessionMutations.createSession(),
    onSuccess: (_data, input) => {
      assertCurrentCreateStudySessionAction(input)
    }
  })
}
