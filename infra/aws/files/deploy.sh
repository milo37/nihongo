#!/bin/bash
# deploy.sh <full git SHA>: provision DB roles, migrate, register the database
# capability, restart the API, verify, roll back on failure.
set -euo pipefail
release="${1:-}"
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || { echo "release must be a full git SHA" >&2; exit 2; }

source /etc/harumaru/host.env
cd /opt/harumaru
install -d -m 0700 /run/harumaru
exec 9>/run/harumaru/deploy.lock
flock -n 9 || { echo "another deploy is running" >&2; exit 1; }

write_compose_env() {
  printf 'API_IMAGE=%s:%s\nMIGRATE_IMAGE=%s:%s-migrate\nRELEASE_ID=%s\nAWS_REGION=%s\nLOG_GROUP=%s\n' \
    "$ECR_REPOSITORY" "$1" "$ECR_REPOSITORY" "$1" "$1" "$AWS_REGION" "$LOG_GROUP" > .env
}

# Checked inside the API container: port 3001 is not published on the host.
healthy() {
  for _ in $(seq 1 30); do
    if docker compose exec -T api node -e \
      "fetch('http://127.0.0.1:3001/health/ready').then((r)=>process.exit(r.status===200&&r.headers.get('x-release-id')===process.argv[1]?0:1),()=>process.exit(1))" \
      "$1" >/dev/null 2>&1; then
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
docker pull "$ECR_REPOSITORY:$release-migrate"

previous="$(cat current-release 2>/dev/null || true)"
write_compose_env "$release"
docker compose up -d --wait postgres

# Roles first (idempotent, attested), then migrations, then the DatabaseCapability
# row the API's readiness requires (written on an empty database, checked after),
# all before the new API starts. If any fails, .env points back at the running
# release so a reboot restarts what is live. The tag list is an operator step
# after the first deploy (production-database runbook, "Tag list load").
if ! /opt/harumaru/bin/provision-db.sh || ! /opt/harumaru/bin/migrate.sh "$release" \
  || ! /opt/harumaru/bin/register-capability.sh; then
  echo "refusing: database provisioning, migration or capability failed for $release" >&2
  if [[ -n "$previous" ]]; then write_compose_env "$previous"; fi
  exit 1
fi

docker compose up -d api proxy
if healthy "$release"; then
  echo "$release" > current-release
  # Migrate images (~200 MB each) are needed only while migrating; ECR keeps them.
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$ECR_REPOSITORY" \
    | grep -e '-migrate$' | xargs -r docker image rm >/dev/null || true
  echo "deployed $release"
  exit 0
fi

echo "health check failed for $release" >&2
if [[ -n "$previous" ]]; then
  # Migrations are forward-only, so the previous image must accept the new schema.
  write_compose_env "$previous"
  docker compose up -d api proxy
  healthy "$previous" && echo "rolled back to $previous" >&2
fi
exit 1
