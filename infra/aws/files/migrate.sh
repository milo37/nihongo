#!/bin/bash
# migrate.sh <full git SHA>: snapshot the database, then run `prisma migrate deploy`
# once from the <SHA>-migrate image (Dockerfile target "migrate"). deploy.sh calls it
# after provision-db.sh and before the new API starts; a failure leaves the old API up.
set -euo pipefail
release="${1:-}"
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || { echo "release must be a full git SHA" >&2; exit 2; }
cd /opt/harumaru

# pipefail makes an empty or failed pg_dump stop here, before any schema change.
/opt/harumaru/bin/backup.sh pre-migrate "$release"

docker compose --profile migrate run --rm --no-deps migrate
echo "migrated to $release"
