# Codex Step 01 — Phase 0 코드베이스 감사 및 모노레포 전환 준비도 분석

> **상태: 완료 (2026-08-11)**
>
> 이 문서는 Phase 0 실행 지시의 기록이다. 현재 결과는 `docs/P0_VITE_BASELINE_REPORT.md`, 다음 단계 실행 기준은 `docs/monorepo-readiness.md`를 사용한다. 이 Step을 다시 실행하지 않는다.
>
> 사용 시점: 전체 로드맵 문서를 저장소에 추가하고 Codex가 먼저 읽은 뒤, 첫 번째 실제 작업으로 이 문서를 전달한다.
>
> 이 단계의 목적은 기능 구현이 아니라 **현재 코드의 실제 상태를 검증하고, 다음 단계인 pnpm 모노레포 전환을 안전하게 실행할 수 있는 계획을 확정하는 것**이다.

---

## Codex에 전달할 프롬프트

```text
저장소에 있는 전체 로드맵과 기존 개발 규칙을 먼저 읽고,
이번 요청에서는 Step 01인 Phase 0 감사만 수행해라.

로드맵 파일은 다음 후보 경로에서 찾아라.

- docs/JLPT_DRILL_NOTE_V1_ROADMAP.md
- ROADMAP.md
- 저장소에 실제로 존재하는 JLPT Drill Note 로드맵 파일

반드시 먼저 읽을 규칙:

- 01-frontend-guidelines.mdc
- 02-formatting.mdc
- 03-api-guidelines.mdc
- 저장소에 있는 React/JavaScript 성능 관련 SKILL.md
- 저장소에 있는 Web Interface Guidelines 관련 SKILL.md
- 그 밖에 현재 저장소에 적용되는 모든 프로젝트 규칙

우선순위:

1. 기존 .mdc 및 SKILL.md 규칙
2. 현재 저장소의 실제 코드와 설정
3. 전체 로드맵
4. 이번 Step 01 지시

단, 이번 요청에서 명시한 작업 범위와 금지사항은 반드시 지켜라.
로드맵은 기존 규칙을 변경하는 문서가 아니다.

────────────────────────────────────────
0. 확정된 결정
────────────────────────────────────────

다음 결정은 이미 확정되었으므로 다시 후보 비교나 승인 요청을 하지 마라.

- 프런트엔드와 백엔드는 하나의 Git 저장소에서 관리한다.
- 패키지 매니저는 pnpm이다.
- pnpm workspace 기반 모노레포로 전환한다.
- 목표 상위 구조는 다음과 같다.

repository/
├── apps/
│   ├── web/          기존 Vite React 프런트엔드
│   └── api/          향후 구현할 TypeScript 백엔드
├── packages/
│   ├── contracts/    프런트·백엔드가 공유하는 Zod API 계약
│   ├── domain/       서버 중심의 순수 도메인 로직
│   └── config/       필요한 경우 공유 설정
├── docs/
├── package.json
├── pnpm-workspace.yaml
└── pnpm-lock.yaml

주의:

- 위 구조는 목표 구조다.
- 이번 Step 01에서는 실제 파일 이동이나 apps/api 생성까지 하지 않는다.
- 모노레포 여부를 다시 결정하지 않는다.
- 백엔드 프레임워크와 ORM은 아직 확정하지 않는다.
- Fastify/NestJS/Hono, Drizzle/Prisma 등을 이번 단계에서 설치하지 않는다.
- Turborepo도 이번 단계에서 설치하지 않는다.

기존 프런트엔드 규칙은 현재 프런트 프로젝트에 적용하고,
모노레포 전환 후에는 apps/web/** 범위에 적용하는 것을 전제로 분석한다.

03-api-guidelines.mdc는 서버 구현 규칙이 아니라
apps/web의 Axios/Zod/TanStack Query API 클라이언트 규칙으로 취급한다.
향후 apps/api에는 별도의 백엔드 규칙이 필요하다는 점을 분석 문서에 명시한다.

────────────────────────────────────────
1. 이번 단계의 목표
────────────────────────────────────────

다음을 실제 저장소와 실행 결과를 근거로 확정한다.

1. 현재 Alpha에서 실제로 완성된 기능
2. 정상 경로만 있고 예외 처리가 빠진 기능
3. UI만 존재하는 Placeholder
4. 아직 구현되지 않은 기능
5. 기존 프런트엔드 규칙 위반
6. API·Query·Zustand·MSW 책임 분리 상태
7. 테스트와 빌드의 현재 기준선
8. 현재 Vite 앱을 apps/web으로 옮길 때의 영향 범위
9. 루트 pnpm workspace를 구성하기 전에 해결해야 할 문제
10. 다음 단계인 Phase 1A 모노레포 전환의 정확한 작업 목록

이번 결과만 읽어도 다음 Codex 요청에서
모노레포 전환을 안전하게 실행할 수 있을 정도로 구체적으로 작성해라.

────────────────────────────────────────
2. 작업 전 안전 절차
────────────────────────────────────────

가장 먼저 다음을 확인하고 기록한다.

- 현재 Git branch
- git status --short
- 추적되지 않은 파일
- 수정 중인 사용자 파일
- 현재 저장소 루트
- package manager와 lockfile
- Node 및 pnpm 버전

규칙:

- 사용자의 기존 변경사항을 덮어쓰지 않는다.
- 사용자 변경을 reset, checkout, restore, clean하지 않는다.
- commit, push, branch 생성, PR 생성을 하지 않는다.
- lockfile을 불필요하게 다시 생성하지 않는다.
- 대량 포맷팅을 하지 않는다.
- 감사 중 발견한 기능 문제를 임의로 대규모 수정하지 않는다.
- 민감한 환경변수 값을 문서에 복사하지 않는다.
- .env 파일은 키 이름만 확인하고 값은 출력하지 않는다.

작업 시작 시 10줄 이내로 다음을 먼저 보고한다.

- 확인한 로드맵 경로
- 확인한 규칙 파일
- 현재 저장소 형태
- 이번 감사 순서
- 이번 단계에서 코드를 거의 변경하지 않는다는 점

계획을 보고한 뒤 멈추지 말고 감사를 계속 수행한다.

────────────────────────────────────────
3. 저장소 및 도구체인 감사
────────────────────────────────────────

다음을 확인한다.

### 3.1 저장소 구조

- 저장소 최상위 디렉터리 구조
- 현재 프런트엔드 앱의 실제 루트
- src, public, index.html의 위치
- docs 디렉터리 상태
- rules 및 skill 파일 위치
- GitHub Actions 또는 다른 CI 설정
- Vercel/Netlify/Cloudflare 등 배포 설정
- Docker 관련 파일
- 환경변수 예제 파일

### 3.2 package.json

- scripts 전체
- dependencies와 devDependencies
- engines
- packageManager
- private 여부
- workspace 설정 존재 여부
- 중복 또는 사용되지 않는 패키지 후보

패키지 버전 목록을 전부 길게 복사하지 말고,
아키텍처에 중요한 버전만 표로 정리한다.

예:

- React
- Vite
- TypeScript
- React Router
- TanStack Query
- Zustand
- Axios
- Zod
- MSW
- React Hook Form
- Vitest
- Testing Library
- Playwright
- Tailwind CSS

### 3.3 설정 파일

- vite.config.*
- tsconfig*.json
- eslint.config.*
- prettier.config.*
- vitest.config.*
- playwright.config.*
- postcss/tailwind 설정
- alias 설정
- test setup
- MSW setup

다음을 확인한다.

- @, @api, @app, @common, @provider, @store, @libs,
  @mocks, @util, @assets alias가 실제로 일치하는지
- Vite와 TypeScript의 alias가 서로 다른지
- 테스트 환경에서도 alias가 동작하는지
- React Compiler 설정이 실제로 존재하는지
- 브라우저 타깃과 Node 타깃
- ESM/CJS 혼용 위험

────────────────────────────────────────
4. 라우트와 화면 감사
────────────────────────────────────────

코드만 읽지 말고 가능한 경우 앱을 실제로 실행하여 확인한다.

1. 사용 가능한 개발 서버 또는 preview 서버를 실행한다.
2. React Router의 전체 route tree를 추출한다.
3. 각 route를 브라우저 또는 Playwright로 직접 연다.
4. 콘솔 오류와 네트워크 오류를 확인한다.
5. 직접 URL 진입과 새로고침을 확인한다.
6. 모바일 폭과 데스크톱 폭에서 핵심 화면을 확인한다.

최소 점검 route:

- /
- /login
- /dashboard
- /practice
- /practice/session/:sessionId
- /practice/result/:sessionId
- /wrong-notes
- /wrong-notes/:questionId
- /bookmarks
- /admin/questions
- /admin/questions/new
- /admin/questions/:questionId/edit
- /forbidden
- 존재하지 않는 경로

실제 route 명칭이 다르면 현재 코드 기준으로 정리한다.
로드맵과 다른 경로는 차이로 기록한다.

각 기능을 다음 네 상태 중 하나로만 분류한다.

- Complete
  - 정상 흐름, 오류, 빈 상태, 권한, 최소 테스트까지 확인됨
- Partial
  - 정상 흐름은 있으나 저장·예외·권한·테스트 중 일부가 미완성
- Placeholder
  - 화면 또는 버튼은 있지만 실제 동작이 없거나 하드코딩됨
- Missing
  - 구현 없음

기능 상태표의 최소 항목:

- 홈
- 데모 로그인
- GUEST/USER/ADMIN 역할
- 보호 라우트
- 로그인 후 원래 경로 복귀
- 문제풀이 설정
- 급수 선택
- 과목 선택
- 문제 수 선택
- 출제 모드 선택
- 세션 생성
- 문제 조회
- 정답 사전 비노출
- 답안 선택
- 이전/다음
- 키보드 조작
- 진행률
- 경과 시간
- 새로고침 복구
- 미응답 제출 확인
- 제출
- 결과
- 오답 자동 저장
- 오답 재풀이
- 오답 상태 전환
- 메모
- 즐겨찾기
- 대시보드
- 관리자 목록
- 관리자 생성
- 관리자 수정
- 관리자 삭제
- 관리자 권한
- 로딩 상태
- 빈 상태
- 오류 상태
- 오프라인 상태
- 403
- 404
- 모바일 독해
- 데스크톱 독해 2열
- 접근성
- 단위 테스트
- 컴포넌트 테스트
- E2E

근거 열에는 반드시 다음 중 하나를 적는다.

- file:line
- 실행한 테스트 이름
- 직접 확인한 route와 결과

근거 없는 완료 판정은 금지한다.

────────────────────────────────────────
5. 프런트엔드 아키텍처 감사
────────────────────────────────────────

### 5.1 라우터와 Provider

확인 항목:

- createBrowserRouter 사용 여부
- src/router.tsx 존재 여부
- 도메인별 router.tsx
- Layout, Outlet, Suspense
- route errorElement
- 403/404 분리
- ProtectedRouteProvider
- AuthErrorHandlerProvider
- ReactQueryProvider와 RouterProvider 중첩 순서
- route 단위 lazy loading

### 5.2 API 계층

기대 흐름:

MSW 또는 실제 API
→ src/api/{domain}/{endpoint}
→ Query Factory
→ 도메인 커스텀 훅
→ 컴포넌트

검색할 위반:

- 컴포넌트의 axios 직접 사용
- 컴포넌트의 fetch 직접 사용
- 컴포넌트의 apiClient 직접 사용
- 컴포넌트의 useQuery/useMutation 직접 사용
- 컴포넌트 또는 훅의 Mock 데이터 직접 import
- safeGet/safePost/safePut/safeDel을 우회한 호출
- Zod로 검증하지 않는 응답
- endpoint 폴더와 naming 규칙 위반
- mutation 후 캐시 무효화 누락
- Query key 불일치
- Query와 Mutation 오류 처리 중복

### 5.3 config.ts / http.ts

다음을 실제 import graph로 확인한다.

- config.ts가 http.ts를 import하는지
- http.ts가 config.ts를 import하는지
- 순환 의존이 존재하는지
- safeFactory가 response.data를 검증하는지
- AxiosResponse 객체 자체를 잘못 검증하는지
- ApiErrorFlags가 정상적으로 부여되는지
- 인터셉터가 UI를 직접 처리하는지

규칙 문서 내 설명과 예제가 충돌하더라도,
이번 감사에서는 임의로 대규모 수정하지 않는다.
실제 코드 상태와 권장 해결 방향을 gap-analysis에 기록한다.

권장 기준은 다음이다.

- config.ts는 http.ts를 import하지 않음
- http.ts는 config.ts의 apiClient/safeFactory를 사용
- 순환 의존 없음
- safeFactory는 raw response data를 Zod 검증

### 5.4 TanStack Query와 Zustand 경계

TanStack Query에 있어야 하는 데이터:

- 문제
- 세션
- 결과
- 오답노트
- 북마크
- 대시보드
- 관리자 데이터

Zustand에 허용되는 데이터:

- 현재 문제 번호
- 제출 전 답안
- 시작 시각
- 임시 UI 상태
- 새로고침 복구용 직렬화 가능한 상태
- 데모 인증 표시 상태

검색할 위반:

- 서버 응답 전체를 Zustand에 복제
- Query cache와 Zustand가 같은 데이터를 동시에 보유
- 저장소 hydration 중 매 렌더 localStorage 접근
- slice가 도메인별로 분리되지 않음
- 이전 상태 기반 변경에서 functional update 미사용

### 5.5 MSW와 Mock Repository

확인 항목:

- MSW가 main 진입 전에 초기화되는지
- 개발과 테스트 handler 분리
- Mock 데이터가 src/mocks 내부에만 있는지
- 컴포넌트가 Mock을 직접 읽지 않는지
- localStorage 영속화 방식
- 반복 ID 조회에 불필요한 find가 누적되는지
- 정답 데이터가 문제풀이 시작 응답에 포함되는지
- 제출 후에만 정답·해설을 반환하는지
- Mock API 계약과 Zod schema가 일치하는지

────────────────────────────────────────
6. 코드 품질·성능·접근성 감사
────────────────────────────────────────

### 6.1 코드 품질 검색

다음을 파일과 줄 번호로 찾는다.

- 명시적 any
- src 내부 과도한 상대경로 import
- 미사용 import
- TODO/FIXME/HACK
- 빈 함수
- 하드코딩된 성공 응답
- 미동작 버튼
- window.alert
- window.confirm
- dangerouslySetInnerHTML
- 중복된 전역 keydown listener
- unstable key
- state/props 배열에 sort()
- 반복적인 localStorage/sessionStorage/cookie 접근
- 동일 배열에서 반복되는 find/includes
- 비싼 최소·최대 탐색을 위한 전체 sort
- 불필요한 순차 await
- 초기 bundle에 포함된 대형 관리자/차트 모듈
- 광범위한 barrel import

감사 결과는 단순 미세 최적화 목록으로 부풀리지 않는다.
실제 사용자 흐름, 데이터 크기, 호출 빈도를 기준으로 우선순위를 정한다.

### 6.2 접근성 및 UI 감사

Web Interface Guidelines 관련 SKILL.md를 따르되,
이번 단계에서는 핵심 화면을 검토하고 코드 전면 수정은 하지 않는다.

검토 대상 최소 범위:

- 문제풀이 화면
- 결과 화면
- 오답노트 목록 또는 상세
- 관리자 문제 폼
- 공통 Navigation/Layout

절차:

1. SKILL.md에 지정된 최신 Web Interface Guidelines URL을 가져온다.
2. 한 번 실패하면 재시도한다.
3. 계속 실패하면 실패 사실을 기록하고 기존 규칙으로만 검토한다.
4. 결과를 file:line 형식으로 작성한다.
5. Critical/High/Medium/Low로 분류한다.
6. 이번 단계에서는 감사 문서에 기록하고,
   실행을 막는 최소 오류 외에는 UI를 대규모 수정하지 않는다.

최소 확인 항목:

- heading 계층
- landmark
- label
- radiogroup
- focus-visible
- 키보드 이동
- Dialog 포커스
- aria-live
- 색상 외 정답/오답 표현
- 터치 영역
- reduced motion
- table semantics
- 모바일 독해 가독성

────────────────────────────────────────
7. 테스트와 검증 기준선
────────────────────────────────────────

package.json의 실제 script를 먼저 확인한다.
감사 단계이므로 자동 수정 명령보다 읽기 전용 검증을 우선한다.

### 7.1 의존성 설치

- node_modules가 없으면 pnpm install을 실행할 수 있다.
- lockfile이 있으면 가능한 경우 --frozen-lockfile을 사용한다.
- 설치 실패 시 원인과 로그 핵심을 기록한다.
- lockfile을 임의로 갱신하지 않는다.

### 7.2 실행할 명령

실제 script가 존재하는 경우 가능한 범위에서 실행한다.

- format check
- lint
- typecheck
- unit/component test
- build
- E2E 또는 smoke test

우선순위 예시:

1. pnpm run format:check가 있으면 실행
2. 없고 Prettier가 설치되어 있으면 pnpm exec prettier --check . 실행
3. pnpm run lint 실행
4. pnpm run typecheck 실행
5. pnpm run test의 CI/once 모드 실행
6. pnpm run build 실행
7. pnpm run test:e2e가 있으면 실행

주의:

- pnpm run format과 pnpm run lint:fix는 코드를 변경할 수 있으므로
  이번 감사에서는 기본적으로 실행하지 않는다.
- 프로젝트에 읽기 전용 검사 방법이 전혀 없을 때만 그 사실을 기록한다.
- 테스트가 watch 모드에 머물지 않도록 한다.
- 실패를 숨기기 위해 테스트를 skip하거나 설정을 완화하지 않는다.

각 명령에 대해 기록할 것:

- 실행한 정확한 명령
- 종료 코드
- 성공/실패
- 실패 원인 요약
- 관련 파일
- 기존 실패인지 이번 문서 변경 때문인지

### 7.3 실제 앱 smoke test

가능하면 다음 최소 흐름을 직접 확인한다.

메인
→ 문제풀이 설정
→ 세션 생성
→ 답안 선택
→ 제출
→ 결과
→ 오답노트

관리자 기능이 있으면:

관리자 로그인
→ 문제 목록
→ 문제 생성 폼 진입
→ 검증 오류 확인

실제 기능이 없어 진행하지 못한 지점은 Placeholder 또는 Missing으로 분류한다.

────────────────────────────────────────
8. 모노레포 전환 준비도 분석
────────────────────────────────────────

모노레포 전환은 확정 사항이다.
이번 단계에서는 실제 이동 대신 정확한 이동 계획을 작성한다.

### 8.1 현재 파일 이동 매핑

현재 경로와 목표 경로를 표로 작성한다.

예:

| 현재 | 목표 | 조정 필요 사항 |
|---|---|---|
| src/ | apps/web/src/ | alias와 config 기준 경로 |
| public/ | apps/web/public/ | 정적 자산 경로 확인 |
| index.html | apps/web/index.html | Vite root 확인 |
| vite.config.ts | apps/web/vite.config.ts | alias, proxy |
| package.json | apps/web/package.json | web 전용 의존성 분리 |
| pnpm-lock.yaml | repository root | 하나만 유지 |

실제 저장소 기준으로 전 항목을 작성한다.

### 8.2 루트에 남길 파일

다음을 구분한다.

- 루트 package.json
- pnpm-workspace.yaml
- pnpm-lock.yaml
- 공통 .gitignore
- 공통 Prettier 설정 후보
- 공통 ESLint 설정 후보
- docs
- CI 설정
- 배포 설정
- env example 정책

공통 설정으로 추출하면 오히려 복잡해지는 항목은
apps/web에 유지하라고 판단할 수 있다.
모든 설정을 무조건 packages/config로 옮기지 않는다.

### 8.3 목표 package 이름

권장안을 제시하되 실제 생성은 다음 단계로 남긴다.

예:

- @jlpt/web
- @jlpt/api
- @jlpt/contracts
- @jlpt/domain
- @jlpt/config

기존 저장소 이름과 충돌하면 더 적절한 이름을 제안한다.

### 8.4 의존 방향

다음 원칙을 기준으로 현재 코드와 향후 위험을 분석한다.

- apps/web → packages/contracts 허용
- apps/api → packages/contracts 허용
- apps/api → packages/domain 허용
- apps/web → packages/domain 기본 금지
- packages/contracts → apps/* 의존 금지
- packages/domain → apps/* 의존 금지
- apps/web ↔ apps/api 소스 직접 import 금지

### 8.5 contracts 추출 후보

현재 src/api/**/schema.ts를 분석하여 다음으로 분류한다.

- packages/contracts로 옮길 수 있는 공개 요청/응답 schema
- 프런트 전용 UI schema
- 서버 내부 전용으로 남겨야 할 schema
- 정답 노출 위험 때문에 공개 계약에서 분리해야 할 schema

이번 단계에서는 파일을 옮기지 않는다.
추출 후보 목록과 의존성 문제만 문서화한다.

### 8.6 규칙 적용 범위

다음을 명확히 문서화한다.

- 01-frontend-guidelines.mdc → apps/web/**
- 03-api-guidelines.mdc → apps/web/**의 API 클라이언트
- React UI/성능 SKILL → apps/web/**
- formatting 규칙 → 공통 기본값 + 앱별 필요 override
- apps/api/** → 향후 별도 04-backend-guidelines.mdc 필요

기존 규칙 파일을 이번 단계에서 임의로 이동하거나 삭제하지 않는다.
어떤 방식으로 scope를 제한할지 다음 단계의 실행안으로 제시한다.

### 8.7 스크립트와 CI 영향

현재 script를 다음 목표 script에 어떻게 매핑할지 작성한다.

- pnpm dev
- pnpm dev:web
- pnpm dev:api
- pnpm build
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm test:e2e

분석 항목:

- 루트 recursive script
- filter 사용
- web 앱 working-directory
- CI cache key
- 배포 root directory
- SPA rewrite
- VITE_* 환경변수 경로
- 향후 /api proxy

Turborepo는 설치하지 말고,
현재 규모에서 pnpm workspace만으로 충분한지 판단 근거만 기록한다.

### 8.8 모노레포 전환 위험 목록

최소 다음을 점검한다.

- alias 깨짐
- index.html 기준 경로
- public asset 경로
- Vitest setup 경로
- MSW worker 파일 경로
- Playwright webServer cwd
- Tailwind content glob
- ESLint tsconfigRootDir
- TypeScript project references
- Vite env 파일 탐색 위치
- CI working-directory
- 배포 root directory
- GitHub Pages base path
- import.meta.env
- service worker scope
- 절대경로가 repository root를 가정하는 코드

각 위험은 다음으로 분류한다.

- Blocker
- High
- Medium
- Low

────────────────────────────────────────
9. 생성할 문서
────────────────────────────────────────

다음 문서를 생성한다.
기존 문서가 있으면 덮어쓰기 전에 내용을 읽고,
유용한 기존 내용을 보존하면서 갱신한다.

### 9.1 docs/current-status.md

포함 내용:

- 감사 일자
- 현재 branch와 working tree 상태 요약
- 현재 저장소 구조
- 기술 스택
- 전체 route 목록
- Provider 구조
- API/Query/Zustand/MSW 구조
- 기능 상태표
- 테스트 파일 현황
- 실행한 명령과 결과
- 현재 Alpha의 정확한 수준
- 변경하면 안 되는 정상 동작 목록

### 9.2 docs/gap-analysis.md

포함 내용:

- 로드맵 v1.0과 현재 구현의 차이
- P0/P1/P2 분류
- 기능 Gap
- 구조 Gap
- API 계약 Gap
- 테스트 Gap
- 접근성 Gap
- 성능 Gap
- 보안 Gap
- 운영 Gap
- 근거 file:line
- 권장 해결 Phase

우선순위 정의:

P0:
- 다음 단계 진행을 막음
- 데이터 손상 또는 정답 노출
- 빌드 불가
- 핵심 흐름 완전 중단
- 심각한 권한 문제

P1:
- Public Beta 전에 반드시 해결
- 핵심 예외처리·접근성·테스트 누락
- 모노레포 이동 시 높은 회귀 위험

P2:
- v1.x 또는 후속 최적화 가능
- 핵심 흐름을 막지 않는 개선

### 9.3 docs/monorepo-readiness.md

포함 내용:

- 모노레포 결정이 확정이라는 명시
- 현재 구조와 목표 구조
- 정확한 파일 이동 매핑
- 루트와 apps/web에 둘 설정
- 목표 package 목록
- package 의존 방향
- contracts 추출 후보
- 규칙 적용 scope
- script 변경안
- CI/배포 변경안
- 환경변수 정책
- 위험 및 대응
- rollback 방식
- Phase 1A 실행 순서
- Phase 1A Acceptance Criteria

### 9.4 docs/v1-scope.md

로드맵의 범위를 실제 구현 상태에 맞게 정리한다.

포함 내용:

- v1.0 필수
- Public Beta 필수
- v1.x 이후
- 명시적 제외
- 각 기능의 완료 정의
- 현재 이미 완료된 항목

제품 범위를 임의로 확대하지 않는다.

### 9.5 docs/next-implementation-plan.md

다음 작업인 Phase 1A를
Codex 한 번의 작업으로 실행 가능한 단위로 작성한다.

필수 포함:

- 작업 이름: pnpm 모노레포 기반 구축 및 기존 web 이동
- 사전 조건
- 변경 대상 파일
- 변경 금지 파일
- 순서
- 각 단계 검증 명령
- rollback 기준
- Acceptance Criteria
- 예상 위험
- 완료 후 Phase 1B로 넘어갈 조건

Phase 1A에서는 기능 리팩터링과 모노레포 이동을 섞지 않도록 한다.

────────────────────────────────────────
10. 로드맵 검토 처리
────────────────────────────────────────

전체 로드맵 안에 다음과 같이 현재 결정과 맞지 않는 문구가 있으면 찾는다.

- 모노레포를 후보로 표현
- Phase 2에서 모노레포 여부를 결정
- Phase 3에서 monorepo 또는 기존 구조 중 선택

이번 단계에서는 로드맵을 조용히 대규모 재작성하지 않는다.

대신 docs/monorepo-readiness.md에 다음을 작성한다.

- 수정이 필요한 로드맵 section
- 현재 문구 요약
- 권장 변경 문구
- 변경 이유

로드맵 진행 상태 문서가 있으면 Phase 0을 In Progress로 표시하고,
모든 감사가 끝났을 때 Complete로 변경한다.
진행 상태 문서가 없다면 docs/roadmap-progress.md를 생성한다.

────────────────────────────────────────
11. 이번 단계에서 허용되는 변경
────────────────────────────────────────

허용:

- 위 docs 문서 생성 및 갱신
- roadmap-progress 갱신
- 감사를 실행하기 위해 반드시 필요한 최소 설정 수정
- 명백한 문서 오타 수정

최소 설정 수정이 필요한 경우:

1. 먼저 왜 감사가 불가능한지 기록
2. 가장 작은 변경만 수행
3. 변경 전후 차이를 보고
4. 기능 리팩터링으로 확대하지 않음

────────────────────────────────────────
12. 이번 단계에서 금지되는 변경
────────────────────────────────────────

금지:

- apps/web으로 실제 파일 이동
- apps/api 생성
- packages/contracts 실제 추출
- packages/domain 실제 추출
- pnpm-workspace.yaml 실제 도입
- 루트 package.json 전환
- 백엔드 프레임워크 설치
- ORM 설치
- DB 생성
- 인증 구현
- UI 전면 수정
- 폴더 구조 대규모 재작성
- 라이브러리 대규모 교체
- 기능 추가
- 대량 포맷팅
- lint:fix로 광범위한 자동 수정
- 테스트를 통과시키기 위한 skip
- 사용자 코드 삭제
- commit/push/PR

────────────────────────────────────────
13. 완료 조건
────────────────────────────────────────

다음을 모두 만족해야 Step 01 완료다.

- [ ] 로드맵과 모든 관련 규칙을 실제로 읽음
- [ ] Git 상태와 현재 변경사항을 보존함
- [ ] 실제 route와 기능을 확인함
- [ ] 기능 전체가 Complete/Partial/Placeholder/Missing으로 분류됨
- [ ] 각 주요 판정에 file:line 또는 실행 근거가 있음
- [ ] API/Query/Zustand/MSW 구조가 문서화됨
- [ ] 정답·해설 사전 노출 여부가 확인됨
- [ ] 핵심 규칙 위반 위치가 기록됨
- [ ] 읽기 전용 format/lint/typecheck/test/build 결과가 기록됨
- [ ] 앱 smoke test 결과가 기록됨
- [ ] 모노레포 파일 이동 매핑이 완성됨
- [ ] package 의존 방향이 명시됨
- [ ] contracts 추출 후보가 분류됨
- [ ] rules scope 변경안이 작성됨
- [ ] CI/배포 영향이 작성됨
- [ ] Phase 1A 실행 계획과 Acceptance Criteria가 작성됨
- [ ] 금지된 대규모 코드 변경을 하지 않음

문서만 많고 실제 근거가 없으면 완료가 아니다.

────────────────────────────────────────
14. 최종 보고 형식
────────────────────────────────────────

최종 답변은 다음 순서로 작성한다.

1. 한 문단 요약
   - 현재 Alpha 수준
   - 다음 단계 진행 가능 여부

2. 검증 결과
   - command
   - status
   - 핵심 결과

3. 기능 상태 요약
   - Complete 수
   - Partial 수
   - Placeholder 수
   - Missing 수

4. P0 문제
   - file:line
   - 영향
   - 다음 Phase에서의 처리

5. 모노레포 준비도
   - Ready / Ready with blockers / Not ready
   - Blocker 목록

6. 생성·수정한 문서

7. 코드 변경 여부
   - 변경했다면 정확한 파일과 이유
   - 변경하지 않았다면 명시

8. 추천하는 다음 작업
   - Phase 1A 한 가지로 제한
   - 왜 지금 이 작업인지

9. 다음 Codex 요청용 프롬프트
   - docs/next-implementation-plan.md를 기반으로
     30~60줄 분량의 실행 프롬프트 초안

실행하지 않은 명령을 실행했다고 주장하지 마라.
검증하지 않은 기능을 Complete로 분류하지 마라.
발견하지 못한 내용을 추정으로 채우지 마라.
```

---

## 이 단계 다음에 이어질 작업

Step 01 결과를 검토한 뒤 다음 작업은 원칙적으로 다음이다.

```text
Phase 1A
pnpm workspace 기반 모노레포 구축
→ 기존 Vite 앱을 apps/web으로 이동
→ 기능 변경 없이 기존 검증 기준 재통과
```

단, Step 01에서 빌드 불가·정답 노출·심각한 데이터 손상 같은 P0가 확인되면 해당 P0만 먼저 최소 수정한 뒤 Phase 1A를 진행한다.
