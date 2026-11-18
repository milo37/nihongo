import { useOnboardingCheck } from '@app/login/hooks/useOnboardingCheck'

/** Renders nothing; sends a member to the study goal page once if due. */
export const OnboardingCheckRunner = (): null => {
  useOnboardingCheck()
  return null
}
