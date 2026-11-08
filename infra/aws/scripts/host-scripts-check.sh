#!/bin/bash
# Run from infra/aws. Exercises the host scripts that read SSM values with stub
# `aws` and `docker` commands and scratch paths (no AWS, no database):
# - render-env.sh writes the migrate container's runtime/production URLs without
#   passwords, leaves api.env intact, refuses missing Google OAuth values and
#   writes the legal contact file (empty without its optional values);
# - provision-db.sh, erase-deletion-pending.sh and guest-cleanup.sh treat SSM values as data, so
#   $(...) and `...` are never run, and unknown keys are refused;
# - render-origin-env.sh (PRODUCTION, #40) writes the Cloudflare token literally
#   and refuses an empty value or one with whitespace.
set -euo pipefail
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/run" "$work/etc" "$work/opt"

copy() {
  sed -e "s|/run/harumaru|$work/run|g" -e "s|/var/lib/harumaru|$work/var|g" -e "s|/etc/harumaru|$work/etc|g" \
    -e "s|/opt/harumaru/bin|$work/bin|g" -e "s|/opt/harumaru|$work/opt|g" \
    "files/$1" > "$work/bin/$1"
  chmod +x "$work/bin/$1"
}
copy render-env.sh
copy provision-db.sh
copy erase-deletion-pending.sh
copy guest-cleanup.sh
copy render-origin-env.sh
printf 'AWS_REGION=x\nPARAM_PATH=/p\n' > "$work/etc/host.env"
printf 'DEPLOYMENT_ENVIRONMENT=PRODUCTION\n' > "$work/etc/public.env"
touch "$work/opt/.env"

# Stub aws: prints the SSM parameters from $work/params.json (get-parameter: $work/token).
cat > "$work/stub-aws" <<EOF
#!/bin/bash
if [[ "\$1 \$2" == "ssm get-parameter" ]]; then cat "$work/token"; else cat "$work/params.json"; fi
EOF
# Stub docker: records the environment it would pass on.
cat > "$work/stub-docker" <<EOF
#!/bin/bash
printf '%s\n' "\$PRODUCTION_DATABASE_URL" > "$work/docker-saw"
printf '%s\n' "\$GUEST_CLEANUP_ENVIRONMENT \$GUEST_CLEANUP_DRY_RUN \$GUEST_CLEANUP_CONFIRM" > "$work/docker-env"
exit 0
EOF
mkdir -p "$work/path"
mv "$work/stub-aws" "$work/path/aws"
mv "$work/stub-docker" "$work/path/docker"
chmod +x "$work/path/aws" "$work/path/docker"
export PATH="$work/path:$PATH"

marker="$work/executed"
params() {
  python3 - "$work/params.json" "$@" <<'PY'
import json, sys
out, pairs = sys.argv[1], sys.argv[2:]
params = [{"Name": "/p/" + k, "Value": v} for k, v in zip(pairs[::2], pairs[1::2])]
json.dump({"Parameters": params}, open(out, "w"))
PY
}
app_pw=app_password_aaaaaaaaaaaaaaaa
mig_pw=migration_password_bbbbbbbbbbb
base=(
  POSTGRES_PASSWORD bootstrap_password_cccccccccccc
  DATABASE_URL "postgresql://nihongo_production_app_login:${app_pw}@postgres:5432/nihongo?schema=public&sslmode=require"
  MIGRATION_DATABASE_URL "postgresql://nihongo_production_migration_login:${mig_pw}@postgres:5432/nihongo?schema=public&sslmode=require&options=-c%20role%3Dnihongo_migration"
  PRODUCTION_DATABASE_URL "postgresql://nihongo_production_app_login:${app_pw}@postgres:5432/nihongo?schema=public&sslmode=require"
  BETTER_AUTH_SECRET s1 GUEST_COOKIE_SECRET s2 ORIGIN_VERIFY_SECRET s3
  PROD_MIGRATION_LOGIN_PASSWORD "$mig_pw"
  PROD_APP_LOGIN_PASSWORD "$app_pw"
  GOOGLE_CLIENT_ID google_client_id GOOGLE_CLIENT_SECRET google_client_secret
)

# 1. render-env.sh: passwords only where the container needs them.
params "${base[@]}" PROD_GUEST_CLEANUP_LOGIN_PASSWORD guest_password_dddddddddddddd
"$work/bin/render-env.sh"
grep -q ":${app_pw}@" "$work/run/api.env" || { echo "api.env lost its password" >&2; exit 1; }
grep -q ":${mig_pw}@" "$work/run/migrate.env" || { echo "migrate.env lost the migration password" >&2; exit 1; }
if grep -E '^(DATABASE_URL|PRODUCTION_DATABASE_URL)=' "$work/run/migrate.env" | grep -q ':[^/@]*@'; then
  echo "migrate.env carries a runtime or production password" >&2; exit 1
fi
grep -q '^DATABASE_URL=postgresql://nihongo_production_app_login@postgres:5432/nihongo?' "$work/run/migrate.env" \
  || { echo "migrate.env runtime URL identity changed" >&2; exit 1; }
echo "ok render-env: migrate.env has identity-only runtime and production URLs"

# Legal contact (#705): optional. Unset (STAGING) gives {} so the page shows its
# fallback; set values are trimmed, world-readable for the container user.
legal="$work/var/web/legal-settings.json"
[[ "$(cat "$legal")" == '{}' ]] || { echo "legal file without values is not {}" >&2; exit 1; }
params "${base[@]}" PROD_GUEST_CLEANUP_LOGIN_PASSWORD guest_password_dddddddddddddd \
  LEGAL_CONTACT_EMAIL ' help@example.test ' LEGAL_PRIVACY_OFFICER '홍길동'
inode="$(stat -c %i "$legal" 2>/dev/null || stat -f %i "$legal")"
"$work/bin/render-env.sh"
python3 - "$legal" <<'PY'
import json, sys
assert json.load(open(sys.argv[1])) == {"contactEmail": "help@example.test", "privacyOfficer": "홍길동"}, open(sys.argv[1]).read()
PY
[[ "$(stat -c %a "$legal" 2>/dev/null || stat -f %Lp "$legal")" == 644 ]] || { echo "legal file is not 0644" >&2; exit 1; }
# The API mounts this file; a new inode would leave the container on the old one.
[[ "$(stat -c %i "$legal" 2>/dev/null || stat -f %i "$legal")" == "$inode" ]] || { echo "legal file was replaced, not rewritten" >&2; exit 1; }
params "${base[@]}" PROD_GUEST_CLEANUP_LOGIN_PASSWORD guest_password_dddddddddddddd LEGAL_PRIVACY_OFFICER ' '
if "$work/bin/render-env.sh" 2>"$work/err"; then
  echo "render-env accepted a blank LEGAL_PRIVACY_OFFICER" >&2; exit 1
fi
grep -q 'LEGAL_PRIVACY_OFFICER must be 1-200 characters' "$work/err" || { cat "$work/err" >&2; exit 1; }
echo "ok render-env: legal contact file written, optional and in place"

# Without the Google OAuth client the site would start with no way to sign in.
params "${base[@]/#GOOGLE_CLIENT_SECRET/GOOGLE_CLIENT_SECRET_UNUSED}" PROD_GUEST_CLEANUP_LOGIN_PASSWORD guest_password_dddddddddddddd
if "$work/bin/render-env.sh" 2>"$work/err"; then
  echo "render-env accepted a missing GOOGLE_CLIENT_SECRET" >&2; exit 1
fi
grep -q 'missing SSM parameters: GOOGLE_CLIENT_SECRET' "$work/err" || { cat "$work/err" >&2; exit 1; }
echo "ok render-env: missing Google OAuth values refused"

# 2. provision-db.sh: a command substitution in an SSM value is never run.
for payload in "\$(touch $marker)" "\`touch $marker\`"; do
  params "${base[@]}" PROD_GUEST_CLEANUP_LOGIN_PASSWORD "guest_${payload}_dddddddddddd"
  "$work/bin/render-env.sh"
  if "$work/bin/provision-db.sh" 2>"$work/err"; then
    echo "provision-db accepted an unsafe value" >&2; exit 1
  fi
  [[ ! -e "$marker" ]] || { echo "provision-db ran an SSM value as shell code" >&2; exit 1; }
  grep -q 'URL-safe' "$work/err" || { cat "$work/err" >&2; exit 1; }
done
printf 'PATH=/nowhere\n' >> "$work/run/provision.env"
if "$work/bin/provision-db.sh" 2>"$work/err"; then
  echo "provision-db accepted an unknown key" >&2; exit 1
fi
grep -q 'unexpected line' "$work/err" || { cat "$work/err" >&2; exit 1; }
echo "ok provision-db: \$(...) and backticks not run, unknown keys refused"

# 3. erase-deletion-pending.sh: the URL reaches docker literally, on a STAGING
#    host too (#670).
printf 'DEPLOYMENT_ENVIRONMENT=STAGING\n' > "$work/etc/public.env"
url="postgresql://nihongo_production_app_login:\$(touch $marker)\`touch $marker\`@postgres:5432/nihongo?schema=public"
params "${base[@]/#PRODUCTION_DATABASE_URL/PRODUCTION_DATABASE_URL_UNUSED}" \
  PROD_GUEST_CLEANUP_LOGIN_PASSWORD guest_password_dddddddddddddd PRODUCTION_DATABASE_URL "$url"
"$work/bin/erase-deletion-pending.sh"
[[ ! -e "$marker" ]] || { echo "erase script ran an SSM value as shell code" >&2; exit 1; }
[[ "$(cat "$work/docker-saw")" == "$url" ]] || { echo "erase script changed the URL" >&2; exit 1; }
printf 'DEPLOYMENT_ENVIRONMENT=PRODUCTION\n' > "$work/etc/public.env"
echo "ok erase-deletion-pending: SSM URL passed through literally on STAGING"

# 4. guest-cleanup.sh: the same URL reaches docker literally, with the run settings.
rm -f "$work/docker-saw"
"$work/bin/guest-cleanup.sh"
[[ ! -e "$marker" ]] || { echo "guest cleanup ran an SSM value as shell code" >&2; exit 1; }
[[ "$(cat "$work/docker-saw")" == "$url" ]] || { echo "guest cleanup changed the URL" >&2; exit 1; }
[[ "$(cat "$work/docker-env")" == "PRODUCTION false CLEANUP_EXPIRED_GUEST_DATA" ]] \
  || { echo "guest cleanup settings changed: $(cat "$work/docker-env")" >&2; exit 1; }
echo "ok guest-cleanup: SSM URL passed through literally, not a dry run"

# 5. render-origin-env.sh: the Cloudflare token reaches origin.env literally.
token='cf_$(id)_`id`_token'
printf '%s\n' "$token" > "$work/token"
"$work/bin/render-origin-env.sh"
[[ "$(cat "$work/run/origin.env")" == "CLOUDFLARE_API_TOKEN=$token" ]] || { echo "origin.env changed the token" >&2; exit 1; }
for bad in "" "None" "two words"; do
  printf '%s\n' "$bad" > "$work/token"
  if "$work/bin/render-origin-env.sh" 2>"$work/err"; then
    echo "render-origin-env accepted '$bad'" >&2; exit 1
  fi
done
echo "ok render-origin-env: token written literally, empty or spaced values refused"
