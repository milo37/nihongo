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

`technical-current-test` is TEST-only and selects the exact 46 ordered physical
release migrations, including the current catalog migration. Both the count and
the reviewed SHA256 digest
`5457abb5b6fd6d2b0a839402479c643bd74d5e6878fd7763881abc440248d2aa`
are fixed; an internally consistent count or digest alone is not sufficient.
The current source pin for
`20261009120000_phase7_approved_n4_reading_batch7_tags` is
`d4d2caac296296fd941b7631cf6cf7016da2b1be1f764c01386d1d2b1413d806`. The catalog entry
`20261010071000_phase7_approved308_tags` has reviewed file SHA256
`600dd3ab067f2af20bb04ecf1dd0f7c30eb18c6c32eb8ab03d746735fa0b0401`.
These are source-inventory pins, not evidence that either SQL file was applied.
They do not authorize rewriting an applied migration or repairing a live ledger.

The historical physical 37 predecessor, physical 38 batch7-installed prefix and
physical 39 inventory have respective ordered file digests
`89158202b48454a0d179913983fe1449dc139c0db25aec0ba4c5480040291aad`,
`6aa49828fc3138b2b544830794cad68c05ed11ae2ffa018b9e43a2800cb578dd` and
`611c2ec676b54bc333706d2401775c242e5d65886c9eb8cb255f15d13dfbc0c1`. These predecessor profiles are rejected as the current technical recovery
profile. The physical46 source adds seven SSO migrations after approved308, ending
at `20261020230000_sso_account_lifecycle`; its file digest is
`d0a81eff438c516b761ed8c4b3eeba72276f9a539d81baad2799fa455cda8b2a`. A current catalog-excluded 38-entry inventory has file digest
`0169f4d0491d4e33f917df842cdeb26920edc2e7f02f8b0d41159cd132320f3b`;
it is neither this technical recovery profile nor a runtime profile.
No current physical46, historical39 or catalog-excluded38 DB execution is verified here.

The previous physical 38 source freeze used digest
`fae541796dc4e4a3afbd05c9c0af39fbad11bdecc4385bd393092fafea8c62b9`
and the earlier batch7 file pin
`01ae675a719ccc08854135efd4057f95659d671d04addf40d5c45ba26c850f12`.
Its historical canonical 37-migration isolated DB candidate excludes
`20261005183000_phase7_reviewed_catalog_current` and is neither this technical
recovery profile nor a runtime profile. Its reviewed file digest is
`79bd5eb74c70780169cf672d330b605a89ed52d4cffd6bc130d77c7aff70577d`;
actual new DB8 execution remains unverified and requires a separate assignment.
JLP-472 implementation and JLP-473 review provide historical source evidence only.
That historical disposable-fixture plan was to first complete canonical36 with the
original 65 questions, 108 tags and 127 applicability cells; its prior unchanged
20-name/24-cell command was to reach 128/151, followed by the then-new append,
completed canonical37 and the closed 15-name/15-cell command. These historical
counts and commands are not preparation instructions for the current SQL46.
All predecessor, historical and catalog-excluded inventories remain rejected
as the current technical profile, even when their own digests are consistent.
No fixture preparation, SQL execution, activation or deployment is performed by
this metadata update.

Previous physical 37 and canonical 36 inventories remain historical, with
digests
`89158202b48454a0d179913983fe1449dc139c0db25aec0ba4c5480040291aad`
and `96eebebc8d76d1eb858b1cc12d7559685a5e06559a57ff8d9aabdf3b067e3ab3`
respectively. Their JLP-462 exact-five source freeze remains preserved.
The earlier forward correction
`20261009092000_phase7_n4_n2_revision2_digest_fix` retains reviewed file SHA256
`21f8911ff72d11405338df8c7a539c6eff92279593d895dfba2cc4dd236326aa`.
JLP-465 recorded a separate canonical36 DB8 pass; it does not verify the new
canonical37 command or make either previous inventory a recovery fallback.

Previous physical 36 and canonical 35 inventories remain historical, with
digests
`8b9f35ed93aa7179cf5405a49039a10ff3f484171c54a33efbd1018b0494b02f`
and `b1599310da408668bd4617f35ebc47109cb6e23d91e23dd737eaff521d49a393`
respectively. Their JLP-454 exact-five freeze and independent JLP-455 review
remain historical source evidence. JLP-456 recorded six passing and two failing
DB8 cases without failed identities. JLP-458 identified failures in cases 3 and
4; two passing identities remain unknown. Those failures are not upgraded by
the new source metadata, and neither previous inventory is a recovery fallback.

Historical physical 35 and canonical 34 inventories remain preserved for
comparison, with digests
`6ce3cb9d17492c2806fab8e03b923b9440da30ca6be9b10c5a978abc1bd5d8a8`
and `4448f7aa40804bb3058f1a986c6af5527eb26ca7375973bcca320fa1bf51d7f8`
respectively. The previous physical 35 exact-five source freeze and independent
JLP-448 review remain historical evidence. Neither inventory is accepted as the
current technical recovery profile or as a fallback.

`v1-runtime-pre-phase7` selects the exact 27 entries before
`20260827100000_phase7_admin_cms_enums`, but it is an unverified activation
candidate rather than current-artifact compatibility or deployability proof.
The retired email sign-up/sign-in smoke cannot validate the Google-only artifact.
The replacement candidate uses a current-46 controlled Google-linked TEST session:
task-owned setup applies the existing Phase7 prefix37, capability/issuer activation,
reviewed canonical65 seed helper, and remaining immutable migrations. An existing
unique canonical tag must return exactly one matching question/version. The same
confirmed session must read the principal and create/list exactly one bookmark.
The production image reuses its identity repository and production cookie signer;
external Google exchange remains unverified. This fixture is not a Google login,
Staging/Production recovery proof, or permission to activate an external target.
Actual Docker/database execution of this candidate remains unverified. The host
setup requires installed API dependencies, tsx and the generated Prisma client;
it reads no environment files and runs no TEST replacement server in the image.
Activation remains blocked pending exact current-artifact compatibility evidence
and a trusted registry/provider adapter. Never point bare `prisma migrate deploy`
at the full current directory for a historical v1 Staging/Production target.

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

Historical Slice 4A completion meant only: provider-neutral recovery contracts
and TEST-only verifiers were green. It is not Staging or Production recovery proof.
This correction candidate has not rerun those verifiers or executed a DB drill.
