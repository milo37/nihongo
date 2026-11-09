# 하루마루

하루마루는 JLPT N5~N1 문자·어휘, 문법, 독해를 짧게 풀고 오답노트로
반복 학습하는 한국어 중심 웹앱입니다. 문제와 해설은 자체 제작하며,
실제 JLPT 기출문제나 상용 교재 문항을 복제하지 않습니다.

## 주요 기능

- 급수·과목·문제 수를 선택하는 문제풀이와 제출 후 채점·해설
- 오답·약점·책갈피를 활용한 복습과 문제별 메모
- 학습 기록, 정답률, 과목별 통계를 보여 주는 대시보드
- 관리자 문제 검색·등록·수정·삭제 화면
- 한국어·일본어 UI와 모바일 대응 화면
- 로딩·오류·빈 결과·오프라인·접근 권한 상태 처리

## 인증 정책

공개 회원 인증 정책은 **Google 전용**입니다.
자체 이메일·비밀번호 가입은 폐기했으며, Apple 로그인은 보류합니다.

## 저장소 구조

```text
.
├── apps/
│   ├── web/             # Vite·React UI, API 소비, MSW, UI 테스트
│   │   └── src/
│   │       ├── api/     # HTTP 함수와 전송 계약 검증
│   │       ├── app/     # 화면·도메인 훅·Query Factory
│   │       ├── i18n/    # 한국어·일본어 리소스
│   │       ├── mocks/   # 개발·테스트용 Mock API
│   │       └── store/   # 클라이언트 상태
│   └── api/             # Hono API·인증·학습·문항 도메인
├── packages/
│   ├── contracts/       # 공유 전송 계약
│   └── domain/          # 서버 도메인 로직
├── infra/               # PostgreSQL 초기화 구성
├── operations/          # 환경·복구 계약과 운영 절차
├── scripts/             # 아키텍처·보안·운영 검사 도구
├── team/                # 개발 역할과 Git 운영 문서
└── .github/workflows/   # 자동 검사 정의
```

## 로컬 Mock 실행

Node.js **22.23.0**, pnpm **10.2.1**을 사용합니다. 아래 명령은 모두 저장소 루트에서 실행합니다.

```bash
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env
pnpm run dev:web
```

Web 개발 주소는 `http://localhost:5173`입니다.
`dev:web`은 공유 contracts·domain을 빌드한 뒤 Web 개발 서버만 시작합니다.
Mock 모드에서는 로컬 API 서버나 PostgreSQL을 시작할 필요가 없습니다.

API 모드는 `apps/web/.env`의 `VITE_API_MODE=mock|real`로 선택합니다.
개발·테스트의 기본값은 `mock`, 프로덕션 빌드의 기본값은 `real`입니다.
프로덕션 빌드에서는 `mock`을 허용하지 않습니다.
실제 API·DB 연결은 [API 환경 예시](apps/api/.env.example)와
[컨테이너 구성](compose.yaml)을 확인한 뒤 별도 환경에서 준비합니다.

## 실제 API·DB 로컬 실행

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

## 검사 명령

```bash
pnpm run format:check
pnpm run lint
pnpm run check:architecture
pnpm run typecheck
pnpm run test
pnpm run build
```

Web 테스트와 production bundle 계약 검사는 따로 실행할 수 있습니다.

```bash
pnpm --filter @nihongo/web run test
pnpm --filter @nihongo/web run test:bundle
```

일반 Web 테스트는 Vitest, bundle 계약 검사는 별도 Node 테스트 경로를 사용합니다.

## 상세 문서

- [개발 역할·작업 인계](team/README.md)
- [브랜치·커밋·PR·main 통합 규칙](team/git-workflow.md)
- [복구 절차와 운영 준비 조건](operations/runbooks/recovery.v1.md)
