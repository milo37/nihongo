# JLPT Drill Note content authority

This directory contains server-side, answer-bearing Phase 6 content artifacts.
It must never be imported or copied into Web source, public assets, MSW,
browser storage, or browser test artifacts.

Phase 6 v1.0 is contributor-free. `content/contributors.v1.json` remains empty,
and `pnpm content:foundation-check` validates the current 65-question static
catalog without consuming human policy, signature, activation, or the
400-question planning target. The apply and compensation schemas under
`apps/api/src/content/dormant/v1_1/` are retained for v1.1 and are not a v1.0
runtime authority.

The tracked JSON files are strict UTF-8/LF/NFC artifacts. Policy snapshots,
signatures, release artifacts, and legacy manifests are immutable once
activated. Generated review evidence is local-only, mode `0600`, and is never
tracked.

Private keys are never stored in this repository. Human contributor enrollment,
signing, policy activation, and release application remain dormant until a
separate v1.1 authorization.

Tracked publication uses the ignored, non-authoritative mode-`0700`
`.tracked-artifact-staging/` directory. Interrupted-run residue there is never
part of an activation chain or policy hash and is not swept automatically by a
later validator invocation.
