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
# - question-set-publish.sh (JLP-828) fetches the ten files of the deployed SHA
#   and gives the command the api.env URL through the environment only.
# - explanation-ja-publish.sh (#976) does the same with the ten files plus the
#   Japanese explanation file.
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

# 6. question-set-publish.sh: the ten files of the deployed SHA, the app URL by
# environment (never argv), confirm only in confirm mode.
mkdir -p "$work/qs/path" "$work/qs/opt" "$work/qs/run"
sed -e "s|/opt/harumaru/bin/render-env.sh|true|" -e "s|/run/harumaru|$work/qs/run|g" \
  -e "s|/opt/harumaru|$work/qs/opt|g" files/question-set-publish.sh > "$work/qs/run.sh"
sha=0123456789abcdef0123456789abcdef01234567
printf '%s\n' "$sha" > "$work/qs/opt/current-release"
app_url='postgresql://nihongo_production_app_login:p$(id)w@db:5432/nihongo'
printf 'DATABASE_URL=%s\n' "$app_url" > "$work/qs/run/api.env"
cat > "$work/qs/path/curl" <<EOF
#!/bin/bash
printf '%s\n' "\${@: -3:1}" >> "$work/qs/urls"; printf '{}' > "\${@: -1}"
EOF
cat > "$work/qs/path/docker" <<EOF
#!/bin/bash
printf '%s\n' "\$*" > "$work/qs/argv"; printf '%s\n' "\$DATABASE_URL" > "$work/qs/env"
EOF
chmod +x "$work/qs/path/curl" "$work/qs/path/docker"
qs() { PATH="$work/qs/path:$PATH" QUESTION_SET_MODE="$1" bash "$work/qs/run.sh"; }
qs dry-run
qs_files='n5.v1.json n4.v1.json n3.v1.json n2.v1.json n1.v1.json n5.add.v1.json n4.add.v1.json n3.add.v1.json n2.add.v1.json n1.add.v1.json'
expected_urls="$(for f in $qs_files; do printf 'https://raw.githubusercontent.com/milo37/nihongo/%s/content/question-imports/%s\n' "$sha" "$f"; done)"
[[ "$(cat "$work/qs/urls")" == "$expected_urls" ]] \
  || { echo "question set files not the ten names at the release SHA, in order" >&2; exit 1; }
[[ "$(ls "$work/qs/opt/content/question-set-$sha" | sort)" == "$(printf '%s\n' $qs_files | sort)" ]] \
  || { echo "question set dir is not exactly the ten files" >&2; exit 1; }
[[ "$(cat "$work/qs/env")" == "$app_url" ]] || { echo "DATABASE_URL did not reach docker literally" >&2; exit 1; }
! grep -qE 'p\$\(id\)w|QUESTION_SET_CONFIRM' "$work/qs/argv" || { echo "dry run argv has the URL or the confirm" >&2; exit 1; }
qs confirm
grep -q -- '-e QUESTION_SET_CONFIRM=PUBLISH_QUESTION_SET' "$work/qs/argv" || { echo "confirm mode without the confirm" >&2; exit 1; }
if qs other 2>/dev/null; then echo "question-set-publish accepted an unknown mode" >&2; exit 1; fi
echo "ok question-set-publish: ten files at the release SHA, URL by environment, confirm only on confirm"

# 7. explanation-ja-publish.sh: the ten set files and the explanation file of the
# deployed SHA, the ten files before #936 as the previous set, the app URL by environment (never argv), confirm only in confirm mode.
mkdir -p "$work/ej/opt" "$work/ej/run"
sed -e "s|/opt/harumaru/bin/render-env.sh|true|" -e "s|/run/harumaru|$work/ej/run|g" \
  -e "s|/opt/harumaru|$work/ej/opt|g" files/explanation-ja-publish.sh > "$work/ej/run.sh"
printf '%s\n' "$sha" > "$work/ej/opt/current-release"
printf 'DATABASE_URL=%s\n' "$app_url" > "$work/ej/run/api.env"
: > "$work/qs/urls"
ej() { PATH="$work/qs/path:$PATH" EXPLANATION_JA_MODE="$1" bash "$work/ej/run.sh"; }
ej dry-run
expected_urls="$(for f in $qs_files; do printf 'https://raw.githubusercontent.com/milo37/nihongo/%s/content/question-imports/%s\n' "$sha" "$f"
  printf 'https://raw.githubusercontent.com/milo37/nihongo/f2e2e17145a119f436faa52fef9ecf4929facc44/content/question-imports/%s\n' "$f"; done
printf 'https://raw.githubusercontent.com/milo37/nihongo/%s/content/translations/explanations-ja.v1.json\n' "$sha")"
[[ "$(cat "$work/qs/urls")" == "$expected_urls" ]] \
  || { echo "explanation files not the ten set files and the explanation file at the release SHA" >&2; exit 1; }
ej_dir="$work/ej/opt/content/explanation-ja-$sha"
[[ "$(ls "$ej_dir/set" | sort)" == "$(printf '%s\n' $qs_files | sort)" ]] \
  || { echo "explanation set dir is not exactly the ten files" >&2; exit 1; }
[[ "$(ls "$ej_dir/previous" | sort)" == "$(printf '%s\n' $qs_files | sort)" ]] \
  || { echo "explanation previous dir is not exactly the ten files" >&2; exit 1; }
[[ "$(ls "$ej_dir")" == "$(printf 'explanations-ja.v1.json\nprevious\nset')" ]] \
  || { echo "explanation dir has more than the set and the explanation file" >&2; exit 1; }
[[ "$(cat "$work/qs/env")" == "$app_url" ]] || { echo "DATABASE_URL did not reach docker literally" >&2; exit 1; }
grep -q -- "-v $ej_dir:/run/explanation-ja:ro" "$work/qs/argv" || { echo "explanation dir not mounted read-only" >&2; exit 1; }
grep -q -- '-e QUESTION_SET_PREVIOUS_DIR=/run/explanation-ja/previous' "$work/qs/argv" || { echo "previous set not passed" >&2; exit 1; }
grep -q 'api/dist/content/explanationJaPublishCommand.js' "$work/qs/argv" || { echo "not the explanation command" >&2; exit 1; }
! grep -qE 'p\$\(id\)w|EXPLANATION_JA_CONFIRM' "$work/qs/argv" || { echo "dry run argv has the URL or the confirm" >&2; exit 1; }
ej confirm
grep -q -- '-e EXPLANATION_JA_CONFIRM=PUBLISH_EXPLANATION_JA' "$work/qs/argv" || { echo "confirm mode without the confirm" >&2; exit 1; }
if ej other 2>/dev/null; then echo "explanation-ja-publish accepted an unknown mode" >&2; exit 1; fi
echo "ok explanation-ja-publish: set and explanation files at the release SHA, previous set before #936, URL by environment, confirm only on confirm"
