import { mutationOptions } from '@tanstack/react-query'
import type { UpdateTargetLevelBody } from '@nihongo/contracts/auth/update-target-level'
import { updateTargetLevel } from '@api/auth/updateTargetLevel'

export const targetLevelMutations = {
  update: () =>
    mutationOptions({
      mutationKey: ['target-level', 'update'] as const,
      retry: false,
      mutationFn: (input: UpdateTargetLevelBody) => updateTargetLevel(input)
    })
}
