# Phase 11 provider-neutral recovery runbook v1

This runbook is a tracked structural contract. It does not prove that a
Staging or Production provider has automatic backups, point-in-time recovery,
an isolated restore target, an incident owner, or a tested RPO/RTO.

## Stop gates

Stop before any target write unless all of the following are exact and
verified: release ID, release manifest, migration profile, external-registry
digest, source target fingerprint, three separated database identity
fingerprints, backup evidence, deployment approver, incident owner, and a
maintenance or generation lease. Never infer an environment from a hostname.

`technical-current-test` is TEST-only and selects all 31 repository migrations.
`v1-runtime-pre-phase7` is the only v1 Staging/Production profile and selects
the exact 27 entries before `20260827100000_phase7_admin_cms_enums`. Never point
bare `prisma migrate deploy` at the full current migration directory for a v1
Staging or Production target.

## Backup proof

Resolve the exact target and evidence adapter from the separately protected
registry. Accept only closed, secret-free evidence whose target fingerprint,
release, migration digest, observation time, RPO, RTO, and retention match the
validated recovery plan. A local dump, TEST fixture, successful health check,
or provider dashboard screenshot is not Staging/Production backup proof.

## Migration decision

1. Before migration, abort without a target write when any preflight differs.
2. With an unchanged migration profile, the previous artifact may be restored.
3. With an additive change, the previous artifact is allowed only when a
   separately reviewed compatibility proof is bound to the exact release.
4. For every other schema change, use a forward-fix.

`prisma migrate reset`, `prisma db push`, `prisma migrate dev`, destructive
reverse migrations, ad-hoc Production SQL, and restoration over the source
target are forbidden.

## Isolated restore drill

Restore only into a separately fingerprinted empty target. Bind the archive to
the accepted backup evidence without recording its path, URL, database name,
credential, provider response, SQL, row data, request body, or raw error. Verify
the migration ledger, schema digest, data digest, readiness compatibility,
empty-target preflight, runtime-role read access, zero source mutation, timing
budget, and cleanup. A TEST
drill must keep every external recovery claim false.

## Incident response

Classify incidents as SEV1 (security, unrecoverable write risk, or broad
unavailability), SEV2 (material degraded service), or SEV3 (contained impact).
Resolve the incident owner and communication channel from the validated exact
registry; this repository does not invent either. Preserve only closed-schema
digest evidence, record the rollback/forward-fix decision, and stop if ownership
or target identity becomes ambiguous.

## Evidence handling

Run `pnpm recovery:verify` only as a verifier. It performs no backup, restore,
migration, deployment, database, network, or provider action. Generated local
evidence belongs in ignored private scratch storage and must not be committed.
The current verifier accepts TEST evidence only. It rejects every Staging or
Production evidence chain, even a structurally self-consistent one, until a
protected target registry and trusted provider adapter are implemented.
TEST comparison digests are caller-supplied structural fixture evidence, not
provider attestation. They cannot be promoted to an external recovery claim.

Slice 4A completion means only: provider-neutral recovery contracts and
TEST-only verifiers are green. It is not Staging or Production recovery proof.
