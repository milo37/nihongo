const TEST_DATABASE_GROUP_ROLES = new Set([
  'nihongo_owner',
  'nihongo_migration',
  'nihongo_app'
])

interface ApiBootstrapIdentity {
  readonly canCreateDatabase: boolean
  readonly canCreateRole: boolean
  readonly canSetOwner: boolean
  readonly currentUser: string
  readonly isSuperuser: boolean
  readonly sessionUser: string
}

interface ApiDatabaseSnapshotIdentity {
  readonly acl: ReadonlyArray<{ readonly grantor: string }>
  readonly ownerName: string
}

export const assertApiDatabaseBoundaryPreflight = ({
  bootstrap,
  snapshot
}: {
  bootstrap: ApiBootstrapIdentity | undefined
  snapshot: ApiDatabaseSnapshotIdentity
}): void => {
  if (
    !bootstrap ||
    bootstrap.currentUser !== bootstrap.sessionUser ||
    !bootstrap.isSuperuser ||
    !bootstrap.canCreateDatabase ||
    !bootstrap.canCreateRole ||
    !bootstrap.canSetOwner ||
    TEST_DATABASE_GROUP_ROLES.has(snapshot.ownerName) ||
    snapshot.acl.some(({ grantor }) => grantor !== snapshot.ownerName)
  ) {
    throw new Error('API bootstrap database is not attested.')
  }
}
