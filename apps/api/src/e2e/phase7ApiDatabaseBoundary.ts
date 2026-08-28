const PHASE7_GROUP_ROLES = new Set([
  'nihongo_phase7_owner',
  'nihongo_phase7_migration',
  'nihongo_app',
  'nihongo_auth_gateway',
  'nihongo_erasure_worker'
])

export interface Phase7ApiBootstrapIdentity {
  readonly canCreateDatabase: boolean
  readonly canCreateRole: boolean
  readonly canSetOwner: boolean
  readonly currentUser: string
  readonly isSuperuser: boolean
  readonly sessionUser: string
}

export interface Phase7ApiDatabaseSnapshotIdentity {
  readonly acl: ReadonlyArray<{ readonly grantor: string }>
  readonly ownerName: string
}

export const assertPhase7ApiDatabaseBoundaryPreflight = ({
  bootstrap,
  snapshot
}: {
  bootstrap: Phase7ApiBootstrapIdentity | undefined
  snapshot: Phase7ApiDatabaseSnapshotIdentity
}): void => {
  if (
    !bootstrap ||
    bootstrap.currentUser !== bootstrap.sessionUser ||
    !bootstrap.isSuperuser ||
    !bootstrap.canCreateDatabase ||
    !bootstrap.canCreateRole ||
    !bootstrap.canSetOwner ||
    PHASE7_GROUP_ROLES.has(snapshot.ownerName) ||
    snapshot.acl.some(({ grantor }) => grantor !== snapshot.ownerName)
  ) {
    throw new Error('Phase 7 API bootstrap database is not attested.')
  }
}
