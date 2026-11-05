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

`technical-current-test` is TEST-only and selects the exact 52 ordered physical
release migrations, including the current catalog migration. Both the count and
the reviewed SHA256 digest
`454ffc17fda1ccdf18ad870bd019d816c48c69fcff7b5ce9e7fed2f9ba42dec6`
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
profile. The historical physical46 source adds seven SSO migrations after approved308, ending
at `20261020230000_sso_account_lifecycle`; its file digest is
`d0a81eff438c516b761ed8c4b3eeba72276f9a539d81baad2799fa455cda8b2a`. Its ordered inventory digest
`5457abb5b6fd6d2b0a839402479c643bd74d5e6878fd7763881abc440248d2aa` is also rejected. The historical physical47 source adds
`20261020233000_sso_first_admin_bootstrap`, with reviewed file SHA256
`680ce338ea94f47d1da21c4945270d36b7c39ae60dabf0040da4310c576e90f5`.
Its ordered inventory digest
`006376ae3be87dd53131cc3c2ee9ccf06f6f8c1706841662a55309618c694891`
is also rejected.
The historical physical48 source adds
`20261028090000_sso_account_erasure_worker_queue`, with reviewed file SHA256
`cc91bd854924b2261ac4dcb2e8036ad62c69ec0af8d5afe756d4ce7f9ed5d8d7`.
Its ordered inventory digest
`a1ff76baa1b6a00920a0699436fe78f7ac51af8b8f939fa40d136c5ac1535630`
is also rejected.
The historical physical49 source adds
`20261028120000_sso_account_erasure_claim_lease`, with reviewed file SHA256
`bb1075457d171fe0ddc4643e63b8646a27a7cf4087b4aeebe2d151beb3633846`.
Its ordered inventory digest
`53c9dd466345b5776e2a6b9a6f57ce78b843f1d2638a26a9c90caa7f520a1392`
is also rejected.
The historical physical50 source adds
`20261028150000_sso_provider_cleanup_fencing`, with reviewed file SHA256
`394b548011a5021a5d63c39ab6e6a425069aa005f5018a3ef2652336aabd449e`.
Its ordered inventory digest is
`299d197f8d062554585b3566f981583af832c1799f232bea4f60ac3d8e157083`.
The historical physical52 inventory added `20261028160000_study_contract_v2_default`
(file SHA256 `3b2dd4b6186d0f3603942a3de324cea3041e6fb0cd395eb9fc49f57c9e86a858`)
and `20261028170000_study_v1_retirement_authority`
(file SHA256 `622c83d394d779d0eb9f96baedbf8a81ab97d385c09fd99f82efa4e59905eb82`).
The historical physical53 inventory added `20261030100000_guest_expired_draft_retention`
(file SHA256 `5708fd94835c6ce970049b1830d44dca2e10e9c089f54383aa67219218fb81f7`);
its ordered inventory digest is
`39d9c2053323d8a180e53af80e81dd26a00ef6c041040dc7ccea8e99932e9c08`.
The historical physical55 inventory added `20261104090000_unified_reports_import_results`
(file SHA256 `aee02806b846d61c64d35e0c873475e25880e82bd72029853fa23ff7742f8042`)
and `20261104120000_user_report_erasure_redaction`
(file SHA256 `99bdb0fecdcfe27d13850bb106af9fbcbb88c2a8cd79d7d6ae355f1db530efa8`),
with ordered inventory digest
`4ced7adc2cb49210ad05dd09ec77238d5d3f784a27a5fc2182702de3531595b2`.
The historical physical56 inventory added `20261104150000_user_account_restriction`
(file SHA256 `26762221ae1b1ad9636138825453e4664c46e03128db394fbe77ec13ba1532cc`),
with ordered inventory digest
`6682d553434a2836173cc114cdbc664b0cdfc9b9c1e8580397d74c0a930aaa02`.
The historical physical57 inventory added `20261105090000_admin_member_console`
(file SHA256 `a109890b8c812fa5b74c159b2f99f15c955ee6735ac8d1126b597881eb562de9`),
with ordered inventory digest
`64f4e4765c22cfbb06a9dcc36ab8f3ec707bd18741614c7327fcc6c7472aedb0`.
The historical physical58 inventory added `20261106090000_single_operator_review`
(file SHA256 `f569efc31c2638a23c2870ded6a8140aabb7be90aff57a2f02d740392f6fc6d1`),
with ordered inventory digest
`13da74f7dd883ce43d36f9f532dbc41652a84c0eb4b8f812607f1ca622be578c`.
The historical physical59 inventory added `20261107090000_drop_study_review_triggers`
(file SHA256 `287d1ff5811f16849738919c4492ea5af59540d5be1c7f133d4646e2ff44d2b4`),
with ordered inventory digest
`87a2ac0933184eb700be1f564d47e83f720fe370e612b92b8adf478f9f7811fb`.
The historical physical60 inventory added `20261108090000_admin_member_console_to_api`
(file SHA256 `fc5db8ea94e3197b32722e3ed762d41ce1e85c834c4ee4bb7588d98e46ff2003`),
with ordered inventory digest
`5994f49b88fd775cf4045a7e2ab62d36135f0b6bbf93722bcc377ba9c4b329b6`.
The historical physical61 inventory added `20261109090000_guest_cleanup_to_api`
(file SHA256 `3d125f629132d5333b4d618977ef7310f4bbd73c5fbceebcd844fa9e7cb1f34b`),
with ordered inventory digest
`5dd1426b9b218d351aa9ff7f0e7700d5a98a3930015f80ad5a048592c97b365b`.
The historical physical62 inventory added `20261110090000_cms_rules_to_api`
(file SHA256 `97fd8b1a45ee987410d4909b8ae3f3a3b053d07ea1f4fecd0d39c0d4f58c1d8b`),
with ordered inventory digest
`8b6344b8ea9b0e70156d55ad0adbbb00cd5c9dcb499284f69d221ddd5239dcaf`.
The historical physical63 inventory added `20261110100000_admin_audit_to_api`
(file SHA256 `2af5e1b565e20ee5fb5d6cd1e798112b6753f7a1a1f7c0981c9909352b5a9b90`),
with ordered inventory digest
`c4ea76ba29a90169872d0a8e26412d1134d2e834f06609faba2bcafad7c9619f`.
The historical physical64 inventory added `20261110110000_drop_retired_credential_auth`
(file SHA256 `020323b0eeecd24d967de372418096409126b3ff868df16a6a5a30477dd03c84`),
with ordered inventory digest
`35cdf2e7f71f6851ac63aea0af1b8075d86c9b2aa1f9b33a9c7e56d24eaf382d`.
The historical physical65 inventory added `20261111090000_drop_dead_reauthentication`
(file SHA256 `38112f77708f18f8c1653baf305fb1925585e67f142c8601e0b2667d404ac154`),
with ordered inventory digest
`8c9e7821338db7ac499fac7ae4d5efd475babc7b141b93bbec80654a7c64d71c`.
The historical physical66 inventory added `20261112090000_merge_runtime_roles`
(file SHA256 `3b07241f98ba2f8f8087ece67d522d8b542a1b10e408191e402fd477f8a019f7`),
with ordered inventory digest
`3d2a2bc45a6a9556ac1eb273f6e0c5f90e2bb158e6f1d12f52939c53d59bb23c`.
The current physical67 inventory adds `20261113090000_admin_operation_to_api`
(file SHA256 `b6fa895ed7f6341ba12341a65cb7acc1099f14d111b16f921ee2687595f05259`),
with ordered inventory digest
`97a17f9613955e3464f05935fe62f6b1d6be94418afb5b890eb3e9bff24e9a86`.
Historical physical50, physical52, physical53, physical55, physical56, physical57, physical58, physical59, physical60, physical61, physical62, physical63, physical64, physical65 and physical66 are rejected as the current technical profile.
A historical catalog-excluded 38-entry inventory has file digest
`0169f4d0491d4e33f917df842cdeb26920edc2e7f02f8b0d41159cd132320f3b`;
it is neither this technical recovery profile nor a runtime profile.
No current physical67, historical66, historical65, historical64, historical63, historical62, historical61, historical60, historical59, historical58, historical57, historical56, historical55, historical53, historical52, historical50, historical49, historical48, historical47, historical39 or catalog-excluded38
recovery DB drill is verified here.

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
counts and commands are not preparation instructions for the current SQL52.
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
The replacement candidate uses a current-59 controlled Google-linked TEST session:
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
This metadata correction reruns static verifiers only; no recovery DB drill is executed.
