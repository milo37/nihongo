export type Phase7SeedPhase = 'FIRST_NORMAL_SEED' | 'RESEED'
export type Phase7SeedPhaseState = 'BEGIN' | 'COMPLETE' | 'FAILED'

export const runPhase7SeedExecution = async (
  phase: Phase7SeedPhase,
  command: () => Promise<void>,
  report: (phase: Phase7SeedPhase, state: Phase7SeedPhaseState) => void
): Promise<void> => {
  report(phase, 'BEGIN')
  try {
    await command()
  } catch (error: unknown) {
    report(phase, 'FAILED')
    throw error
  }
  report(phase, 'COMPLETE')
}
