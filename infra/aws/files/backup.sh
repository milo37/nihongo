#!/bin/bash
# Daily logical backup to S3 (30-day lifecycle). Success is a CloudWatch metric;
# a missing data point raises the backup alarm.
set -euo pipefail
source /etc/harumaru/host.env
cd /opt/harumaru

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
key="postgres/${stamp:0:4}/${stamp:4:2}/nihongo-${stamp}.dump"

docker compose exec -T postgres pg_dump -U postgres -d nihongo --format=custom \
  | aws s3 cp - "s3://${BACKUP_BUCKET}/${key}" --region "$AWS_REGION" \
    --sse AES256 --expected-size 21474836480

aws cloudwatch put-metric-data --region "$AWS_REGION" --namespace Harumaru \
  --metric-name BackupSucceeded --dimensions "Environment=${ENVIRONMENT}" --value 1
echo "backup s3://${BACKUP_BUCKET}/${key}"
