type SeedPhase = 'FIRST_NORMAL_SEED' | 'PREFIX_RESEED' | 'RESEED'
type SeedPhaseState = 'BEGIN' | 'COMPLETE' | 'FAILED'

export const runSeedExecution = async (
  phase: SeedPhase,
  command: () => Promise<void>,
  report: (phase: SeedPhase, state: SeedPhaseState) => void
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
