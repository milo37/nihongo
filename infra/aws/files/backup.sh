#!/bin/bash
# Daily logical backup to S3 (30-day lifecycle). Success is a CloudWatch metric;
# a missing data point raises the backup alarm.
# backup.sh pre-migrate <SHA>: one-off snapshot taken by migrate.sh before a
# migration; it goes under postgres/pre-migrate/ and does not count as the daily backup.
set -euo pipefail
source /etc/harumaru/host.env
cd /opt/harumaru

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
case "${1:-}" in
  '') key="postgres/${stamp:0:4}/${stamp:4:2}/nihongo-${stamp}.dump" ;;
  pre-migrate)
    [[ "${2:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "pre-migrate needs a full git SHA" >&2; exit 2; }
    key="postgres/pre-migrate/nihongo-${stamp}-${2}.dump" ;;
  *) echo "usage: backup.sh [pre-migrate <SHA>]" >&2; exit 2 ;;
esac

docker compose exec -T postgres pg_dump -U postgres -d nihongo --format=custom \
  | aws s3 cp - "s3://${BACKUP_BUCKET}/${key}" --region "$AWS_REGION" \
    --sse AES256 --expected-size 21474836480

if [[ -z "${1:-}" ]]; then
  aws cloudwatch put-metric-data --region "$AWS_REGION" --namespace Harumaru \
    --metric-name BackupSucceeded --dimensions "Environment=${ENVIRONMENT}" --value 1
fi
echo "backup s3://${BACKUP_BUCKET}/${key}"
