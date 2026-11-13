# Recovery runbook v1 (AWS host)

How to bring the PostgreSQL data of the AWS host back from a backup. Both
restore paths below were run end to end on a local copy of the host (see
"Local rehearsal"). Steps marked **AWS only** cannot run locally; do them
right after the first STAGING deploy.

## What is backed up

| Backup                                 | Made by                                                      | Where                                                                  | Kept    |
| -------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- | ------- |
| Daily dump (`pg_dump --format=custom`) | `harumaru-backup.timer`, 19:00 UTC (04:00 JST) → `backup.sh` | `s3://<backup_bucket>/postgres/YYYY/MM/nihongo-<UTC stamp>.dump`       | 30 days |
| Pre-migrate dump                       | `migrate.sh`, before every `prisma migrate deploy`           | `s3://<backup_bucket>/postgres/pre-migrate/nihongo-<stamp>-<SHA>.dump` | 30 days |
| Volume snapshot                        | DLM, Sundays 18:00 UTC                                       | EBS snapshots tagged `harumaru-<env>-weekly`                           | last 4  |

A day without a daily dump raises the `harumaru-<env>-backup-missing` alarm.

## Pick the source

- Bad data (a mistaken admin action, a broken import): the newest daily dump
  from before the damage.
- A migration broke data: the `pre-migrate` dump of that release.
- S3 unusable: the weekly volume snapshot (up to 7 days old, **AWS only**,
  below).

Everything written after the chosen dump is lost. Note the dump time and tell
users if their recent study records are gone. Accounts whose owners asked for
erasure after the dump come back; re-apply those requests ("Re-apply account
erasure" below).

## Get the dump onto the host

The host role can only upload backups (`s3:PutObject`), so it cannot download
them. On the operator's machine (`aws login`), find the key and make a link
that works for 15 minutes:

```sh
aws s3 ls "s3://<backup_bucket>/postgres/" --recursive | tail -n 5
aws s3 presign "s3://<backup_bucket>/postgres/2026/11/nihongo-<stamp>.dump" --expires-in 900
```

Open a Session Manager shell on the host, `sudo -i`, and paste the link into a
variable without echoing it:

```sh
read -rs dump_url
```

## A. Restore on the running host

For bad data while the host and its volume are fine. The damaged database is
kept under another name, never overwritten.

```sh
cd /opt/harumaru
release="$(cat current-release)"
docker compose stop api proxy
aside="nihongo_damaged_$(date -u +%Y%m%d%H%M%S)"
docker compose exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'nihongo'" \
  -c "ALTER DATABASE nihongo RENAME TO $aside" \
  -c "ALTER DATABASE $aside OWNER TO postgres" \
  -c "REVOKE ALL ON DATABASE $aside FROM PUBLIC, nihongo_migration, nihongo_production_migration_login, nihongo_production_app_login, nihongo_production_guest_cleanup_worker_login" \
  -c "CREATE DATABASE nihongo"
/opt/harumaru/bin/render-env.sh
/opt/harumaru/bin/provision-db.sh
curl -fsS "$dump_url" | docker compose exec -T postgres \
  pg_restore -U postgres -d nihongo --exit-on-error --single-transaction
/opt/harumaru/bin/deploy.sh "$release"
```

- The `OWNER` and `REVOKE` lines are required. The API checks at start that its
  login can connect to no other database; without them it restarts in a loop
  with `Runtime DB role attestation failed.` (seen in the rehearsal).
- The site is down from `stop` until `deploy.sh` prints `deployed <SHA>`.
- `deploy.sh` checks the roles again, takes a pre-migrate dump of the restored
  data, applies any migration newer than the dump, confirms the
  `DatabaseCapability` row and waits for `/health/ready`.
- A dump made by a newer release than `current-release` must be restored with
  that newer release (migrations only move forward).

## B. Restore on a new data volume

For a lost or unreadable `/var/lib/harumaru` volume: the instance boots with an
empty data volume (cloud-init formats it and makes a new certificate). If only
the instance was replaced and the volume survived, do not restore; run
`deploy.sh <SHA>` instead.

```sh
cd /opt/harumaru
release=<full SHA of the release that last ran>   # GitHub main or ECR tags
/opt/harumaru/bin/render-env.sh
# Placeholder .env so Compose can start postgres alone; deploy.sh rewrites it.
(source /etc/harumaru/host.env
 printf 'API_IMAGE=none\nMIGRATE_IMAGE=none\nAWS_REGION=%s\nLOG_GROUP=%s\n' "$AWS_REGION" "$LOG_GROUP") > .env
docker compose up -d --wait postgres
/opt/harumaru/bin/provision-db.sh
curl -fsS "$dump_url" | docker compose exec -T postgres \
  pg_restore -U postgres -d nihongo --exit-on-error --single-transaction
/opt/harumaru/bin/deploy.sh "$release"
```

The restored `DatabaseCapability` row stays current because postgres always gets
`172.30.1.10` on the compose `db` network.

## Check

1. `deploy.sh` printed `production role graph and database ACL attested`,
   `database capability current: <ENV>` and `deployed <SHA>`.
2. Spot-check counts against what you expect:
   `docker compose exec -T postgres psql -U postgres -d nihongo -c 'SELECT count(*) FROM "User"'`
   (also `"Question"`, `"StudyResult"`).
3. Sign in on the site as an admin and as a learner.
4. After a few days without complaints, drop the copy (path A):
   `docker compose exec -T postgres psql -U postgres -d postgres -c "DROP DATABASE <aside>"`.
   It doubles disk use until then; the disk alarm fires at 80 %.

## Re-apply account erasure (AWS only)

The restored database has no record of erasure changes made after the dump:
accounts that asked for erasure are active again, and accounts that restored
themselves during the 7-day grace period are pending erasure again. The API
logs each change as `{"event":"auth.account_erasure.requested","userId":…,"occurredAt":…}`
or `{"event":"auth.account_erasure.cancelled","userId":…,"occurredAt":…}`, and
the log group keeps 30 days, as long as the dumps.

On the operator's machine, take each user's last erasure event since one hour
before the dump time (`<dump epoch>` = the UTC stamp in the dump key, in
seconds):

```sh
qid="$(aws logs start-query --log-group-name /harumaru/<env>/api \
  --start-time $(( <dump epoch> - 3600 )) --end-time "$(date +%s)" \
  --query-string 'filter event in ["auth.account_erasure.requested", "auth.account_erasure.cancelled"] | stats latest(event) as last by userId' \
  --query queryId --output text)"
sleep 10
aws logs get-query-results --query-id "$qid" \
  --query 'results[*].[[?field==`userId`].value | [0], [?field==`last`].value | [0]]' \
  --output text > erasure-events-<stamp>.txt
awk '$2 == "auth.account_erasure.requested" { print $1 }' erasure-events-<stamp>.txt > erasure-reapply-<stamp>.txt
awk '$2 == "auth.account_erasure.cancelled" { print $1 }' erasure-events-<stamp>.txt > erasure-restore-<stamp>.txt
```

Check the status is `Complete` (`aws logs get-query-results --query-id "$qid"
--query status`) and keep the files until the steps below are done. The ids are
random UUIDs, not names or emails. A user who asked and then restored within
the window is only in the restore file, so a restored request is never
re-applied.

- `erasure-reapply-<stamp>.txt`: re-apply with the #702 command (after the
  deploy). Until #702 ships, hand the file to the backend owner to re-apply,
  and tell those users their erasure is being redone.
- `erasure-restore-<stamp>.txt`: these accounts must not be erased. Pause the
  erasure schedule (`erasure_schedule_enabled = false`) until this is done,
  copy the file to the host and cancel each pending erasure again with the same
  database path as the in-app restore (after the deploy, so the #893 migration
  is applied):

  ```sh
  cd /opt/harumaru
  while read -r uid; do
    printf '%s: ' "$uid"
    docker compose exec -T postgres psql -X --username postgres --dbname nihongo \
      -v ON_ERROR_STOP=1 -v uid="$uid" <<'SQL'
  BEGIN;
  SET LOCAL ROLE nihongo_app;
  UPDATE "User" SET "accountStatus" = 'ACTIVE'
    WHERE "id" = :'uid' AND "accountStatus" = 'DELETION_PENDING';
  COMMIT;
  SQL
  done < erasure-restore-<stamp>.txt
  ```

  `UPDATE 1` restored the account; `UPDATE 0` means it was already active or
  already erased. Change no other column: the trigger rejects it. SQLSTATE
  `55000` means its erasure has already started and cannot be undone; hand that
  id to the backend owner. Then turn the schedule back on.

## Volume snapshot (AWS only)

Use only when no usable dump exists. Create a gp3 volume from the newest
`harumaru-<env>-weekly` snapshot in the instance's availability zone, stop the
instance, detach the data volume, attach the new one as `/dev/sdf`, start the
instance, then run `deploy.sh <SHA>`. Terraform still tracks the old volume
(`prevent_destroy`), so afterwards `terraform state rm aws_ebs_volume.data` and
`terraform import aws_ebs_volume.data <new volume id>` before the next apply.
This path is untested until it is rehearsed on STAGING.

## Never

`prisma migrate reset`, `prisma db push`, `prisma migrate dev`, `pg_restore
--clean` or any restore over the live database, `DROP DATABASE nihongo`, or
ad-hoc SQL on PRODUCTION outside these steps.

## To do right after the first STAGING deploy (AWS only)

1. After 04:00 JST the next day: the dump is in S3, the `BackupSucceeded` metric
   has a point and the backup alarm is OK.
2. `aws s3 presign` on the operator machine and `curl` on the host download the
   dump (the host reaches S3 over HTTPS through the default egress rule).
3. Run path A on STAGING with that dump and time it (site down from `stop` to
   `deployed`).
4. Request erasure for a test account after the dump, then run the Logs
   Insights step of "Re-apply account erasure" and check its id is listed.
5. Optionally rehearse the volume snapshot path and record the result here.

## Local rehearsal (#669, 2026-11-07)

Real `deploy.sh`, `backup.sh`, `render-env.sh` and `provision-db.sh` against
local postgres with the host compose file (stub `aws` and S3; local logs and
volumes; release `aeb65e4e`, the current migrations):

- Empty database → deploy → 3 tags loaded, 2 users with Google accounts added →
  `backup.sh` wrote a 352 KB dump and the success metric.
- Path A: deleted the tags and renamed the users, restored. All 42 tables
  matched the pre-damage state (row counts and an md5 of every row),
  `/health/ready` 200 with the release id. Before the `OWNER`/`REVOKE` lines were
  added, the API refused to start (see A).
- Path B: removed the data volume, `.env` and `current-release`, restored onto a
  new volume. Same 42-table match, `capability current`, readiness 200.
- Re-apply erasure (#704 build `3a8188ad`): two users with Google accounts,
  daily dump, then one signed in (session and re-auth proof made with the
  API's own functions, no Google) and sent `POST /api/auth/sso/delete-account`
  (202, `DELETION_PENDING`; one `auth.account_erasure.requested` line with
  only `userId`). After path A from that dump the user was `ACTIVE` again. The
  saved API log, filtered like the Logs Insights query (event, time from dump −
  1 h, distinct `userId`), gave a file with exactly that user's id; the other
  user was not listed. The query itself runs on AWS only.
