import type { PracticeCompatibilityAuthorityHandle } from '../config/practiceCompatibilityAuthority.js'

type PracticeContractRuntime = 'v1-v2' | 'v1-compatible'

interface CreatePracticeRuntimeGateOptions {
  runtime: PracticeContractRuntime
  authority?: PracticeCompatibilityAuthorityHandle
  checkDatabaseReadiness: () => Promise<void>
  checkV1Compatibility: () => Promise<void>
}

export interface PracticeRuntimeGate {
  practiceContractV2Enabled: boolean
  assertRequestAuthority: () => Promise<void>
  checkReadiness: () => Promise<void>
}

export class PracticeRuntimeGateConfigurationError extends Error {
  constructor() {
    super('Practice runtime gate configuration is invalid.')
    this.name = 'PracticeRuntimeGateConfigurationError'
  }
}

export const createPracticeRuntimeGate = ({
  runtime,
  authority,
  checkDatabaseReadiness,
  checkV1Compatibility
}: CreatePracticeRuntimeGateOptions): PracticeRuntimeGate => {
  if (
    (runtime === 'v1-compatible' && !authority) ||
    (runtime === 'v1-v2' && authority)
  ) {
    throw new PracticeRuntimeGateConfigurationError()
  }

  if (runtime === 'v1-v2') {
    return {
      practiceContractV2Enabled: true,
      assertRequestAuthority: async () => undefined,
      checkReadiness: checkDatabaseReadiness
    }
  }

  const compatibilityAuthority = authority
  if (!compatibilityAuthority) {
    throw new PracticeRuntimeGateConfigurationError()
  }

  const assertRequestAuthority = async (): Promise<void> => {
    compatibilityAuthority.assertValid()
    await checkV1Compatibility()
    compatibilityAuthority.assertValid()
  }

  return {
    practiceContractV2Enabled: false,
    assertRequestAuthority,
    checkReadiness: async () => {
      await checkDatabaseReadiness()
      await assertRequestAuthority()
    }
  }
}
