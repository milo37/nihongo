import type { SchemaCatalog } from '../schemaCatalog.js'

/**
 * The only differences the single baseline (#504 P8-1) may have from the
 * schema the 76 migrations up to 20261122090000_trusted_execution_drop built
 * (schema76.catalog.json, captured from a fresh TEST schema before the
 * migrations were replaced).
 */

/** The legacy issuer, V1 activation/retirement and approved tag commands. */
const EXCLUDED_FUNCTIONS = [
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

const EXCLUDED_TABLES = [
  'AuthIssuerActivation',
  'Phase7Approved308TagRegistration',
  'Phase7ApprovedReadingTagRegistration',
  'Phase7ApprovedN3ReadingTagRegistration',
  'Phase7ApprovedN4N2ReadingTagRegistration',
  'Phase7ApprovedN4ReadingBatch7TagRegistration'
] as const

/** Roles the baseline grants nothing: the former runtime and legacy logins. */
const REMOVED_ROLES = [
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
const LEGACY_BRANCH_FUNCTIONS = [
  'phase7_require_runtime_ready',
  'phase7_bootstrap_first_google_admin',
  'protect_phase7_account',
  'validate_phase7_credential_totality',
  'validate_phase7_session_write',
  'validate_phase7_verification_write'
] as const

/** Only the phase7 token of an identifier goes (the name map of #504 P8-1). */
const renameBaselineIdentifier = (value: string): string =>
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
    ? renameBaselineIdentifier(value.replace(removedAcl, '')).replace('{,', '{')
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

const transformRow = (row: Record<string, unknown>): Record<string, unknown> =>
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
          new RegExp(
            `EXECUTE FUNCTION (?:\\$SCHEMA\\.)?"?${name}"?\\(`,
            'u'
          ).test(String(row.definition))
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

/**
 * The forward migrations 20261106090000_remove_phase_names (#504 P8-2) and
 * 20261107090000_first_admin_production (JLP-725): the functions they replace
 * and the only strings their bodies may change.
 */
const FORWARD_FUNCTIONS = [
  'bootstrap_first_google_admin',
  'limit_operation_intent_delete',
  'classify_admin_authority',
  'consume_sso_transaction_v2',
  'create_sso_transaction_v2',
  'record_authority_revocation',
  'require_caller_role',
  'require_database_capability',
  'require_runtime_ready',
  'resolve_sso_identity',
  'protect_evidence_history',
  'reject_unfinished_operation',
  'validate_question_version_content',
  'validate_session_write'
] as const

const FORWARD_SOURCE_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "'Phase 7 operation intent belongs to another transaction.'",
    "'Operation intent belongs to another transaction.'"
  ],
  [
    "'Phase 7 operation was not verified and consumed.'",
    "'Operation was not verified and consumed.'"
  ],
  ["'Phase 7 evidence is append-only.'", "'Evidence is append-only.'"],
  [
    "'Phase 7 evidence delete is forbidden.'",
    "'Evidence delete is forbidden.'"
  ],
  [
    "'Caller role % is not a Phase 7 runtime role.'",
    "'Caller role % is not a runtime role.'"
  ],
  [
    "'Phase 7 runtime requires session_replication_role=origin.'",
    "'Runtime requires session_replication_role=origin.'"
  ],
  [
    "'Phase 7 database capability is absent or stale.'",
    "'Database capability is absent or stale.'"
  ],
  [
    "'Phase 7 facades require session_replication_role=origin.'",
    "'Facades require session_replication_role=origin.'"
  ],
  [
    "'PHASE7_V1 Session requires the owned issuer.'",
    "'OWNED_V1 Session requires the owned issuer.'"
  ],
  ["'PHASE7_V1'", "'OWNED_V1'"],
  [
    `PERFORM "require_caller_role"('nihongo_auth_gateway');`,
    `PERFORM "require_caller_role"('nihongo_app');`
  ],
  [
    `  IF effective_caller IS DISTINCT FROM required_role
    AND NOT (
      effective_caller = 'nihongo_app'
      AND required_role IN ('nihongo_auth_gateway', 'nihongo_erasure_worker')
    ) THEN`,
    '  IF effective_caller IS DISTINCT FROM required_role THEN'
  ],
  [
    `    WHEN environment_value = 'DEVELOPMENT' AND current_database() ~ '_dev$'
      THEN 'nihongo_development_migration_login'
`,
    `    WHEN environment_value = 'DEVELOPMENT' AND current_database() ~ '_dev$'
      THEN 'nihongo_development_migration_login'
    WHEN environment_value = 'PRODUCTION' AND current_database() = 'nihongo'
      THEN 'nihongo_production_migration_login'
`
  ],
  // JLP-733: the applicability lookup is the only part of
  // validate_question_version_content the forward migration removes.
  [
    `    ) OR EXISTS (
      SELECT 1 FROM "QuestionVersionTag" AS assignment
      WHERE assignment."questionVersionId" = target_version_id
        AND NOT EXISTS (
          SELECT 1 FROM "TagApplicability" AS applicability
          WHERE applicability."tagId" = assignment."tagId"
            AND applicability."level" = version_row."level"
            AND applicability."subject" = version_row."subject"
            AND applicability."questionType" = version_row."questionType"
        )
    ) OR expected_fingerprint IS NULL`,
    '    ) OR expected_fingerprint IS NULL'
  ]
]

const forwardFunctions = new Set<string>(FORWARD_FUNCTIONS)

/** JLP-733: the tag applicability table and the tag snapshot machinery. */
const DROPPED_TABLE = 'TagApplicability'
const DROPPED_SNAPSHOT_COLUMNS = new Set([
  'labelSnapshot',
  'normalizedNameSnapshot'
])
const DROPPED_FUNCTIONS = new Set([
  'copy_tag_snapshots',
  'lock_tag_assignment_scope',
  'protect_tag_applicability',
  'validate_inserted_tag_snapshots'
])
const DROPPED_TRIGGERS = new Set([
  'QuestionVersionTag_copy_snapshots',
  'QuestionVersionTag_lock_assignment_scope',
  'QuestionVersionTag_validate_inserted_snapshots',
  'Tag_lock_assignment_scope'
])
const isDroppedTagSnapshot = (row: Record<string, unknown>): boolean =>
  row.table === DROPPED_TABLE ||
  (row.table === 'QuestionVersionTag' && /[Ss]napshot/u.test(String(row.name)))

/**
 * Undoes the forward migrations' catalog changes the baseline comparison
 * cannot see: the renamed enum label, the replaced function bodies (checked
 * exactly by forwardFunctionSources against the baseline file) and the
 * objects JLP-733 drops, removed from both sides.
 */
export const withoutForwardChanges = (
  catalog: SchemaCatalog
): SchemaCatalog => ({
  ...catalog,
  types: catalog.types.map((row) =>
    Array.isArray(row.labels)
      ? {
          ...row,
          labels: row.labels.map((label) =>
            label === 'OWNED_V1' ? 'PHASE7_V1' : label
          )
        }
      : row
  ),
  tables: catalog.tables.filter(({ name }) => name !== DROPPED_TABLE),
  columns: catalog.columns.filter(
    (row) =>
      row.table !== DROPPED_TABLE &&
      !(
        row.table === 'QuestionVersionTag' &&
        DROPPED_SNAPSHOT_COLUMNS.has(String(row.name))
      )
  ),
  constraints: catalog.constraints.filter((row) => !isDroppedTagSnapshot(row)),
  indexes: catalog.indexes.filter((row) => !isDroppedTagSnapshot(row)),
  triggers: catalog.triggers.filter(
    (row) => row.table !== DROPPED_TABLE && !DROPPED_TRIGGERS.has(String(row.name))
  ),
  functions: catalog.functions
    .filter(({ name }) => !DROPPED_FUNCTIONS.has(String(name)))
    .map((row) =>
      forwardFunctions.has(String(row.name))
        ? { ...row, source: '(replaced by the forward migration)' }
        : row
    )
})

/** Each replaced body: the baseline body with exactly the forward strings. */
export const forwardFunctionSources = (
  baselineSql: string
): Record<string, string> =>
  Object.fromEntries(
    FORWARD_FUNCTIONS.map((name) => {
      const match = new RegExp(
        `^CREATE FUNCTION ${name}\\([^\\n]*\\n(?:[^\\n]*\\n)*?    AS \\$([a-z_]*)\\$\\n([\\s\\S]*?)\\$\\1\\$;$`,
        'mu'
      ).exec(baselineSql)
      if (!match?.[2]) throw new Error(`Baseline function ${name} is absent.`)
      return [
        name,
        FORWARD_SOURCE_REPLACEMENTS.reduce(
          // A replacer function keeps `$'` in a replacement literal.
          (source, [from, to]) => source.replaceAll(from, () => to),
          `\n${match[2]}`
        )
      ]
    })
  )
