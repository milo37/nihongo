export const seedStages = [
  'SEED_GENERATE',
  'MODULE_READY',
  'TARGET_READY',
  'ROLE_READY',
  'OWNER_READY',
  'CATALOG_READY',
  'LOOKUP_DONE',
  'WRITE_CALLBACK_DONE',
  'TRANSACTION_DONE',
  'DONE'
] as const
export type SeedStage = (typeof seedStages)[number]
const ids = [
  'UNKNOWN_REDACTED',
  'REVIEW_HASH',
  'IDENTITY',
  'MIGRATION_ROLE',
  'OWNER_ROLE',
  'RESTORE_ROLE',
  'CATALOG_DIGEST',
  'CATALOG_COUNT'
] as const
const conditions: Readonly<Record<string, (typeof ids)[number]>> = {
  'Question content changed without an updated editorial review record.':
    'REVIEW_HASH',
  'Question seed identity invariant failed.': 'IDENTITY',
  'Phase 7 seed migration role attestation failed.': 'MIGRATION_ROLE',
  'Phase 7 seed owner role attestation failed.': 'OWNER_ROLE',
  'Phase 7 seed role boundary did not close.': 'RESTORE_ROLE'
}
// adapter-pg convertDriverError emits originalCode/originalMessage;
// DriverAdapterError stores that payload on cause. Inspect data properties only.
const ownData = (value: unknown, key: string): unknown => {
  if (!value || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}
const readSeedDatabaseFailure = (
  error: unknown
): {
  diagnosticId: 'CATALOG_DIGEST' | 'CATALOG_COUNT' | undefined
  sqlstate: '23514' | undefined
} => {
  let sqlstate: '23514' | undefined
  const result = () => ({ diagnosticId: undefined, sqlstate })
  let current = error
  const seen = new Set<unknown>()
  const take = (value: unknown): boolean => {
    if (
      !value ||
      typeof value !== 'object' ||
      seen.has(value) ||
      seen.size >= 4
    )
      return false
    seen.add(value)
    return true
  }
  while (take(current)) {
    for (const [codeKey, messageKey] of [
      ['originalCode', 'originalMessage'],
      ['code', 'message']
    ] as const) {
      if (ownData(current, codeKey) !== '23514') continue
      sqlstate = '23514'
      const message = ownData(current, messageKey)
      if (message === 'SYSTEM_SEED reviewed mapping digest drifted.')
        return { diagnosticId: 'CATALOG_DIGEST', sqlstate }
      if (
        message ===
        'SYSTEM_SEED may only commit the canonical 65-question catalog.'
      )
        return { diagnosticId: 'CATALOG_COUNT', sqlstate }
    }
    // Prisma's fixed wrapper path; never enumerate arbitrary metadata.
    const meta = ownData(current, 'meta')
    if (meta !== undefined) {
      if (!take(meta)) return result()
      const adapterError = ownData(meta, 'driverAdapterError')
      if (!take(adapterError)) return result()
      current = ownData(adapterError, 'cause')
    } else current = ownData(current, 'cause')
  }
  return result()
}
export const getSeedFailureSqlState = (error: unknown): '23514' | undefined =>
  readSeedDatabaseFailure(error).sqlstate
export const classifySeedFailure = (error: unknown): (typeof ids)[number] => {
  const { diagnosticId } = readSeedDatabaseFailure(error)
  if (diagnosticId) return diagnosticId
  if (!(error instanceof Error)) return 'UNKNOWN_REDACTED'
  const message = ownData(error, 'message')
  return typeof message === 'string' && Object.hasOwn(conditions, message)
    ? conditions[message]!
    : 'UNKNOWN_REDACTED'
}
let lastStage: SeedStage = 'SEED_GENERATE'
export const getLastSeedStage = (): SeedStage => lastStage
export type SeedFailureKind = 'PRIMARY_FAILURE' | 'CLEANUP_FAILURE'
export const writeSeedDiagnostic = (
  stage: SeedStage,
  error?: unknown,
  failureKind?: SeedFailureKind
) => {
  lastStage = stage
  process.stdout.write(
    JSON.stringify({
      seedDiagnostic: 1,
      stage,
      ...(failureKind ? { failureKind } : {}),
      ...(error === undefined
        ? {}
        : {
            diagnosticId: classifySeedFailure(error),
            ...(getSeedFailureSqlState(error) === undefined
              ? {}
              : { sqlstate: getSeedFailureSqlState(error) })
          })
    }) + '\n'
  )
}
export const sanitizeSeedLine = (line: string): string | null => {
  if (line.length > 512) return null
  try {
    const v: unknown = JSON.parse(line)
    if (!v || typeof v !== 'object') return null
    const x = v as Record<string, unknown>
    if (x.seedDiagnostic !== 1 || !seedStages.some((s) => s === x.stage))
      return null
    if (
      x.diagnosticId !== undefined &&
      !ids.some((id) => id === x.diagnosticId)
    )
      return null
    if (
      x.failureKind !== undefined &&
      x.failureKind !== 'PRIMARY_FAILURE' &&
      x.failureKind !== 'CLEANUP_FAILURE'
    )
      return null
    if (x.sqlstate !== undefined && x.sqlstate !== '23514') return null
    return JSON.stringify({
      seedDiagnostic: 1,
      stage: x.stage,
      ...(x.failureKind === undefined ? {} : { failureKind: x.failureKind }),
      ...(x.diagnosticId === undefined ? {} : { diagnosticId: x.diagnosticId }),
      ...(x.sqlstate === undefined ? {} : { sqlstate: x.sqlstate })
    })
  } catch {
    return null
  }
}
