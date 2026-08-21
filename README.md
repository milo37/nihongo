# JLPT Drill Note

JLPT N5부터 N1까지 문자·어휘, 문법, 독해 문제를 풀고, 틀린 문제를
자동으로 오답노트에 저장해 반복 학습하는 풀스택 포트폴리오 프로젝트입니다.

저장소는 pnpm workspace입니다. `apps/web`의 Vite 애플리케이션과
`apps/api`의 Hono API, `packages/contracts`의 공유 Zod 계약,
`packages/domain`의 순수 grading·review 규칙을 workspace root 명령으로 함께
개발·검증합니다.

이번 MVP는 정적인 화면 목업이 아닙니다. 문제 세션 생성, 답안 제출과 채점,
오답 상태 변경, 즐겨찾기, 학습 통계, 관리자 문제 CRUD가 실제 사용자 흐름으로
연결됩니다. 인증, 공개 문제 read, RANDOM·WRONG_NOTE·WEAKNESS·DAILY_REVIEW
StudySession create/read/submit/result와 owner-scoped WrongNote list/detail·all-mode
dashboard read와 Bookmark CRUD·BOOKMARK mode는 PostgreSQL 기반 실제 API로
구현됐습니다. USER submit은 오답·복습 이벤트를 원자 저장하며 guest submit은 이 영구
side effect를 만들지 않습니다. Phase 3 Slice 6에서 canonical endpoint adapter를
Query Factory·domain hook·기존 UI에 연결했습니다. `VITE_API_MODE=real`은 auth/question과
다섯 mode의 create/read/submit/result, WrongNote list/detail, dashboard, Bookmark를 실제
Hono/PostgreSQL로 사용하고, `mock`은 Alpha legacy와 같은 canonical mode 동작을 함께
유지합니다. guest는 RANDOM·WEAKNESS, USER/ADMIN은 다섯 mode를 사용합니다. own
SUBMITTED result의 incorrect historical pin retry도 실제 API와 canonical mock에서
지원합니다. USER/ADMIN target은 `WRONG_NOTE`, guest target은 `RANDOM`이며 응답 유실과
hard reload 뒤에도 같은 key·target으로 수렴합니다. UserMemo·review history와 real admin
API는 요청 전에 명시적으로 비활성화되며 silent Mock fallback하지 않습니다.
Phase 4 Slice 6에서 dashboard, practice create/read/submit/result와 WrongNote read의 active
UI transport를 canonical `/api/v1/*`로 단일화하고, guest 보호 mode direct URL의 silent
RANDOM fallback을 제거했습니다. CI는 fresh-schema integration과 real/mock Chromium,
production mock negative build와 real artifact 검증을 실행하도록 연결됐습니다.

## 서비스 목적

- 급수와 과목별로 짧게 반복 학습할 수 있는 JLPT 문제풀이 흐름 제공
- 틀린 문제를 자동 기록하고 두 번 연속 정답까지 복습 상태 추적
- 관리자용 문제 등록·수정·삭제 흐름을 포함한 실제 서비스형 구조 제시
- 한국어 UI와 모바일 우선 설계로 접근 가능한 학습 경험 제공

청해, 음원, 결제, 커뮤니티, AI 문제 생성·해설과 OAuth는 현재 범위에 포함하지
않습니다. email/password 회원가입·인증·재설정은 실제 API로 이관했습니다.

## 주요 기능

- N5~N1, 문자·어휘·문법·독해 학습 설정과 5·10·20문제 출제
- RANDOM, WRONG_NOTE, WEAKNESS, BOOKMARK, DAILY_REVIEW 출제 모드
- 새로고침 후 현재 문제, 선택 답안, 시작 시각 복구
- 숫자 1~4 답안 선택, 좌우 화살표 문제 이동, 접근 가능한 제출 Dialog
- 제출 전에는 정답과 해설을 숨기고 제출 후 문제별 결과·해설 제공
- 로그인 사용자의 오답 자동 저장, 오답 횟수와 연속 정답 상태 관리
- 오답 필터·정렬·페이지네이션, 상세 해설, 메모 수정, 단일 문제 재풀이
- 전체·과목별 정답률, 최근 세션, 최근 7일 학습량, 반복 오답 대시보드
- 문제 즐겨찾기 추가·해제와 BOOKMARK 모드 재풀이
- ADMIN 전용 문제 검색·필터·정렬·등록·수정·삭제
- 로딩, 오류, 오프라인, 빈 결과, 권한 없음, Not Found 상태

## 지원 범위

| 구분      | 지원 항목                                    |
| --------- | -------------------------------------------- |
| 급수      | N5, N4, N3, N2, N1                           |
| 과목      | 문자·어휘, 문법, 독해                        |
| 문제 수   | 5, 10, 20                                    |
| 출제 모드 | 랜덤, 오답, 약점 추천, 즐겨찾기, 오늘의 복습 |
| 제외      | 청해와 음원 재생                             |

## 기술 스택

- Vite 8, React 19, TypeScript
- React Router `createBrowserRouter`
- TanStack Query, Zustand
- Axios, Zod, MSW
- React Hook Form
- Tailwind CSS
- React Compiler
- Vitest, React Testing Library, user-event, jsdom, Playwright Chromium
- ESLint, Prettier, pnpm workspace
- Hono, `@hono/node-server`
- PostgreSQL 18, Prisma ORM 7과 `@prisma/adapter-pg`
- Better Auth 1.6.28과 official Prisma adapter
- `packages/contracts` 기반 strict Zod API 계약
- `packages/domain` 기반 framework-free grading·review 규칙

## 실행 방법

Node.js 22.23.0과 pnpm 10.2.1, Docker Desktop이 필요합니다. macOS에서는
`brew install volta`로 Volta를 준비하면 별도의 nvm 없이 저장소 pin과 같은
런타임을 사용할 수 있습니다.

pnpm 10은 루트 `.npmrc`의 `use-node-version=22.23.0`을 읽으므로 `pnpm run`
명령과 lifecycle script도 저장소가 지정한 Node를 사용합니다. `.nvmrc`, Volta,
pnpm runtime pin은 모두 같은 버전을 가리킵니다.

```bash
volta install node@22.23.0 pnpm@10.2.1
pnpm install --frozen-lockfile
```

Mock UI만 빠르게 실행할 때는 PostgreSQL과 API가 필요 없습니다. `VITE_API_MODE`를
비워 두면 dev/test는 `mock`을 선택합니다.

```bash
cp apps/web/.env.example apps/web/.env
pnpm dev:web
```

실제 Hono API와 PostgreSQL을 함께 실행할 때는 루트 `.env`의
`POSTGRES_*`와 `apps/api/.env`의 `DATABASE_URL` 계정정보를 같게 맞춰야
합니다. 루트 `.env`는 Docker Compose가, `apps/api/.env`는 API process가
읽습니다.

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
cp apps/api/.env.test.example apps/api/.env.test
docker compose up -d --wait postgres
pnpm run db:generate
pnpm run db:migrate:dev:deploy
pnpm run db:seed:dev
pnpm run db:migrate:test
pnpm run db:seed:test
VITE_API_MODE=real pnpm dev
```

`db:migrate:dev:deploy`는 저장소에 커밋된 migration을 로컬 개발 DB에
적용합니다. 새 migration을 작성할 때만 별도의 shadow DB 권한이 필요한
`pnpm run db:migrate:dev`를 사용합니다.

상기 API script는 실행 전 custom Prisma client를 스스로 생성합니다. 명시적으로
생성만 확인하려면 `pnpm run db:generate`를 사용합니다.

로컬 dev/test에서 만료된 guest-owned IN_PROGRESS/CANCELLED/EXPIRED session, 제출 후
7일 지난 guest SUBMITTED aggregate, 참조 없는 만료 guest와 만료 SUCCEEDED
idempotency record를 한 bounded batch 정리하려면 exact target guard와 확인 문자열을
함께 사용합니다. USER submitted aggregate와 retention 안의 guest 결과는 보존합니다.

```bash
STUDY_CLEANUP_CONFIRM=DELETE_EXPIRED_GUEST_STUDY_DATA \
  pnpm run study:cleanup-expired-guests
```

이 명령은 loopback의 `_dev`/`_test` DB만 허용하며 production에서는 hard-block됩니다.
운영 cleanup은 별도 exact-target 승인, runbook과 scheduler가 준비된 뒤 활성화합니다.

Phase 4 v2 session의 `expiresAt + 24시간`을 지난 cold draft와 만료된
`STUDY_DRAFT_SAVE` idempotency record를 로컬 dev/test에서 정리할 때는 별도
operation-aware command를 사용합니다. 한 번에 최대 500건을 `FOR UPDATE SKIP LOCKED`로
처리하며 USER/ADMIN session history는 EXPIRED 상태로 보존하고 guest aggregate 삭제는
기존 guest cleanup에 넘깁니다.

```bash
STUDY_DRAFT_CLEANUP_CONFIRM=DELETE_EXPIRED_STUDY_DRAFTS \
  pnpm run study:cleanup-expired-drafts
```

이 command도 production에서는 hard-block됩니다. production v2 write 노출 전에는
exact-target 외부 scheduler, 승인된 runbook과 `expiresAt + 24시간` cleanup SLO 증거가
별도로 준비돼야 합니다.

기본 웹 주소는 `http://localhost:5173`, API 주소는
`http://127.0.0.1:3001`입니다. API 상태는 `/health/live`와
`/health/ready`에서 확인합니다. 개발 서버는 `VITE_API_MODE`가 없으면 `mock`,
`real`로 지정하면 실제 API를 사용합니다. production build는 항상 `real`이고 Mock
설정을 거부합니다.

웹 또는 API만 실행하려면 다음 명령을 사용합니다.

```bash
pnpm dev:web
pnpm dev:api
```

프로덕션 번들을 로컬에서 확인하려면 다음과 같이 real artifact를
빌드한 뒤 API와 preview server를 별도 터미널에서 실행합니다. API는
preview origin `http://localhost:4173`을 정확히 허용해야 하며, DB migration과
seed는 미리 적용되어 있어야 합니다. 빌드 결과는 `apps/web/dist`에
생성됩니다.

```bash
# 한 번만
VITE_API_MODE=real pnpm build

# 터미널 A
TRUSTED_ORIGINS=http://localhost:4173 \
  pnpm --filter @nihongo/api run start

# 터미널 B
pnpm preview
```

## 환경 변수

```dotenv
VITE_API_BASE_URL=/api
VITE_API_MODE=mock

DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:55432/nihongo_dev?schema=public
TRUSTED_ORIGINS=http://localhost:5173
LOG_LEVEL=info
BETTER_AUTH_SECRET=replace_with_at_least_32_random_characters
BETTER_AUTH_URL=http://localhost:3001
GUEST_COOKIE_SECRET=replace_with_a_different_32_char_secret
AUTH_EMAIL_FROM=auth@example.test
AUTH_EMAIL_DELIVERY_MODE=test-sink
AUTH_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
PRACTICE_CONTRACT_RUNTIME=v1-v2
```

- `VITE_API_MODE`는 exact lower-case `mock | real`만 허용합니다. 비어 있으면
  dev/test는 `mock`, build는 `real`입니다.
- 로컬 Hono API를 사용하려면 `apps/web/.env`에서 `VITE_API_MODE=real`로 바꾸고
  dev server를 다시 시작합니다. Vite가 same-origin `/api` 요청을
  `http://127.0.0.1:3001`로 전달하므로 wildcard CORS를 열지 않습니다.
- local dev/test rollback은 `VITE_API_MODE=mock`으로 되돌리고 dev server를 다시
  시작합니다. operation별 real/Mock 혼합 fallback은 없습니다.
- 모든 production build는 `VITE_API_MODE=mock`을
  `VITE_API_MODE=mock is forbidden in production.` 오류로 거부하고
  `mockServiceWorker.js`도 bundle에 포함하지 않습니다. production rollback은 Mock
  활성화가 아니라 contract-compatible 이전 real artifact 재배포 또는 forward-fix입니다.
- real mode와 production startup은 same-origin의 exact
  `/mockServiceWorker.js` registration만 해제하고 다른 service worker는 건드리지
  않습니다.
- 실제 API mode에서도 기본 `VITE_API_BASE_URL=/api`를 유지해 SPA와 API를 같은
  origin으로 제공합니다. 개발 중 absolute API 주소를 사용할 때만 정확한
  `TRUSTED_ORIGINS`와 credentialed CORS를 사용하며 wildcard는 허용하지 않습니다.
- `DATABASE_URL`은 `apps/api`에서만 읽으며 web bundle에 포함하지 않습니다.
- `PRACTICE_CONTRACT_RUNTIME=v1-v2`는 현재 v1/v2 호환 API를 실행합니다. production은
  이 값을 명시해야 하며 누락하면 fail closed합니다.
- 제한적 `v1-compatible` runtime은 절대경로
  `PRACTICE_COMPATIBILITY_AUTHORITY_FILE`이 필요합니다. 이 파일은 외부 배포
  controller가 exclusive generation lease, v2-capable writer drain, 그리고 한 번
  활성화되면 되돌릴 수 없는 v2 write exposure 이력을 검증한 뒤 read-only immutable
  attestation으로 발급해야 합니다. 애플리케이션은 동일 파일 descriptor에서 안전하게
  읽어 attestation과 DB zero-fact를 검증할 뿐 lease 획득·drain·monotonic record 생성을
  대신하지 않습니다. 이 외부 authority와 운영 runbook이 없으면 compatibility 배포는
  금지됩니다.
- 통합 테스트 DB 이름은 안전장치상 반드시 `_test`로 끝나야 합니다.
- 격리된 임시 test DB를 검증할 때만 `PRISMA_TEST_DATABASE_URL`로 test
  migration과 seed target을 명시적으로 덮어쓸 수 있으며 동일한 `_test`·loopback
  안전장치를 적용합니다.
- application pool과 seed Prisma adapter는 안전한 `search_path`와 함께 PostgreSQL
  session startup option `TimeZone=UTC`를 강제합니다. dashboard의 날짜 bucket은
  machine locale이나 기존 connection timezone에 의존하지 않습니다.
- 이 작업 머신에 기존부터 있던
  `nihongo_test?schema=slice3_validation`에는 UTC 강제 전 seed된 65개
  catalog timestamp가 canonical seed instant보다 물리적으로 9시간 빠른 상태로 남아
  provenance 통합 테스트 2건이 실패합니다. 이 schema는 최종 검증에서 격리했고
  destructive reset은 실행하지 않았으며 명시적 사용자 승인을 기다립니다. 승인
  전에는 fresh unique UTC schema를 `PRISMA_TEST_DATABASE_URL`로 지정합니다.
  clean clone의 `.env.test.example` `public` schema에 일반화할 상태는 아닙니다.
- 운영 secret과 실제 비밀번호는 `.env.example`에 커밋하지 않습니다.
- 운영 email은 `AUTH_EMAIL_DELIVERY_MODE=webhook`과 HTTPS webhook
  URL/secret을 사용합니다. `test-sink`는 자동 테스트·로컬 구조 검증용이며 실제
  메일함을 대체하지 않습니다. 전송은 capacity 100/concurrency 2의 bounded
  in-process queue로 request path와 분리되고 정상 종료 시 drain됩니다. 이 queue는
  durable outbox가 아니므로 비정상 process 종료 시 queued email은 유실될 수
  있습니다.
- 로컬 `test-sink`는 메일 구조 검증용이며 회원가입 인증 URL을 외부에
  노출하지 않습니다. real USER 가입부터 로그인까지 실제로 확인하려면
  검증한 webhook receiver를 사용하거나 일회성 격리 `_test` DB 하네스를
  사용합니다. 공유 dev/test DB의 `emailVerified`를 수동으로 바꾸지 않습니다.

### DB 백업·복원 확인

운영에서는 관리형 PostgreSQL의 PITR을 우선 사용합니다. 로컬에서 migration 전
백업과 복원을 확인할 때는 원본 DB를 덮어쓰지 말고 별도 검증 DB를 사용합니다.

```bash
pg_dump --dbname="$DATABASE_URL" --format=custom --file=/private/tmp/nihongo.backup
createdb --host=127.0.0.1 --port=55432 --username=nihongo nihongo_restore_test
pg_restore --host=127.0.0.1 --port=55432 --username=nihongo \
  --dbname=nihongo_restore_test --no-owner --exit-on-error \
  /private/tmp/nihongo.backup
dropdb --host=127.0.0.1 --port=55432 --username=nihongo nihongo_restore_test
```

복원 확인이 끝난 뒤에만 정확히 이름을 확인한 검증 DB를 삭제합니다. production에서
`prisma migrate reset`, `db push`, 적용 완료 migration 수정은 사용하지 않습니다.

## 인증과 로컬 Mock 계정

`/login`은 email/password 회원가입·로그인과 비밀번호 재설정 요청을 제공합니다.
실제 API 모드에서는 이메일 인증을 마쳐야 로그인할 수 있고, session credential은
HttpOnly cookie에만 저장됩니다. `/api/v1/me`의 최소 사용자 projection만 UI
권한 판단에 사용하며 localStorage의 projection은 권위가 아닙니다.

Mock 모드(`VITE_API_MODE=mock`)의 로컬 자격 증명은 다음과 같습니다.

| 역할  | 이메일            | 비밀번호         | 사용 범위                            |
| ----- | ----------------- | ---------------- | ------------------------------------ |
| GUEST | 없음              | 없음             | 문제풀이와 결과 확인, 영구 저장 불가 |
| USER  | user@example.com  | Demo-user-2026!  | 오답노트, 즐겨찾기, 대시보드 포함    |
| ADMIN | admin@example.com | Demo-admin-2026! | USER 기능과 관리자 문제 CMS          |

Mock mode는 위 두 고정 계정의 sign-in/sign-out과 guest projection만 지원합니다.
회원가입, 이메일 인증, 비밀번호 재설정은 성공을 가장하지 않고 UI에서 비활성화하며,
실제 흐름은 `VITE_API_MODE=real`에서 검증합니다. Mock 인증 projection은 로컬
demo state일 뿐 session credential이 아닙니다.

실제 API의 초기 ADMIN은 공개 role-switch route가 아니라 operator command로만
생성합니다. 기존 USER를 승격하거나 기존 ADMIN password를 덮어쓰지 않으며, 실행
결과에는 email/password 대신 user ID와 provisioning reference의 SHA-256만 남깁니다.
`ADMIN_PASSWORD`는 12–128자, `ADMIN_NAME`은 1–80자,
`ADMIN_PROVISIONING_REFERENCE`는 3–128자여야 하며 실행 전
`apps/api/.env`의 `DATABASE_URL`이 의도한 대상인지 확인합니다. 이 command는
ACTIVE·verified ADMIN이라도 유효한 credential account가 없으면 완료 상태로
간주하지 않고 실패합니다.

```bash
export ADMIN_EMAIL=admin@example.com
export ADMIN_NAME='운영 관리자'
export ADMIN_PROVISIONING_REFERENCE='OPS-CHANGE-REFERENCE'
export ADMIN_TARGET_LEVEL=N1
read -s ADMIN_PASSWORD
export ADMIN_PASSWORD
pnpm run auth:provision-admin
unset ADMIN_PASSWORD
```

로그인 전에 보호된 경로에 접근하면 원래 경로를 `redirect`로 보존하고, 로그인
후 해당 경로로 돌아갑니다. 비밀번호 재설정 성공 시 기존 session은 모두
폐기되고 현재 탭과 다른 탭의 권한 projection·사용자별 cache·practice draft도
fail-closed로 정리됩니다. 이메일 인증 link는 token을 URL fragment에 넣어 SPA
interstitial로 전달하며, 사용자가 확인 버튼을 눌러야 POST verification이 실행됩니다.
따라서 mail scanner의 GET/HEAD는 계정 상태를 바꾸지 않습니다.

## 폴더 구조

```text
.
├── apps/
│   ├── api/                # Hono app, Prisma, auth/question/study/WrongNote/dashboard API
│   │   ├── prisma/         # schema, 23 migrations, 65문제 seed
│   │   └── src/            # app, middleware, DB, service/repository, E2E harness
│   └── web/
│       ├── e2e/            # Playwright real-browser practice-flow specs
│       ├── src/
│       │   ├── api/        # Axios, safe HTTP 함수, endpoint와 Zod schema
│       │   ├── app/        # 라우트 도메인, Query Factory, 훅, 페이지
│       │   ├── common/     # 재사용 UI, 키보드 훅, 도메인 타입
│       │   ├── libs/       # QueryClient, 오류 이벤트, storage adapter
│       │   ├── mocks/      # 자체 제작 seed, MSW, Mock Repository
│       │   ├── provider/   # Query, Router, 인증, 전역 오류 처리
│       │   ├── store/      # auth/practice/ui Zustand slice
│       │   ├── test/       # Vitest setup과 MSW test server
│       │   ├── util/       # shuffle, 채점, 공개 변환, 상태 머신
│       │   ├── main.tsx
│       │   └── router.tsx
│       ├── public/         # MSW worker와 정적 파일
│       ├── package.json
│       ├── vite.config.ts
│       ├── vitest.config.ts
│       └── tsconfig.json
├── packages/
│   ├── contracts/          # canonical request/response/error Zod 계약
│   └── domain/             # framework-free grading·review·submit canonicalization
├── infra/postgres/         # 로컬 test DB 초기화
├── compose.yaml            # PostgreSQL 18.4 개발·테스트 환경
├── package.json            # workspace 명령과 공통 품질 도구
├── playwright.config.ts     # isolated real/mock Chromium projects
├── pnpm-workspace.yaml
├── eslint.config.mjs
└── prettier.config.mjs
```

`apps/api`와 `packages/contracts`는 Phase 3 Slice 0부터 실제 운영 코드와 계약
테스트를 소유합니다. Slice 4에서 생성한 `packages/domain`은 server grading,
submit canonicalization과 wrong-note transition을 framework·transport·ORM 없이
소유하며 `apps/api`만 이를 소비합니다.

Vite 기본 `App.tsx`와 `App.css`는 사용하지 않습니다. 각 도메인의 페이지는
React lazy loading으로 분리되고, `apps/web/src/router.tsx`에서 통합됩니다.

## 데이터 흐름

서버 상태는 다음 단방향 경계를 지킵니다.

```text
컴포넌트
  → 도메인 커스텀 훅
  → TanStack Query Factory
  → apps/web/src/api/{domain}/{endpoint}
  → safeGet / safePost / safePut / safeDel
  → Axios
  → VITE_API_MODE 전체 transport 선택
      real → same-origin Hono → PostgreSQL
      mock → MSW handler → MockDatabase/localStorage
```

operation별 real/mock 혼합 fallback은 없고 real mode의 범위 밖 기능은 network 전에
숨기거나 비활성화합니다.

실제 API로 이관한 operation은 다음 경계를 추가로 지킵니다.

```text
apps/web + MSW + apps/api
  → @nihongo/contracts/{domain}/{operation}
  → 동일한 strict request/response/error schema
```

컴포넌트는 Axios, `fetch`, Mock 데이터, `useQuery`, `useMutation`을 직접 사용하지
않습니다. API 응답의 `response.data`는 모든 endpoint에서 strict Zod schema로
검증합니다.

## API 계층

- `apps/web/src/api/config.ts`: Axios client, timeout, interceptor, 오류 플래그,
  generic `safeFactory`
- `apps/web/src/api/http.ts`: raw `get/post/put/del`과 검증된
  `safeGet/safePost/safePut/safeDel`
- `apps/web/src/api/{domain}/{verbNoun}/schema.ts`: 요청·응답 Zod schema와 추론 타입
- `apps/web/src/api/{domain}/{verbNoun}/index.ts`: 요청 검증과 안전 HTTP 함수 조합

`config.ts`는 `http.ts`를 import하지 않아 순환 의존이 없습니다. 401, 403, 404,
서버, 네트워크, 오프라인, 응답 검증 오류는 플래그로 정규화하고 Query와 Mutation
오류를 `AuthErrorHandlerProvider`에서 함께 처리합니다.

문제풀이 세션 응답의 공개 모델 `PracticeQuestion`에는 정답 option ID,
`isCorrect`, 해설, 관리자 게시 상태가 포함되지 않습니다. 정답과 해설은 제출
응답에서만 제공됩니다.

Phase 3의 공개 문제 목록·상세 조회는 UUID logical ID와 immutable
`questionVersionId`, 구조화된 tag를 사용합니다. Hono와 MSW가 같은 canonical
request/response/error schema를 사용하며 목록은 summary만, 상세는 지문과 보기만
반환합니다. 정답·해설·관리자 필드가 섞이면 strict 계약과 재귀 누출 테스트가
실패합니다. 실제 Hono 경계는 route → service → Prisma repository로 분리되고
ACTIVE Question의 current PUBLISHED version만 조회합니다.

`GET /api/v1/wrong-notes`, `GET /api/v1/wrong-notes/:questionId`와
`GET /api/v1/dashboard`는 로그인한 USER/ADMIN의 현재 actor ID에 속한 데이터만
읽습니다. guest·anonymous는 `401 AUTHENTICATION_REQUIRED`, 만료된 auth session은
`401 AUTH_SESSION_EXPIRED`, 타인 또는 없는 WrongNote detail은 같은
`404 RESOURCE_NOT_FOUND`입니다. ADMIN도 일반 학습 API에서 다른 사용자의 기록을
읽는 universal reader가 아닙니다.

WrongNote 목록·상세의 급수·과목·유형·미리보기·문제·tag는
`lastWrongQuestionVersionId`가 가리키는 historical snapshot입니다. tag는 mutable
current Tag label이 아닙니다. migration 20 preflight/CHECK는
`QuestionVersionTag.labelSnapshot` 저장값에 ASCII U+0020 선후행 공백이 없도록
보장하고, read/filter는 그 저장값을 어떤 trim/정규화도 없이 exact 사용하므로 이후
rename이 과거 표시·필터를 바꾸지 않습니다.
반면 `reviewAvailability`만 현재 logical Question이 ACTIVE이고 current version이
PUBLISHED인지에 따라 `AVAILABLE | ARCHIVED`로 파생합니다. UserMemo는 아직 이관하지
않아 목록은 `hasMemo: false`, 상세는 `memo: null`을 반환합니다.
`currentReviewQuestionVersionId`는 nullable이며 아직 review session이 없는 note는
`null`을 유지합니다. Phase 4 Slice 3의 WRONG_NOTE·DAILY_REVIEW session 생성은 선택한
Question의 current PUBLISHED version을 이 pointer에 설정하거나 전진시키며, null 복귀와
version rewind는 DB invariant로 거부합니다.

dashboard의 `from`과 `to`는 함께 생략하거나 함께 전달하는 최대 366일의 UTC
calendar date이며 양 끝을 포함합니다. 서버는 이를
`[from 00:00:00Z, to + 1일 00:00:00Z)`로 정규화합니다. 범위는 SUBMITTED RANDOM
activity에 한정하지 않고 모든 SUBMITTED mode의 문항 수·정답률·과목·취약 과목·최근
세션·일별 7일 series에 적용하고,
WrongNote 전체·SOLVED 수·반복 오답 상위 항목은 range와 무관한 all-time own
snapshot입니다. 7일 series는 `to` 또는 관측한 현재 UTC 날짜를 끝으로 항상 연속된
7개 날짜를 반환하며 활동이 없는 날은 0으로 채웁니다.

## TanStack Query 구조

각 서버 도메인은 `queries/*Queries.ts`의 Query Factory와 `hooks/use*.ts`의 공개
커스텀 훅을 가집니다. 목록·상세 key를 분리하고 mutation 완료 후 관련 목록과
상세 query를 무효화하거나 제거합니다.

학습 제출 후에는 다음 데이터를 함께 갱신합니다.

- 제출 세션과 결과
- 오답노트 전체
- 대시보드 통계

## Zustand 사용 범위

Zustand에는 서버 응답을 복제하지 않고 다음 클라이언트 상태만 저장합니다.

- credential을 포함하지 않는 최소 인증 UI projection
- 현재 세션 ID와 문제 번호
- 제출 전 선택 답안 `Record<questionId, optionId>`
- 문제풀이 시작 시각
- 낙관적인 즐겨찾기 임시 상태
- 모바일 메뉴 상태

persist middleware와 캐시된 storage adapter를 사용하므로 렌더링마다
`localStorage.getItem`을 반복하지 않습니다.

## 오답노트 상태 머신

| 이벤트                      | wrongCount | correctStreak | 상태      |
| --------------------------- | ---------: | ------------: | --------- |
| 첫 오답                     |          1 |             0 | NEW       |
| NEW에서 정답                |       유지 |             1 | REVIEWING |
| REVIEWING에서 정답          |       유지 |             2 | SOLVED    |
| NEW/REVIEWING에서 오답      |         +1 |             0 | AGAIN     |
| AGAIN에서 첫 정답           |       유지 |             1 | REVIEWING |
| AGAIN에서 두 번째 연속 정답 |       유지 |             2 | SOLVED    |
| SOLVED에서 다시 오답        |         +1 |             0 | AGAIN     |

legacy Alpha UI의 상태 전이는 `apps/web/src/util/wrongNote.ts`가 유지합니다. canonical
Slice 4 submit은 `packages/domain`의 순수 algorithm v1을 사용하고 server-graded
StudyAnswer에서만 USER WrongNote·ReviewSchedule·ReviewEvent를 원자 갱신합니다. 오답 시
`lastWrongAt`, 후속 복습 시 `lastReviewedAt`을 갱신합니다.

## Mock API와 데이터

- MSW browser worker는 dev/test `VITE_API_MODE=mock`에서만 시작합니다.
- real mode와 production은 이전에 등록된 exact same-origin MSW worker를 해제한 뒤
  앱을 렌더링합니다.
- 테스트는 `setupServer`를 사용하며 처리되지 않은 실제 네트워크 요청을
  오류로 간주합니다.
- Mock Repository는 seed를 메모리에 한 번 적재하고 `Map` 색인으로 반복 ID
  조회를 처리합니다.
- mutation은 메모리와 `localStorage`를 함께 갱신합니다.
- 세션 생성 시 문제 스냅샷을 저장하므로 관리자가 원문을 수정·비공개·삭제해도
  진행 중 세션의 채점과 과거 결과가 바뀌지 않습니다.
- canonical v1 MSW는 guest 간 소유권 검증을 위해
  `nihongo.mock_guest_principal` UUID marker를 사용합니다. 브라우저 안의 synthetic
  MSW 응답이 `document.cookie`로 전달하는 local correlation marker라 의도적으로
  non-HttpOnly입니다. mock 안에서는 ownership proof로 작동하지만 실제 API의 signed
  guest credential이나 production 인증 수단은 아닙니다.
- mock persistence v3부터 canonical session은 `canonicalContractVersion: 1`을
  정확히 저장합니다. v2 guest session은 `canonicalGuestPrincipalId`로 안전하게
  복구하지만 marker 없는 v2 USER/ADMIN canonical session은 legacy와 구분할 수 없어
  legacy로 보존됩니다. 해당 session은 canonical GET/submit/result에서 404이므로 새
  canonical session을 생성해야 하며 legacy route의 기존 session은 삭제하지 않습니다.
- canonical v1 MSW의 session expiry는 일반적인 신규 guest를 `startedAt + 24시간`으로
  근사하며 GuestPrincipal 만료 cap 자체는 모사하지 않습니다. 실제 expiry와 retention의
  권위는 Hono/PostgreSQL 구현입니다.
- 문제 삭제 시 관련 즐겨찾기와 오답 레코드를 함께 정리합니다.

seed는 총 65문제이며 각 급수마다 문자·어휘 5문제, 문법 5문제, 독해 3문제를
포함합니다. 모든 문제에는 보기 4개, 정답 1개, 한국어 해설, 태그, 난이도가
있으며 독해 문제에는 별도 지문이 있습니다.

PostgreSQL seed도 같은 65문제를 Question → immutable QuestionVersion v1 →
QuestionOption/Tag/QuestionVersionTag로 적재합니다. deterministic UUID와 콘텐츠
검수 SHA-256을 사용하고, 재실행 시 기존 PUBLISHED row를 덮어쓰지 않습니다.
동일 데이터면 no-op 검증으로 끝나며 내용이 달라지면 새 version 없이 수정하지 않고
실패합니다. 실제 기출·교재 문항은 포함하지 않습니다.

## 테스트와 코드 검증

```bash
# 의도한 포맷·린트 자동 정리(작업 파일이 바뀐)
pnpm run format
pnpm run lint:fix

# 소스를 바꾸지 않는 최종 게이트
pnpm run format:check
pnpm run lint
pnpm run check:architecture
pnpm run test:architecture
pnpm run typecheck
pnpm run test
pnpm run db:migrate:test
pnpm run db:seed:test
pnpm run test:integration
pnpm run test:e2e
VITE_API_MODE=real pnpm run build
git diff --check
```

Phase 3 최종 gate는 architecture fixture 5/5와 live checker, contracts 8 files/45
tests, domain 3 files/21 tests, API unit 34 files/188 tests, web 44 files/222 tests,
fresh unique UTC schema의 PostgreSQL integration 13 files/78 tests와 20 migrations를
통과했습니다. Slice 6 independent UI·transport·auth targeted regression도
통과했습니다. frozen install, format:check, lint, 4-project
typecheck, root build(web production 398 modules), `git diff --check`도 통과했습니다.

Phase 4 Slice 0은 v1 wire와 `submit-v1` hash를 보존하면서 practice contract v2,
server draft·resumable·cancel·result retry, Bookmark와 answer/owner leakage conformance
계약을 분리해 동결했습니다. contracts 11 files/61 tests와 architecture 포함 전체 497
tests, format, lint, typecheck, build, 독립 read-only HIGH/MEDIUM 0 판정을 통과했습니다.
이 Slice에서는 Prisma schema·migration·API route·web 기능과 DB를 변경하지 않았습니다.

Phase 4 Slice 1은 enum-only와 dependent draft/core migration을 분리해 migration 22개로
확장하고, contract version 2의 RANDOM create/get/submit, server draft revision·resumable
list·cancel, historical idempotency replay, effective-expiry 전이와 bounded cleanup을
Hono/PostgreSQL 및 canonical MSW에 구현했습니다. 독립 API client의 revision 1 response
loss → revision 2 save → historical replay → canonical refetch, save/submit/cancel row-lock
경합, foreign/missing 동일 404, old v1 default/replay를 검증했습니다. 최종 unit gate는
architecture 5, contracts 11 files/61, domain 3/21, API 44/237, web 45/233으로 총 557
tests를 통과했고, fresh UTC schema에서 migration 22/22, seed 65/0 후 0/65, PostgreSQL
integration 17 files/99 tests를 통과했습니다. default planner의 640-session populated
fixture로 resumable·cold cleanup·idempotency·child-FK `EXPLAIN (ANALYZE, BUFFERS)`도
검증했으며 production build는 399 modules였습니다.

Slice 1 integration에서 기존 Prisma/adapter-pg relation projection 경로의 pg 8.23
deprecation warning은 5회였고 모두 같은 `PgTransaction` → query-interpreter
`Array.map` stack이었습니다. 실패는 0건이지만 pg 9와 `--throw-deprecation`은 계속
지원하지 않습니다. production v2 노출은 외부 generation lease·monotonic authority,
populated index maintenance 또는 reviewed concurrent-index rollout, exact-target cleanup
scheduler·24시간 SLO가 준비되기 전까지 금지합니다. 실제 browser working-copy·autosave와
hard-reload conflict 복구는 Slice 1 종료 시점에는 Slice 2 소유라 통과했다고
기록하지 않았습니다.

Phase 4 Slice 2는 v2 endpoint·Query Factory·domain hook을 실제 practice UI에 연결하고,
principal·session scoped `sessionStorage` working copy와 750ms debounce, session당 1개
in-flight autosave를 구현했습니다. 응답 유실 시 frozen key/body를 정확히 replay하고,
전송 중 추가 편집은 post-flight diff로 분리해 canonical GET·3-way merge 후에만
다음 revision을 저장합니다. offline 중 network PUT은 열지 않되 visible foreground clock은
계속 누적하고, reconnect canonical GET→PUT, BroadcastChannel/focus fallback, 명시적
conflict 선택, auth epoch·guest owner 격리, 문항별 monotonic elapsed time, submit의
`expectedDraftRevision`, `Control/Meta+Enter` 제출·focus·aria-live·responsive 경계도
닫았습니다.

최종 non-DB gate는 architecture 5, contracts 11 files/61, domain 3/21, API 44/237,
web 52/267을 통과했습니다. non-DB Vitest는 110 files/586 tests, architecture 포함
총 591 tests였고 web production build는 430 modules였습니다. fresh schema
`phase4_slice2_validation_1787043200000_a1b2c3d4_test`에서 migration 22/22,
seed 65/0 후 0/65, PostgreSQL integration 17 files/99 tests를 통과한 뒤 schema
부재를 확인했습니다. Playwright는 별도 fresh schema
`phase4_slice2_e2e_1787047352100_e6a3e15c_test`에서 독립 BrowserContext 충돌,
동일 BrowserContext account switch 중 delayed response 격리, PUT response loss→hard
reload exact replay, offline GET→PUT 복구, 320·375·768·1280px keyboard·focus·submit의
real Chromium 5/5와 mock demo create→autosave→reload 1/1, 총 6/6을 통과했고 schema를
삭제했습니다. immutable Slice 0–2
checkpoint는
`/Users/doji/Desktop/dev/.nihongo-checkpoints/phase4-slice0-2-final-20260818-69ee3d8`입니다.

Phase 4 Slice 3은 `packages/domain`의 deterministic candidate selector와 owner-scoped
PostgreSQL query를 연결해 RANDOM 최근 반복 후순위화, WEAKNESS, WRONG_NOTE,
DAILY_REVIEW를 활성화했습니다. migration 23
`20260818130000_phase4_study_selection_modes`
(`dca1afbcab1cc2fa83c2e16ab3d8f74f76ceb3a42e34c436150dc0b93c9ff852`)는
current review pointer와 ReviewEvent source/mode invariant, selection/dashboard index를
추가했습니다. A의 v1 pin 뒤 v2 publish와 B의 v2 pin, B/A 역순 submit에서도 event pin과
pointer non-rewind를 실제 PostgreSQL에서 확인했습니다.

최종 non-DB gate는 contracts 61, domain 26, API 251, web 275로 112 files/613 tests,
architecture 포함 618 tests를 통과했고 production build는 4/5 workspace projects·web
430 modules였습니다. fresh `phase4_slice3_integration_1787061891771_6c2a4b97_test`에서
migration 23/23, seed 65/0→0/65, integration 18 files/109 tests와 known pg warning 5회를
확인했습니다. fresh `phase4_slice2_e2e_1787062755627_a752c085_test`에서는 real Chromium
7/7+mock 1/1, 총 8/8을 통과했습니다. 두 schema는 runner 종료 뒤 삭제하고 absent를
확인했습니다. immutable Slice 0–3 checkpoint는
`/Users/doji/Desktop/dev/.nihongo-checkpoints/phase4-slice0-3-final-20260818-912cf38`입니다.

Phase 4 Slice 4는 migration 24
`20260821130000_phase4_bookmarks`
(`8ee6b5dde0e73e7c499e24f0fedd0b31ef6ff569f1422c7189cd8eb2499b746f`)로
USER와 stable Question 사이의 Bookmark를 실제 PostgreSQL에 추가했습니다. USER/ADMIN
owner만 canonical GET·PUT·DELETE를 사용할 수 있고 concurrent PUT은 row 하나로 수렴하며,
반복 DELETE는 204입니다. 공개 이력을 가진 archived Question의 Bookmark는 안전한 published
summary로 목록에 보존하지만 새 archived Bookmark와 BOOKMARK 출제 후보에서는 제외합니다.
BOOKMARK 세션은 `createdAt DESC → questionId ASC` 순서, fallback 0, 실제 `actualCount`를
사용하고 standard v2 submit은 `STUDY_SUBMIT` evidence를 남깁니다.

Web과 canonical MSW는 목록·session·result toggle, optimistic inverse rollback, offline
pause→reconnect, account switch/401 mutation cleanup, owner-scoped cache와 pagination clamp를
같은 계약으로 구현했습니다. 최종 non-DB gate는 contracts 11 files/61, domain 4/27,
API 48/268, web 57/301로 Vitest 120 files/657 tests, architecture 포함 662 tests를
통과했고 production build는 4/5 workspace projects·web 438 modules였습니다. fresh
`phase4_slice3_integration_1787286977507_53d6079d_test`에서 migration 24/24,
seed 65/0→0/65, integration 19 files/115 tests와 known pg warning 5회를 확인했습니다.
fresh `phase4_slice2_e2e_1787286296610_f6e52f37_test`에서는 real Chromium 8/8+mock
1/1, 총 9/9을 통과했습니다. 두 schema는 runner 종료 뒤 삭제하고 absent를 확인했습니다.
immutable Slice 0–4 checkpoint는
`/Users/doji/Desktop/dev/.nihongo-checkpoints/phase4-slice0-4-final-20260821-b0c26d4`입니다.

Phase 4 Slice 5는 migration 25
`20260821150000_phase4_result_retry`
(`3db1e757030803b9b8078673e4dcdc1743a929a98856a7529d6e5cbcd6c8c5da`)로
StudySession retry relation과 USER/guest owner composite FK, non-self·SUBMITTED/result
source invariant, retry idempotency committed-state exactness를 PostgreSQL에 추가했습니다.
source ordinal의 incorrect item 중 logical ACTIVE Question과 PUBLISHED/RETIRED source pin만
target revision 0 draft로 복사하며 fallback은 없습니다. retry submit은 historical pin을
유지하고 USER/ADMIN은 `WRONG_NOTE_REVIEW`, guest는 영구 review fact 없이 처리됩니다.

Web과 canonical MSW는 response-loss 뒤 sessionStorage의 같은 key를 hard reload에서
복구하고 canonical target GET 뒤 이동합니다. 48시간 draft와 7일 retry record cleanup은
operation별로 격리되고 active replay record를 보존하며 retry chain은 leaf-first로
삭제됩니다. 최종 non-DB gate는 contracts 11 files/62, domain 5/30, API 52/288, web
62/325로 Vitest 130 files/705 tests, architecture 포함 710 tests를 통과했고 production
build는 4/5 workspace projects·web 444 modules였습니다. fresh
`phase4_slice5_integration_1787296415144_95cf5842_test`에서 migration 25/25,
seed 65/0→0/65, full 20 files/124 pass + historical-pin 1 deliberate skip와 isolated
historical-pin 1 pass, unique pass 125를 확인했습니다. pg warning은 full 7회 + isolated
1회 = 8회이고 별도 trace-deprecation retry 5/5에서 기존 stack과 동작 실패 0을
확인했습니다. fresh `phase4_slice2_e2e_1787297986886_cb5cfd2c_test`에서는 real Chromium
9/9+mock 1/1, 총 10/10을 통과했습니다. 두 schema는 종료 뒤 삭제하고 absent를
확인했습니다. immutable Slice 0–5 checkpoint는
`/Users/doji/Desktop/dev/.nihongo-checkpoints/phase4-slice0-5-final-20260821-265d732`입니다.

Phase 4 Slice 6은 active UI의 canonical-only cutover, production mock fail-closed,
fresh-schema runner의 warning/process-tree stop-gate와 responsive·keyboard·focus·network-loss
browser matrix를 닫았습니다. non-DB gate는 contracts 11 files/62, domain 5/30,
API 54/293, web 65/333으로 Vitest 135 files/718 tests, architecture 포함 총 723 tests를
통과했고 production build는 4/5 workspace projects·web 428 modules였습니다.
`VITE_API_MODE=mock` production build는 명시 오류로 거부됐고 정상 artifact에는
`mockServiceWorker.js`가 없습니다.

Node 22.23.0에서 packageManager·Volta·`.npmrc`로 strict pin한 pnpm 10.2.1 direct
`pnpm install --frozen-lockfile`은 exit 0이었습니다. local Corepack bootstrap은 host keyring
signature mismatch로 pnpm 시작 전에 exit 1이었고 integrity 검증 비활성화 우회는 사용하지
않았습니다. CI는 pnpm/action-setup 뒤 같은 direct frozen gate를 실행합니다.

fresh `phase4_slice5_integration_1787309969208_b39eb895_test`에서 migration 25/25,
seed 65/0→0/65, full 20 files/124 pass+1 deliberate skip와 isolated historical-pin
1 pass+4 deliberate skip, unique pass 125를 확인했습니다. pg warning은 full 7회+
isolated 1회이며 모든 8개 block이 승인된 `PgTransaction.performIO` → `interpretNode` →
`Array.map` stack과 일치했습니다. fresh
`phase4_slice2_e2e_1787310025833_673c9c90_test`에서는 real Chromium 10/10+mock 1/1,
총 11/11을 통과했습니다. submit/draft/retry response-loss, guest mode matrix, two-context
conflict/account switch와 네 viewport keyboard/focus/reduced-motion/44px를 포함하며 두
schema는 종료 뒤 삭제·absent였습니다. immutable Slice 0–6 checkpoint는
`/Users/doji/Desktop/dev/.nihongo-checkpoints/phase4-slice0-6-final-20260821-b0b6713`입니다.

CI source 연결은 완료했습니다. remote CI 결과는 branch push 이후 GitHub에서 별도로
확인하며 이 local acceptance evidence에는 포함하지 않습니다. production deploy·v2
exposure도 외부 generation lease/writer drain,
cleanup scheduler/runbook과 SLO evidence가 없어 계속 금지합니다.

production real preview에서 guest RANDOM keyboard·미응답 제출/result와 USER
login→RANDOM 5문제 all-null 제출→result 0/5→WrongNote list/detail→dashboard를 실제
브라우저로 확인했습니다. USER logout 후 ADMIN login에서는 자기 목록이 비고 USER detail
URL은 같은 Not Found였으며 console warning/error는 0건입니다. mock dev browser에서는
legacy RANDOM, bookmark 노출, keyboard·미응답 submit/result 회귀를 확인했습니다.
320/768/1280px에서 horizontal overflow가 없고 dialog focus·result heading 이동을
확인했습니다.

다음 Phase 3 완료 기록은 당시 browser 검증 범위를 보존한다. 별도 두 번째 cookie jar는 같은 USER로 독립 로그인해 첫 client의
result/list/detail/dashboard를 다시 읽었습니다. 이는 DB 기반 cross-client persistence를
증명하지만 두 번째 GUI browser smoke는 아닙니다. 설치된 Chrome에 ChatGPT extension이
없어 literal second-browser 자동화는 실행하지 못했으며 LOW 환경 follow-up으로 남깁니다.

fresh DB gate는 migration 20/20, seed first 65/0와 root integration reseed 0/65,
Question/Version/Option/QuestionVersionTag/Tag 65/65/260/130/108 및 전 QuestionVersion
`SYSTEM_SEED`를 확인한 뒤 임시 schema를 삭제했습니다. cleanup 전후 기본
`slice3_validation` 20-table과 dev 12-table의 full row-content digest가 같아
ledger·seed도 변경되지 않았습니다. integration 중 Prisma 7.9.1 +
`@prisma/adapter-pg` 7.9.1 + pg 8.23 transaction relation projection의
`Client.query already executing` deprecation warning이 정확히 2회 있었고 실패는
0건입니다. `--trace-deprecation`으로 query-interpreter `Array.map` 경로를 확인했으며
pg 8.23을 고정합니다. pg 9와 `--throw-deprecation`은 현재 지원되지 않아 reviewed
sequential scalar query refactor 전 warning stack이나 동작 변화는 blocker입니다.

주요 테스트 범위는 다음과 같습니다.

- 채점 결과, 미응답, 잘못된 문제·보기 ID
- 오답노트 전체 상태 전이
- 공개 문제에서 정답·해설 제거
- seed 기반 Fisher-Yates shuffle의 재현성과 원본 불변성
- 65개 seed 수량·고유 ID·필수 데이터·정답 위치 분포
- Mock Repository의 영속화와 오답 누적
- 세션 소유권 격리, 게스트 모드 제한, 문제 스냅샷 기반 채점
- 로그인 → 세션 생성 → 제출 → 오답 저장 MSW 통합 흐름
- 문제 보기 선택과 숫자 키보드 단축키
- 관리자 문제 폼 유효성 검증
- 오답 빈 상태와 전역 네트워크 오류 상태
- workspace reverse dependency와 runtime cycle
- Hono live/readiness/error/request ID와 secret redaction
- fresh PostgreSQL test DB의 Prisma migration 및 readiness
- Question/Version/Option/Tag seed 65/65/260/130 수량과 재실행 무변경
- same-parent FK, 4개 보기·태그 publish gate, PUBLISHED 불변 trigger
- 실제 Hono list/detail, filter/pagination, MSW 계약 동등성, 민감 필드 누출 0건
- Better Auth email verification/reset, DB session, signed GuestPrincipal과 role/owner
  policy
- 공개 ADMIN route 부재, 원자적·멱등 operator provisioning, auth
  Origin/content-type/body-size/trusted-client-IP/rate boundary
- `/me` anonymous no-write, scanner-safe email verification, auth transition race와
  `Retry-After` client backoff
- canonical submit/result strict contract, server grading과 historical
  `wrongNoteStatus`
- same-key replay, key reuse/different-key conflict, concurrent exactly-once와 forced
  transaction rollback
- guest submit의 WrongNote/ReviewEvent 0건, guest retention cascade와 USER submitted
  aggregate 보존
- owner-scoped WrongNote list/detail, guest 401, foreign/missing detail 404
- last-wrong historical snapshot·exact tag label과 current availability 분리,
  `hasMemo: false`·`memo: null`
- dashboard UTC inclusive activity range·7일 zero-fill과 all-time WrongNote aggregate
- 15→20 forward migration, submission integrity·latest-wrong·retention/history와
  Slice 5 read index·historical label constraint
- application pool·seed `TimeZone=UTC`와 UTC 자정 경계
- canonical MSW submit/result parity와 persisted state v2→v3 fail-closed migration
- canonical WrongNote/dashboard MSW handler와 direct-fetch shared-contract parity

## 접근성

- `header`, `nav`, `main`, `footer` landmark와 순차적인 heading 사용
- 본문 바로가기 링크와 명확한 `focus-visible` 표시
- native radio 기반 문제 보기와 전체 클릭 가능한 레이블
- 숫자 1~4 및 좌우 화살표 키보드 조작, 입력 중 단축키 비활성화
- native `dialog` 기반 포커스 트랩, Escape 닫기, trigger 포커스 복귀
- 폼 label, `aria-invalid`, `aria-describedby`, 인라인 오류 연결
- 진행률 `progress`, 비동기 상태 `aria-live`, 표의 caption·thead·tbody·th
- 정답·오답과 상태를 색상뿐 아니라 텍스트로 함께 표시
- 최소 터치 영역, reduced motion, 모바일 한 열과 데스크톱 독해 2열

## 성능 구현 포인트

- 도메인 라우트와 관리자 페이지 lazy loading
- React Compiler 활성화, 불필요한 `memo/useMemo/useCallback` 배제
- 서버 상태 중복 없이 TanStack Query 캐시 사용
- 반복 ID 조회는 `Map`, membership 조회는 `Set` 사용
- 원본 배열을 변경하지 않는 seed 기반 Fisher-Yates shuffle
- 긴 오답·결과 카드에 `content-visibility: auto` 적용
- 과목 약점은 정렬 없이 한 번의 순회로 계산
- 저장소 메모리 캐시와 mutation 시 직렬화
- 문제풀이 전 정답·해설과 관리자 전용 필드를 payload에서 제거

## 저작권 안내

이 프로젝트는 실제 JLPT 기출문제, 공식 문제, 시중 문제집 또는 유료 교재 문항을
복제하지 않습니다. 모든 샘플 문제와 해설은 서비스 구조 검증을 위해 자체
제작한 더미 데이터이며, 공식 시험과 동일한 문항이라고 주장하지 않습니다.

## 실제 백엔드 이관 상태

1. `packages/contracts`에서 operation 계약을 먼저 확정합니다.
2. web endpoint와 MSW가 같은 contract subpath를 소비하게 이관합니다.
3. Hono route가 request와 response를 같은 contract로 검증합니다.
4. Mock Repository의 책임을 PostgreSQL repository와 application service로 옮깁니다.
5. operation별 parity test 후 해당 Query를 real API로 전환합니다.

Slice 0은 workspace·API 운영 기반·PostgreSQL readiness, Slice 1은 immutable
Question catalog와 실제 Hono 공개 목록·상세 API를 제공합니다. Slice 2는 Better
Auth 1.6.28, DB session, signed GuestPrincipal, email verification/reset,
USER/ADMIN authorization과 `/api/v1/me`를 구현했습니다. 공개 auth surface는 8개
POST facade로 제한하고, browser session projection은 `/api/v1/me`만 사용합니다.
Slice 3은 RANDOM StudySession create/read, ordered QuestionVersion pinning과
guest/user ownership을 실제 Hono/PostgreSQL에 구현했습니다. canonical v1 MSW 병행
경로는 같은 contract를 소비합니다. Slice 4는 `packages/domain` server grading,
StudyAnswer/Result/IdempotencyRecord, atomic submit/result와 USER
WrongNote/ReviewSchedule/ReviewEvent side effect를 Hono/PostgreSQL과 canonical MSW에
구현했습니다. Slice 5는 owner-scoped WrongNote list/detail의 last-wrong historical
entitlement, current availability와 UTC-bounded dashboard를 Hono/PostgreSQL 및
canonical MSW/direct-fetch 경로에 구현했습니다. Slice 6은 이 canonical core를
Query Factory·domain hook·기존 UI consumer에 연결하고 real/mock 회귀, production Mock
fail-closed와 staged rollback 경계를 검증해 Phase 3를 완료했습니다. Phase 4는
Slice 0의 계약 정규화, Slice 1의 additive DB·API·canonical MSW, Slice 2의 Web
autosave·working-copy·복구·conflict UX, Slice 3의 selection engine·non-RANDOM mode와
all-mode dashboard, Slice 4의 Bookmark PostgreSQL/API/UI·BOOKMARK mode와 실제 Chromium
gate, Slice 5의 historical-pin result retry·response-loss exact replay와 retry-aware
lifecycle, Slice 6의 canonical UI cutover·CI·browser close까지
`codex/phase-4-practice-flow`에서 완료했습니다. 프로젝트 소유자의 명시적 지시로
`6116b9d`에서 `codex/phase-5-review-center`를 만들고 Phase 5 Slice 0을 완료했습니다.
review queue·memo·history·targeted review와 v2 filter의 strict shared contract/conformance,
두 forward migration의 DDL·rollback·query-plan 사전 검토만 반영했으며 Prisma,
migration, API, MSW와 Web application은 Slice 0 종료 시점까지 변경하지 않았고
Slice 1도 시작하지 않았습니다.

## 향후 개선

- 전체 학습 operation의 PostgreSQL 이관과 운영 배포
- 청해와 음원 학습
- 시간 제한 시험 모드
- 검수된 AI 보조 해설
- 한국어·일본어 UI 전환
- 학습 목표와 유료 플랜
