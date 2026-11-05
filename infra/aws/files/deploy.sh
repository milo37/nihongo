#!/bin/bash
# deploy.sh <full git SHA>: migrate, restart the API, verify, roll back on failure.
set -euo pipefail
release="${1:-}"
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || { echo "release must be a full git SHA" >&2; exit 2; }

source /etc/harumaru/host.env
cd /opt/harumaru
install -d -m 0700 /run/harumaru
exec 9>/run/harumaru/deploy.lock
flock -n 9 || { echo "another deploy is running" >&2; exit 1; }

write_compose_env() {
  printf 'API_IMAGE=%s:%s\nRELEASE_ID=%s\nAWS_REGION=%s\nLOG_GROUP=%s\n' \
    "$ECR_REPOSITORY" "$1" "$1" "$AWS_REGION" "$LOG_GROUP" > .env
}

healthy() {
  for _ in $(seq 1 30); do
    if [[ "$(curl -fsS -o /dev/null -D - http://127.0.0.1:3001/health/ready 2>/dev/null \
      | tr -d '\r' | awk -F': ' 'tolower($1)=="x-release-id"{print $2}')" == "$1" ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

/opt/harumaru/bin/render-env.sh
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${ECR_REPOSITORY%%/*}"
docker pull "$ECR_REPOSITORY:$release"

previous="$(cat current-release 2>/dev/null || true)"
write_compose_env "$release"
docker compose up -d --wait postgres

# Migrations run before the new API starts. The runtime image has no Prisma CLI
# and no production migration principal is defined yet (backend-owned), so the
# deploy refuses until migrate.sh is supplied.
if [[ ! -x /opt/harumaru/bin/migrate.sh ]]; then
  echo "refusing: /opt/harumaru/bin/migrate.sh is not defined (production migration step is backend-owned)" >&2
  [[ -n "$previous" ]] && write_compose_env "$previous"
  exit 1
fi
/opt/harumaru/bin/migrate.sh "$ECR_REPOSITORY:$release"

docker compose up -d api
if healthy "$release"; then
  echo "$release" > current-release
  echo "deployed $release"
  exit 0
fi

echo "health check failed for $release" >&2
if [[ -n "$previous" ]]; then
  # Migrations are forward-only, so the previous image must accept the new schema.
  write_compose_env "$previous"
  docker compose up -d api
  healthy "$previous" && echo "rolled back to $previous" >&2
fi
exit 1
