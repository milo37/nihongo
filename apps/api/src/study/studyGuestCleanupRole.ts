import type { PrismaClient } from '../generated/prisma/client.js'

export interface GuestCleanupRoleEvidence {
  currentRole: string
  workerIsSuperuser: boolean
  workerCanBypassRls: boolean
  workerCanCreateRoles: boolean
  workerCanCreateDatabases: boolean
  sessionIsSuperuser: boolean
  sessionCanBypassRls: boolean
  sessionCanCreateRoles: boolean
  sessionCanCreateDatabases: boolean
  sessionHasCleanupRole: boolean
  sessionHasApplicationRole: boolean
  sessionHasErasureRole: boolean
  workerCanModifyTables: boolean
  sessionCanModifyTables: boolean
  workerCanCreateInSchema: boolean
  sessionCanCreateInSchema: boolean
}

export const assertStudyGuestCleanupRole = (
  evidence: GuestCleanupRoleEvidence
): void => {
  if (
    evidence.currentRole !== 'nihongo_guest_cleanup_worker' ||
    evidence.workerIsSuperuser !== false ||
    evidence.workerCanBypassRls !== false ||
    evidence.workerCanCreateRoles !== false ||
    evidence.workerCanCreateDatabases !== false ||
    evidence.sessionIsSuperuser !== false ||
    evidence.sessionCanBypassRls !== false ||
    evidence.sessionCanCreateRoles !== false ||
    evidence.sessionCanCreateDatabases !== false ||
    evidence.sessionHasCleanupRole !== true ||
    evidence.sessionHasApplicationRole !== false ||
    evidence.sessionHasErasureRole !== false ||
    evidence.workerCanModifyTables !== false ||
    evidence.sessionCanModifyTables !== false ||
    evidence.workerCanCreateInSchema !== false ||
    evidence.sessionCanCreateInSchema !== false
  ) {
    throw new Error('Guest cleanup database role is not isolated.')
  }
}

export const verifyStudyGuestCleanupRole = async (
  client: Pick<PrismaClient, '$queryRaw'>
): Promise<void> => {
  const rows = await client.$queryRaw<GuestCleanupRoleEvidence[]>`
    SELECT
      current_user::text AS "currentRole",
      worker.rolsuper AS "workerIsSuperuser",
      worker.rolbypassrls AS "workerCanBypassRls",
      worker.rolcreaterole AS "workerCanCreateRoles",
      worker.rolcreatedb AS "workerCanCreateDatabases",
      login.rolsuper AS "sessionIsSuperuser",
      login.rolbypassrls AS "sessionCanBypassRls",
      login.rolcreaterole AS "sessionCanCreateRoles",
      login.rolcreatedb AS "sessionCanCreateDatabases",
      pg_has_role(session_user, 'nihongo_guest_cleanup_worker', 'MEMBER') AS "sessionHasCleanupRole",
      pg_has_role(session_user, 'nihongo_app', 'MEMBER') AS "sessionHasApplicationRole",
      pg_has_role(session_user, 'nihongo_erasure_worker', 'MEMBER') AS "sessionHasErasureRole",
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS target
        WHERE target.relnamespace = current_schema()::regnamespace
          AND target.relkind IN ('r', 'p')
          AND has_table_privilege(current_user, target.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
      ) AS "workerCanModifyTables",
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS target
        WHERE target.relnamespace = current_schema()::regnamespace
          AND target.relkind IN ('r', 'p')
          AND has_table_privilege(session_user, target.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
      ) AS "sessionCanModifyTables",
      has_schema_privilege(current_user, current_schema(), 'CREATE') AS "workerCanCreateInSchema",
      has_schema_privilege(session_user, current_schema(), 'CREATE') AS "sessionCanCreateInSchema"
    FROM pg_catalog.pg_roles AS worker
    JOIN pg_catalog.pg_roles AS login ON login.rolname = session_user
    WHERE worker.rolname = current_user
  `
  if (rows.length !== 1 || !rows[0]) {
    throw new Error('Guest cleanup database role could not be verified.')
  }
  assertStudyGuestCleanupRole(rows[0])
}
