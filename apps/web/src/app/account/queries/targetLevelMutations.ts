import { mutationOptions } from '@tanstack/react-query'
import type { UpdateTargetLevelBody } from '@nihongo/contracts/auth/update-target-level'
import { updateTargetLevel } from '@api/auth/updateTargetLevel'

export const targetLevelMutations = {
  update: () =>
    mutationOptions({
      mutationKey: ['target-level', 'update'] as const,
      retry: false,
      // JLP-861: the select's own error line is the only failure message;
      // auth failures still reach the shared handler.
      meta: { localErrorUi: true },
      mutationFn: (input: UpdateTargetLevelBody) => updateTargetLevel(input)
    })
}
