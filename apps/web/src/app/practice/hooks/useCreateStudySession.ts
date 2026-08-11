import { useMutation } from '@tanstack/react-query'
import { studyMutations } from '@app/practice/queries/studyQueries'

export const useCreateStudySession = () => {
  return useMutation(studyMutations.createSession())
}
