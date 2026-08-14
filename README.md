# JLPT Drill Note

JLPT N5부터 N1까지 문자·어휘, 문법, 독해 문제를 풀고, 틀린 문제를
자동으로 오답노트에 저장해 반복 학습하는 풀스택 포트폴리오 프로젝트입니다.

저장소는 pnpm workspace입니다. `apps/web`의 Vite 애플리케이션과
`apps/api`의 Hono API 운영 기반, `packages/contracts`의 공유 Zod 계약을
workspace root 명령으로 함께 개발·검증합니다.

이번 MVP는 정적인 화면 목업이 아닙니다. 문제 세션 생성, 답안 제출과 채점,
오답 상태 변경, 즐겨찾기, 학습 통계, 관리자 문제 CRUD가 실제 사용자 흐름으로
연결됩니다. 인증, 공개 문제 read, RANDOM StudySession create/read는 PostgreSQL 기반
실제 API로 구현됐습니다. 제출·결과·오답·즐겨찾기·통계·관리자 학습 흐름과 현재 기본
학습 UI transport는 아직 MSW 기반 Mock API가 담당하며 operation 단위로 이관
중입니다. UI와 TanStack Query 계층을 유지한 채 전환할 수 있도록 공유 계약과
transport 경계를 분리했습니다.

## 서비스 목적

- 급수와 과목별로 짧게 반복 학습할 수 있는 JLPT 문제풀이 흐름 제공
- 틀린 문제를 자동 기록하고 두 번 연속 정답까지 복습 상태 추적
- 관리자용 문제 등록·수정·삭제 흐름을 포함한 실제 서비스형 구조 제시
- 한국어 UI와 모바일 우선 설계로 접근 가능한 학습 경험 제공

청해, 음원, 결제, 커뮤니티, AI 문제 생성·해설과 OAuth는 현재 범위에 포함하지
않습니다. email/password 회원가입·인증·재설정은 실제 API로 이관했습니다.

## 주요 기능

- N5~N1, 문자·어휘·문법·독해 학습 설정과 5·10·20문제 출제
- RANDOM, WRONG_NOTE, WEAKNESS, BOOKMARK 출제 모드
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

| 구분      | 지원 항목                       |
| --------- | ------------------------------- |
| 급수      | N5, N4, N3, N2, N1              |
| 과목      | 문자·어휘, 문법, 독해           |
| 문제 수   | 5, 10, 20                       |
| 출제 모드 | 랜덤, 오답, 약점 추천, 즐겨찾기 |
| 제외      | 청해와 음원 재생                |

## 기술 스택

- Vite 8, React 19, TypeScript
- React Router `createBrowserRouter`
- TanStack Query, Zustand
- Axios, Zod, MSW
- React Hook Form
- Tailwind CSS
- React Compiler
- Vitest, React Testing Library, user-event, jsdom
- ESLint, Prettier, pnpm workspace
- Hono, `@hono/node-server`
- PostgreSQL 18, Prisma ORM 7과 `@prisma/adapter-pg`
- Better Auth 1.6.28과 official Prisma adapter
- `packages/contracts` 기반 strict Zod API 계약

## 실행 방법

Node.js 22.23.0과 pnpm 10.2.1, Docker Desktop이 필요합니다. macOS에서는
`brew install volta`로 Volta를 준비하면 별도의 nvm 없이 저장소 pin과 같은
런타임을 사용할 수 있습니다.

pnpm 10은 루트 `.npmrc`의 `use-node-version=22.23.0`을 읽으므로 `pnpm run`
명령과 lifecycle script도 저장소가 지정한 Node를 사용합니다. `.nvmrc`, Volta,
pnpm runtime pin은 모두 같은 버전을 가리킵니다.

```bash
volta install node@22.23.0 pnpm@10.2.1
pnpm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
cp apps/api/.env.test.example apps/api/.env.test
docker compose up -d postgres
pnpm run db:migrate:dev:deploy
pnpm run db:seed:dev
pnpm run db:migrate:test
pnpm run db:seed:test
pnpm dev
```

`db:migrate:dev:deploy`는 저장소에 커밋된 migration을 로컬 개발 DB에
적용합니다. 새 migration을 작성할 때만 별도의 shadow DB 권한이 필요한
`pnpm run db:migrate:dev`를 사용합니다.

로컬 dev/test에서 만료된 guest-owned IN_PROGRESS session과 참조 없는 만료 guest를
한 batch 정리하려면 exact target guard와 확인 문자열을 함께 사용합니다.

```bash
STUDY_CLEANUP_CONFIRM=DELETE_EXPIRED_GUEST_STUDY_DATA \
  pnpm run study:cleanup-expired-guests
```

이 명령은 loopback의 `_dev`/`_test` DB만 허용하며 production에서는 hard-block됩니다.
운영 cleanup은 별도 exact-target 승인, runbook과 scheduler가 준비된 뒤 활성화합니다.

기본 웹 주소는 `http://localhost:5173`, API 주소는
`http://127.0.0.1:3001`입니다. API 상태는 `/health/live`와
`/health/ready`에서 확인합니다. 현재 웹은 기본적으로 MSW를 사용하므로 실제 API
이관이 완료되지 않은 학습 기능도 계속 실행됩니다.

웹 또는 API만 실행하려면 다음 명령을 사용합니다.

```bash
pnpm dev:web
pnpm dev:api
```

프로덕션 번들을 로컬에서 확인하려면 다음 명령을 실행합니다.
빌드 결과는 `apps/web/dist`에 생성됩니다.

```bash
pnpm build
pnpm preview
```

## 환경 변수

```dotenv
VITE_API_BASE_URL=/api
VITE_ENABLE_MOCKS=true

DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:55432/nihongo_dev?schema=public
TRUSTED_ORIGINS=http://localhost:5173
LOG_LEVEL=info
BETTER_AUTH_SECRET=replace_with_at_least_32_random_characters
BETTER_AUTH_URL=http://localhost:3001
GUEST_COOKIE_SECRET=replace_with_a_different_32_char_secret
AUTH_EMAIL_FROM=auth@example.test
AUTH_EMAIL_DELIVERY_MODE=test-sink
AUTH_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
```

- 개발 환경에서는 Mock API가 기본 활성화됩니다.
- 로컬 Hono API를 사용하려면 `apps/web/.env`에서
  `VITE_ENABLE_MOCKS=false`로 바꿉니다. Vite가 같은 origin의 `/api` 요청을
  `http://127.0.0.1:3001`로 전달하므로 별도 wildcard CORS를 열지 않습니다.
- 프로덕션 빌드는 기본적으로 Mock API를 사용하지 않습니다.
- 포트폴리오 데모 빌드에서 MSW를 사용하려면 빌드 시
  `VITE_ENABLE_MOCKS=true`를 지정합니다.
- 실제 API mode에서도 기본 `VITE_API_BASE_URL=/api`를 유지해 SPA와 API를 같은
  origin으로 제공합니다. 개발 중 absolute API 주소를 사용할 때만 정확한
  `TRUSTED_ORIGINS`와 credentialed CORS를 사용하며 wildcard는 허용하지 않습니다.
- `DATABASE_URL`은 `apps/api`에서만 읽으며 web bundle에 포함하지 않습니다.
- 통합 테스트 DB 이름은 안전장치상 반드시 `_test`로 끝나야 합니다.
- 격리된 임시 test DB를 검증할 때만 `PRISMA_TEST_DATABASE_URL`로 test
  migration과 seed target을 명시적으로 덮어쓸 수 있으며 동일한 `_test`·loopback
  안전장치를 적용합니다.
- 운영 secret과 실제 비밀번호는 `.env.example`에 커밋하지 않습니다.
- 운영 email은 `AUTH_EMAIL_DELIVERY_MODE=webhook`과 HTTPS webhook
  URL/secret을 사용합니다. `test-sink`는 자동 테스트·로컬 구조 검증용이며 실제
  메일함을 대체하지 않습니다. 전송은 capacity 100/concurrency 2의 bounded
  in-process queue로 request path와 분리되고 정상 종료 시 drain됩니다. 이 queue는
  durable outbox가 아니므로 비정상 process 종료 시 queued email은 유실될 수
  있습니다.

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

Mock 모드(`VITE_ENABLE_MOCKS=true`)의 로컬 자격 증명은 다음과 같습니다.

| 역할  | 이메일            | 비밀번호         | 사용 범위                            |
| ----- | ----------------- | ---------------- | ------------------------------------ |
| GUEST | 없음              | 없음             | 문제풀이와 결과 확인, 영구 저장 불가 |
| USER  | user@example.com  | Demo-user-2026!  | 오답노트, 즐겨찾기, 대시보드 포함    |
| ADMIN | admin@example.com | Demo-admin-2026! | USER 기능과 관리자 문제 CMS          |

Mock mode는 위 두 고정 계정의 sign-in/sign-out과 guest projection만 지원합니다.
회원가입, 이메일 인증, 비밀번호 재설정은 성공을 가장하지 않고 UI에서 비활성화하며,
실제 흐름은 `VITE_ENABLE_MOCKS=false`에서 검증합니다. Mock 인증 projection은 로컬
demo state일 뿐 session credential이 아닙니다.

실제 API의 초기 ADMIN은 공개 role-switch route가 아니라 operator command로만
생성합니다. 기존 USER를 승격하거나 기존 ADMIN password를 덮어쓰지 않으며, 실행
결과에는 email/password 대신 user ID와 provisioning reference의 SHA-256만 남깁니다.

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
│   ├── api/                # Hono app, Prisma, auth/guest/public question API
│   │   ├── prisma/         # schema, reviewed migration, 65문제 seed
│   │   └── src/            # app, middleware, DB, service/repository
│   └── web/
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
│   └── contracts/          # canonical request/response/error Zod 계약
├── infra/postgres/         # 로컬 test DB 초기화
├── compose.yaml            # PostgreSQL 18.4 개발·테스트 환경
├── package.json            # workspace 명령과 공통 품질 도구
├── pnpm-workspace.yaml
├── eslint.config.mjs
└── prettier.config.mjs
```

`apps/api`와 `packages/contracts`는 Phase 3 Slice 0의 실제 운영 코드와 계약
테스트를 소유합니다. 순수 채점·복습 로직을 소유할 `packages/domain`은 해당 로직을
서버 제출 경로로 옮기는 Slice 4 전에는 만들지 않습니다.

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
  → MSW handler
  → MockDatabase
```

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

상태 전이는 `apps/web/src/util/wrongNote.ts`의 순수 함수로 구현하고 단위 테스트합니다.
오답 시 `lastWrongAt`, 복습 시 `lastReviewedAt`을 갱신합니다.

## Mock API와 데이터

- MSW browser worker는 개발 환경 또는 `VITE_ENABLE_MOCKS=true`에서 시작합니다.
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
pnpm run format
pnpm run lint:fix
pnpm run check:architecture
pnpm run typecheck
pnpm run test
pnpm run db:migrate:test
pnpm run db:seed:test
pnpm run test:integration
pnpm run build
```

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
경로는 같은 contract를 소비하지만 기존 Alpha 학습 Query/UI는 Slice 6 cutover까지
legacy MSW transport를 유지합니다. submit/result는 Slice 4 범위입니다.

## 향후 개선

- 전체 학습 operation의 PostgreSQL 이관과 운영 배포
- 청해와 음원 학습
- 시간 제한 시험 모드
- 검수된 AI 보조 해설
- 한국어·일본어 UI 전환
- 학습 목표와 유료 플랜
