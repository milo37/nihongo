# JLPT Drill Note

> 현재 인증 기준(2026-10-19): 사용자 결정으로 SSO 전용 가입·재로그인으로 전환합니다. 아래의 과거 데모 역할 선택·이메일/암호·미구현 OAuth 설명은 superseded 이력입니다. 최신 사용자 확정 공급자는 Apple과 Google뿐이며 이전 Google 1차 기획 기준을 대체합니다. FE 화면 체크포인트, CMS와 독립된 공개 SSO·내부 회원/세션 연결, 별도 ADMIN_FRESH와 legacy 암호/mail startup 퇴역을 추가했습니다. 로컬 production-shaped fake-port 검증과 실제 운영/DB/OAuth는 구분하며 계정 관리 전체·실제 자료 정리·운영 검증은 남아 있습니다. [현재 계약과 남은 구현](team/sso-authentication.md)을 따릅니다.

JLPT N5부터 N1까지 문자·어휘, 문법, 독해 문제를 풀고, 틀린 문제를
자동으로 오답노트에 저장해 반복 학습하는 프런트엔드 포트폴리오
프로젝트입니다.

저장소는 pnpm workspace이며, 현재 실행 가능한 Vite 애플리케이션은
`apps/web`에 있습니다. workspace root의 명령으로 개발·검증 작업을
일관되게 실행합니다.

이번 MVP는 정적인 화면 목업이 아닙니다. 문제 세션 생성, 답안 제출과 채점,
오답 상태 변경, 즐겨찾기, 학습 통계, 관리자 문제 CRUD가 실제 사용자 흐름으로
연결됩니다. 실제 백엔드 대신 MSW 기반 Mock API를 사용하며, UI와 TanStack Query
계층을 유지한 채 실제 API로 교체할 수 있도록 계층을 분리했습니다.

## 서비스 목적

- 급수와 과목별로 짧게 반복 학습할 수 있는 JLPT 문제풀이 흐름 제공
- 틀린 문제를 자동 기록하고 두 번 연속 정답까지 복습 상태 추적
- 관리자용 문제 등록·수정·삭제 흐름을 포함한 실제 서비스형 구조 제시
- 한국어 UI와 모바일 우선 설계로 접근 가능한 학습 경험 제공

청해, 음원, 결제, 커뮤니티, AI 문제 생성·해설, 실제 회원가입과 OAuth는 MVP
범위에 포함하지 않습니다.

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

## 실행 방법

Node.js LTS 22 이상과 pnpm이 필요합니다.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm dev
```

기본 개발 주소는 `http://localhost:5173`입니다.

프로덕션 번들을 로컬에서 확인하려면 다음 명령을 실행합니다.
빌드 결과는 `apps/web/dist`에 생성됩니다.

```bash
pnpm build
pnpm preview
```

실제 Hono API와 PostgreSQL을 함께 실행할 때 루트 `.env`는 Docker Compose가,
`apps/api/.env`와 `.env.test`는 API·migration·seed process가 읽습니다. Phase 7은
canonical wrapper login을 영구 보관하는 로컬 기술 DB와 wrapper를 매번 생성·회수하는
통합 테스트 DB를 의도적으로 분리합니다.

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
cp apps/api/.env.test.example apps/api/.env.test
```

루트 `.env`의 `POSTGRES_PASSWORD`와 열 개 `PHASE7_*_PASSWORD`에는 각각 다른
24자 이상의 URL-safe local secret을 넣습니다. 예를 들어 각 항목마다
`openssl rand -hex 24`를 새로 실행할 수 있습니다. `apps/api/.env(.test)` URL의
password도 대응하는 root 값과 같게 바꿉니다. 예시의 `replace_me*`, 빈 값,
중복 값은 fresh-volume init에서 거부됩니다.

Phase 7 로컬 기술 DB는 명시적 profile, 별도 55433 port, 별도 Compose project
volume에서만 시작합니다. init은 fresh volume에서 TEST와 DEVELOPMENT의 canonical
NOLOGIN role, wrapper login, SET-only membership, database/schema owner, `pgcrypto`,
exact CONNECT ACL을 만든 뒤 스스로 재검증합니다.

```bash
docker compose --project-name nihongo-phase7-local \
  --profile phase7-local up -d --wait postgres-phase7
node --test scripts/phase7-local-provisioning.test.mjs
```

init script는 빈 volume에서 한 번만 실행되며 전체 self-attestation 뒤에만 health
sentinel을 남깁니다. secret 검증이나 init이 실패한 volume은 health가 열리지 않으며,
credential을 고친 뒤에도 재사용하지 말고 해당 local Compose project volume을 새로
만들어야 합니다. 기존 volume을 자동 수리하거나 운영 cluster에 적용하지 않습니다. 이
profile과 credential은 TEST/DEVELOPMENT local-only이며 production provisioning의
대체물이 아닙니다.

TEST 기술 workflow는 `.env.test`에서 `ADMIN_CMS_MODE=technical`로 바꾸고
`DATABASE_URL`을 다음 canonical app wrapper로 바꾼 뒤 migration→seed→startup 순서로
실행합니다. password에는 root의 `PHASE7_TEST_APP_PASSWORD` 값을 사용합니다.

```dotenv
DATABASE_URL=postgresql://nihongo_test_app_login:TEST_APP_PASSWORD@127.0.0.1:55433/nihongo_test?schema=public
```

```bash
NODE_ENV=test pnpm run db:migrate:phase7
ADMIN_CMS_MODE=technical pnpm run db:seed:test
# 아래 one-way local write는 명시적 후속 승인 후에만 실행합니다.
docker compose --project-name nihongo-phase7-local \
  --profile phase7-local exec -T postgres-phase7 sh -eu -c \
  'PGPASSWORD="$PHASE7_TEST_MIGRATION_PASSWORD" PGOPTIONS="-c role=nihongo_phase7_migration" psql --username nihongo_test_phase7_migration_login --dbname nihongo_test --set=phase7_environment=TEST --file=/docker-entrypoint-initdb.d/phase7-local-activate.psql'
DOTENV_CONFIG_PATH=.env.test ADMIN_CMS_MODE=technical \
  pnpm run dev:api
```

DEVELOPMENT 기술 workflow는 `.env`에서 `ADMIN_CMS_MODE=technical`로 바꾸고
`DATABASE_URL`을 다음 canonical app wrapper로 바꾼 뒤 같은 순서를 사용합니다.
password에는 root의 `PHASE7_DEVELOPMENT_APP_PASSWORD` 값을 사용합니다.

```dotenv
DATABASE_URL=postgresql://nihongo_development_app_login:DEVELOPMENT_APP_PASSWORD@127.0.0.1:55433/nihongo_dev?schema=public
```

```bash
pnpm run db:migrate:phase7
ADMIN_CMS_MODE=technical pnpm run db:seed:dev
# 아래 one-way local write는 명시적 후속 승인 후에만 실행합니다.
docker compose --project-name nihongo-phase7-local \
  --profile phase7-local exec -T postgres-phase7 sh -eu -c \
  'PGPASSWORD="$PHASE7_DEVELOPMENT_MIGRATION_PASSWORD" PGOPTIONS="-c role=nihongo_phase7_migration" psql --username nihongo_development_phase7_migration_login --dbname nihongo_dev --set=phase7_environment=DEVELOPMENT --file=/docker-entrypoint-initdb.d/phase7-local-activate.psql'
ADMIN_CMS_MODE=technical pnpm run dev:api
```

각 activation command는 등록된 local endpoint를 확인한 뒤 legacy issuer/session과 legacy
wrapper CONNECT를 one-way로 닫는 persistent local DB write입니다. migration과 seed만
확인할 때는 실행하지 않으며, 명시적 후속 승인 전에는 실행 금지입니다. technical startup의
readiness gate는 activation 전에는 의도적으로 실패하므로, 승인된 disposable local
volume에서 기술 runtime을 실제 시작할 때만 한 번 실행합니다.

`db:migrate:phase7`은 저장소에 커밋된 migration을 canonical migration wrapper와
startup role로 적용합니다. 새 migration 작성용 `db:migrate:dev`와 과거 일반
`db:migrate:dev:deploy`/`db:migrate:test`는 이 Phase 7 external-provisioning workflow에
사용하지 않습니다.

통합 runner는 영구 wrapper가 없는 기본 55432 service만 사용합니다.
`apps/api/.env.test`의 `PHASE7_INTEGRATION_DATABASE_URL`과
`PHASE7_API_INTEGRATION_DATABASE_URL`을 bootstrap `nihongo` login의 55432 URL로
유지한 상태에서 실행합니다.

```bash
docker compose up -d --wait postgres
pnpm run test:phase7:db
pnpm run test:phase7:api
```

runner는 canonical wrapper login이 하나라도 이미 존재하면 안전하게 중단합니다. 따라서
두 integration URL을 `postgres-phase7`/55433으로 바꾸거나 두 workflow가 같은 volume을
공유하게 만들지 않습니다.

## 환경 변수

```dotenv
VITE_API_BASE_URL=/api
VITE_ENABLE_MOCKS=true
```

- 개발 환경에서는 Mock API가 기본 활성화됩니다.
- 프로덕션 빌드는 기본적으로 Mock API를 사용하지 않습니다.
- 포트폴리오 데모 빌드에서 MSW를 사용하려면 빌드 시
  `VITE_ENABLE_MOCKS=true`를 지정합니다.
- 실제 API로 전환할 때 `VITE_API_BASE_URL`을 서버 주소로 변경합니다.

## 데모 계정

`/login`에서 별도의 비밀번호 없이 역할을 선택합니다.

| 역할  | 데모 사용자 | 목표 급수 | 사용 범위                            |
| ----- | ----------- | --------- | ------------------------------------ |
| GUEST | 게스트      | N3 기본값 | 문제풀이와 결과 확인, 영구 저장 불가 |
| USER  | 데모 학습자 | N2        | 오답노트, 즐겨찾기, 대시보드 포함    |
| ADMIN | 데모 관리자 | N1        | USER 기능과 관리자 문제 CMS          |

로그인 전에 보호된 경로에 접근하면 원래 경로를 `redirect`로 보존하고, 로그인
후 해당 경로로 돌아갑니다. 데모 상태와 학습 기록은 현재 브라우저의
`localStorage`에만 저장됩니다.

## 폴더 구조

```text
.
├── apps/
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
├── package.json            # workspace 명령과 공통 품질 도구
├── pnpm-workspace.yaml
├── eslint.config.mjs
└── prettier.config.mjs
```

Phase 1A에서는 실제 소유 코드가 없는 `apps/api`나 `packages/*`
placeholder를 만들지 않습니다.

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

- 데모 인증 메모리 상태
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
- 문제 삭제 시 관련 즐겨찾기와 오답 레코드를 함께 정리합니다.

seed는 총 65문제이며 각 급수마다 문자·어휘 5문제, 문법 5문제, 독해 3문제를
포함합니다. 모든 문제에는 보기 4개, 정답 1개, 한국어 해설, 태그, 난이도가
있으며 독해 문제에는 별도 지문이 있습니다.

## 테스트와 코드 검증

```bash
pnpm run format
pnpm run lint:fix
pnpm run typecheck
pnpm run test
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

## 실제 백엔드로 교체하는 방법

1. MSW 비활성화 후 `VITE_API_BASE_URL`을 실제 서버 주소로 변경합니다.
2. 현재 `apps/web/src/api/*/*/schema.ts` 계약과 동일한 JSON 응답을 서버에서 제공합니다.
3. 인증 interceptor에 실제 access token 또는 cookie 정책을 연결합니다.
4. Mock Repository의 세션·오답 상태 로직을 서버 application service와 DB로
   이전합니다.
5. 계약이 달라지는 경우 endpoint schema와 API 함수만 조정하고 Query 훅과
   UI의 공개 타입은 유지합니다.

## 향후 개선

- 실제 회원가입, OAuth와 서버 세션 인증
- 실제 백엔드, PostgreSQL과 운영 배포
- 청해와 음원 학습
- 시간 제한 시험 모드
- 검수된 AI 보조 해설
- 한국어·일본어 UI 전환
- 학습 목표와 유료 플랜
