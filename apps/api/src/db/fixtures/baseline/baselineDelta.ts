import type { SchemaCatalog } from '../schemaCatalog.js'

/**
 * The only differences the single baseline (#504 P8-1) may have from the
 * schema the 76 migrations up to 20261122090000_trusted_execution_drop built
 * (schema76.catalog.json, captured from a fresh TEST schema before the
 * migrations were replaced).
 */

/** The legacy issuer, V1 activation/retirement and approved tag commands. */
export const EXCLUDED_FUNCTIONS = [
  'phase7_activate_v1_issuer',
  'phase7_retire_v1_sessions',
  'phase7_revoke_legacy_database_connect',
  'guard_phase7_legacy_auth_write',
  'protect_phase7_auth_issuer_activation',
  'phase7_register_database_capability',
  'apply_phase7_approved308_tags',
  'apply_phase7_approved_reading_tags',
  'apply_phase7_approved_n3_reading_tags',
  'apply_phase7_approved_n4_n2_reading_tags',
  'apply_phase7_approved_n4_reading_batch7_tags',
  'register_phase7_approved308_tag_rows',
  'register_phase7_approved_reading_tag_rows',
  'register_phase7_approved_n3_reading_tag_rows',
  'register_phase7_approved_n4_n2_reading_tag_rows',
  'register_phase7_approved_n4_reading_batch7_tag_rows',
  'protect_phase7_approved308_tag_registration',
  'protect_phase7_approved_reading_tag_registration',
  'protect_phase7_approved_n3_reading_tag_registration',
  'protect_phase7_approved_n4_n2_reading_tag_registration',
  'protect_phase7_approved_n4_reading_batch7_tag_registration',
  // Functions no caller used.
  'phase7_active_authorization_session',
  'phase7_create_sso_transaction',
  'phase7_consume_sso_transaction',
  'phase7_credential_account_exists',
  'phase7_question_version_audit_snapshot',
  'phase7_question_version_changed_fields',
  'validate_active_admin_creator',
  'validate_current_published_version'
] as const

export const EXCLUDED_TABLES = [
  'AuthIssuerActivation',
  'Phase7Approved308TagRegistration',
  'Phase7ApprovedReadingTagRegistration',
  'Phase7ApprovedN3ReadingTagRegistration',
  'Phase7ApprovedN4N2ReadingTagRegistration',
  'Phase7ApprovedN4ReadingBatch7TagRegistration'
] as const

/** Roles the baseline grants nothing: the former runtime and legacy logins. */
export const REMOVED_ROLES = [
  'nihongo_auth_gateway',
  'nihongo_erasure_worker',
  'nihongo_test_legacy_app_login',
  'nihongo_development_legacy_app_login'
] as const

/**
 * Functions whose bodies change beyond the renames: the legacy issuer and
 * V1 activation branches are gone, and require_runtime_ready accepts
 * nihongo_app only.
 */
export const LEGACY_BRANCH_FUNCTIONS = [
  'phase7_require_runtime_ready',
  'phase7_bootstrap_first_google_admin',
  'protect_phase7_account',
  'validate_phase7_credential_totality',
  'validate_phase7_session_write',
  'validate_phase7_verification_write'
] as const

/** Only the phase7 token of an identifier goes (the name map of #504 P8-1). */
export const renameBaselineIdentifier = (value: string): string =>
  value
    .replace(/Phase7(?=[A-Z])/gu, '')
    .replace(/_phase7_/gu, '_')
    .replace(/\bphase7_/gu, '')
    .replace(
      'nihongo-phase7-tag-assignment-scope-v1',
      'nihongo-tag-assignment-scope-v1'
    )

const removedAcl = new RegExp(
  `(?:^|,)"?(?:${REMOVED_ROLES.join('|')})"?=[^,}]*`,
  'gu'
)

const transformAcl = (value: unknown): unknown =>
  typeof value === 'string'
    ? renameBaselineIdentifier(value.replace(removedAcl, '')).replace(
        '{,',
        '{'
      )
    : value

const transformValue = (key: string, value: unknown): unknown => {
  if (key === 'acl') return transformAcl(value)
  if (typeof value === 'string') return renameBaselineIdentifier(value)
  if (Array.isArray(value))
    return value.map((item) =>
      typeof item === 'string' ? renameBaselineIdentifier(item) : item
    )
  return value
}

const transformRow = (
  row: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, transformValue(key, value)])
  )

const excludedTables = new Set<string>(EXCLUDED_TABLES)
const excludedFunctions = new Set<string>(EXCLUDED_FUNCTIONS)
const legacyBranchFunctions = new Set<string>(
  LEGACY_BRANCH_FUNCTIONS.map(renameBaselineIdentifier)
)

/** The 76-migration catalog with exactly the baseline exclusions and renames. */
export const expectedBaselineCatalog = (
  snapshot: SchemaCatalog
): SchemaCatalog => ({
  types: snapshot.types.map(transformRow),
  tables: snapshot.tables
    .filter((row) => !excludedTables.has(String(row.name)))
    .map(transformRow),
  columns: snapshot.columns
    .filter((row) => !excludedTables.has(String(row.table)))
    .map(transformRow),
  constraints: snapshot.constraints
    .filter((row) => !excludedTables.has(String(row.table)))
    .map(transformRow)
    // The catalog strips whitespace, so a CHECK's function name has no word
    // boundary before its phase7 token.
    .map((row) => ({
      ...row,
      definition: String(row.definition).replace(/phase7_/gu, '')
    })),
  indexes: snapshot.indexes
    .filter((row) => !excludedTables.has(String(row.table)))
    .map(transformRow),
  functions: snapshot.functions
    .filter((row) => !excludedFunctions.has(String(row.name)))
    .map(transformRow),
  triggers: snapshot.triggers
    .filter(
      (row) =>
        !excludedTables.has(String(row.table)) &&
        ![...excludedFunctions].some((name) =>
          new RegExp(`EXECUTE FUNCTION (?:\\$SCHEMA\\.)?"?${name}"?\\(`, 'u').test(
            String(row.definition)
          )
        )
    )
    .map(transformRow),
  schemaAcl: transformAcl(snapshot.schemaAcl) as string | null
})

// A CHECK re-read from pg_dump text prints an ANY(ARRAY[...]) text cast on
// each element instead of on the array; both forms compare the same values.
const comparableCheck = (definition: unknown): string =>
  String(definition)
    .replace(/::charactervarying::text/gu, '::charactervarying')
    .replace(/\]::text\[\]/gu, ']')

const sorted = (
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> =>
  rows
    .map((row) => [JSON.stringify(row), row] as const)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => row)

/**
 * Compares bodies except the functions whose legacy branches are removed,
 * CHECKs modulo their deparse form, and rows regardless of name order (the
 * renames change it).
 */
export const withoutLegacyBranchSources = (
  catalog: SchemaCatalog
): SchemaCatalog => ({
  types: sorted(catalog.types),
  tables: sorted(catalog.tables),
  columns: sorted(catalog.columns),
  constraints: sorted(
    catalog.constraints.map((row) => ({
      ...row,
      definition: comparableCheck(row.definition)
    }))
  ),
  indexes: sorted(catalog.indexes),
  functions: sorted(
    catalog.functions.map((row) =>
      legacyBranchFunctions.has(String(row.name))
        ? { ...row, source: '(legacy branches removed)' }
        : row
    )
  ),
  triggers: sorted(catalog.triggers),
  schemaAcl: catalog.schemaAcl
})
