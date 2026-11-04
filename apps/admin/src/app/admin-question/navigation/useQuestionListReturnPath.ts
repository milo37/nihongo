import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import { useSearchParams } from 'react-router'

/** Admin-relative question list path to return to, from a safe `returnTo`. */
export const useQuestionListReturnPath = (): string => {
  const [searchParams] = useSearchParams()
  const safeReturn = safeSsoReturnPath(searchParams.get('returnTo'))
  return safeReturn.split('?')[0] === '/admin/questions'
    ? safeReturn.slice('/admin'.length)
    : '/questions'
}
