# 로컬 실제 API·DB 실행

README의 Mock 실행으로 충분하지 않을 때, 실제 API와 PostgreSQL을 로컬에서 띄우는 절차입니다.

루트·API의 `.env.example`과 API의 `.env.test.example`을 각각 `.env`·`.env.test`로 복사합니다.
루트의 `POSTGRES_PASSWORD`와 `{TEST,DEVELOPMENT}_*_PASSWORD` 6개는 서로 다른 24자 이상 URL-safe 값으로 설정하고 API 연결 URL에 대응시킵니다.
이 로컬 구성은 production provisioning의 대체물이 아닙니다.

**지속형 기술 runtime: 55433, 별도 project·volume**
API는 `DATABASE_URL` 하나(`nihongo_{test,development}_app_login` → `nihongo_app`)로 실행하고, migration은 `MIGRATION_DATABASE_URL`(`nihongo_{test,development}_migration_login` → `nihongo_migration`)로만 실행합니다.
provisioning은 `nihongo_owner`·`nihongo_migration`·`nihongo_app`·`nihongo_guest_cleanup_worker`와 TEST·DEVELOPMENT login 6개를 만들고, `public` schema와 DB 소유자를 `nihongo_migration`으로 둡니다(baseline이 schema를 `nihongo_owner`로 넘김).
migration은 `20261105090000_baseline`과 forward migration `20261106090000_remove_phase_names`, `20261107090000_first_admin_production`, `20261108090000_remove_tag_applicability_and_snapshots`, `20261109090000_add_tag_key_subject_status`, `20261110090000_admin_fresh_window_30_minutes`, `20261111090000_grant_user_target_level_update` 일곱 개입니다.

**DEVELOPMENT DB 재생성(데이터 보존 없음)**
baseline 이전 볼륨은 역할 이름과 migration 이력이 달라 그대로 쓸 수 없습니다. 볼륨을 지우고 새로 만듭니다.
project·volume 이름이 `nihongo-local`·`nihongo-local-postgres-data`로 바뀌어 이전 이름의 로컬 데이터는 보이지 않습니다. 아래 절차로 새로 만듭니다.
아래 `down -v`는 이 project의 볼륨 데이터를 영구 삭제합니다.

```bash
docker compose --project-name nihongo-local --profile local-db down -v
docker compose --project-name nihongo-local --profile local-db up -d --wait postgres-local
NODE_ENV=test pnpm run db:migrate:deploy
pnpm run db:seed:test
pnpm run db:migrate:deploy
pnpm run db:seed:dev
```

`up`은 새 볼륨에서만 provisioning을 실행하고, healthcheck는 provisioning 검증이 끝난 뒤에만 통과합니다.

provisioning은 guest cleanup login의 CONNECT까지 줍니다. migrate·seed 뒤 남는 단계는 DB capability 등록 하나입니다.
capability 등록(activation)에는 `--set=environment=TEST` 또는 `--set=environment=DEVELOPMENT`를 사용하며 명시적 후속 승인 전에는 실행 금지입니다.
이 단계는 `DatabaseCapability`에 접속한 server 주소·port를 기록하고 API startup이 같은 값을 확인하므로, API와 같은 경로(host에서 `-h 127.0.0.1 -p 55433`)로 실행합니다.
container 안 접속(socket 또는 container의 127.0.0.1)은 다른 주소가 기록되어 API startup이 42501로 실패합니다.
host에 PostgreSQL 18 client(`psql`)가 필요합니다. 다시 실행하면 같은 행을 현재 접속 주소로 갱신합니다(API의 capability 등록과 같은 SQL).

```bash
# 아래 one-way local write는 명시적 후속 승인 후에만 실행합니다(저장소 루트, 루트 .env 사용).
set -a; . ./.env; set +a
PGPASSWORD="$TEST_MIGRATION_PASSWORD" PGOPTIONS="-c role=nihongo_migration" \
  psql -h 127.0.0.1 -p "${LOCAL_POSTGRES_PORT:-55433}" --username nihongo_test_migration_login \
  --dbname nihongo_test --set=environment=TEST --file=infra/postgres/init/local-database-activate.psql
PGPASSWORD="$DEVELOPMENT_MIGRATION_PASSWORD" PGOPTIONS="-c role=nihongo_migration" \
  psql -h 127.0.0.1 -p "${LOCAL_POSTGRES_PORT:-55433}" --username nihongo_development_migration_login \
  --dbname nihongo_dev --set=environment=DEVELOPMENT --file=infra/postgres/init/local-database-activate.psql
```

기술 startup은 activation 전에는 의도적으로 실패합니다.
승인된 activation 뒤 TEST는 `DOTENV_CONFIG_PATH=.env.test pnpm run dev:api`, DEVELOPMENT는 `pnpm run dev:api`로 시작하고 `curl http://127.0.0.1:3001/health/ready`가 `{"status":"ready"}`인지 확인합니다.

**임시 통합 runner: 55432, 위 runtime과 volume 공유 금지**
API `.env.test`의 `DB_INTEGRATION_DATABASE_URL`·`API_INTEGRATION_DATABASE_URL`은 기본 55432 연결을 유지합니다.

```bash
docker compose up -d --wait postgres
pnpm run test:api-regression
```

runner는 wrapper login이 하나라도 이미 존재하면 안전하게 중단합니다.
