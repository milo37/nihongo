---
title: Vite 규칙·스킬 정합성 변경 보고서
document_status: Complete
completed_at: 2026-08-11
baseline: Vite React frontend
---

# Vite 규칙·스킬 정합성 변경 보고서

## 목적

이 문서는 JLPT Drill Note의 실제 Vite 구현과 저장소 규칙·스킬 사이에 있었던 충돌, 삭제하거나 교체한 지침, Git 및 로컬 환경 정리 결과를 기록한다.

현재 프로젝트 기준 경로는 `/Users/doji/Desktop/dev/nihongo`이며 기준 브랜치는 `main`이다.

## 문제 요약

| 영역            | 기존 문제                                                         | 처리 결과                                                                   |
| --------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 프로젝트 기준   | Vite 앱과 별개로 Next.js·Prisma 구현이 잘못 진행됨                | 잘못된 브랜치를 `main`에 병합하지 않고 로컬·원격에서 삭제                   |
| 프런트 규칙     | 실제 Provider 파일명과 중첩 순서가 규칙 예제와 다름               | 실제 `ReactQueryProvider → ToastProvider → ReactRouterProvider` 순서로 통일 |
| TypeScript 규칙 | 규칙 예제가 명시적 `any`를 허용                                   | `no-explicit-any: error`, `unknown`과 타입 가드 사용으로 통일               |
| API 규칙        | `config.ts`가 `http.ts`를 import하도록 안내해 순환 의존 발생 가능 | `config.ts`는 독립, `http.ts`만 `config.ts`를 import하도록 고정             |
| 응답 검증       | `response.data` 대신 AxiosResponse wrapper 자체를 Zod로 검증      | raw response data만 검증하도록 수정                                         |
| 오류 처리       | mutation마다 `console.error`, `alert` 사용 예제 존재              | Query와 Mutation 오류를 공통 error bus와 Provider에서 중앙 처리             |
| 성능 스킬       | RSC, Server Action, `next/dynamic`, `React.cache`, `after` 권장   | Vite route lazy loading, TanStack Query, payload·bundle 최적화로 교체       |
| 데이터 스킬     | SWR, 서버 DB cache, 실제 backend 전제                             | Axios·Zod·MSW·TanStack Query client state 경계로 교체                       |
| 렌더 스킬       | SSR hydration inline script 권장                                  | Vite CSR, Zustand persist, 공통 storage adapter 기준으로 교체               |
| 장기 로드맵     | 현재 MSW 범위와 미래 실제 API·DB 범위가 혼재                      | 현재 Phase와 사용자 명시가 필요한 미래 Phase를 분리                         |

## 규칙 파일 변경

### `.cursor/rules/01-frontend-guidelines.mdc`

문제:

- `QueryClientProvider.tsx`라는 존재하지 않는 파일명을 사용했다.
- 실제 앱의 `ToastProvider`가 Provider 순서에서 빠져 있었다.
- `AuthErrorHandlerProvider`를 Query 전용으로 설명해 Mutation 오류가 누락될 수 있었다.
- Zustand의 `StateCreator`를 value import로 예시했다.
- 실제 `.mjs` 설정 파일을 `.js`로 안내했다.

변경:

- `ReactQueryProvider.tsx`로 파일명을 수정했다.
- Provider 순서를 `ReactQueryProvider → ToastProvider → ReactRouterProvider`로 고정했다.
- Query와 Mutation 오류를 모두 중앙 처리한다고 명시했다.
- `StateCreator`를 `import type`으로 변경했다.
- `eslint.config.mjs`, `prettier.config.mjs`를 실제 파일명으로 기록했다.

### `.cursor/rules/02-formatting.mdc`

문제:

- `@typescript-eslint/no-explicit-any`를 끄는 예제가 저장소의 strict TypeScript 기준과 충돌했다.
- Next.js 생성물과 범용 React 프로젝트 설정이 Vite 전용 저장소 규칙에 섞여 있었다.
- 실제 ESLint·Prettier 설정과 문서의 예제 사이에 차이가 있었다.

변경:

- 규칙을 현재 `eslint.config.mjs`와 `prettier.config.mjs` 중심의 간결한 기준으로 재작성했다.
- 명시적 `any` 금지, `unknown` narrowing, type-only import, Arrow Function component를 명시했다.
- Next.js ignore와 설정 안내를 제거했다.
- 완료 전 `format`, `lint:fix`, `typecheck`, `test`, `build` 실행을 고정했다.

### `.cursor/rules/03-api-guidelines.mdc`

문제:

- `config.ts → http.ts → config.ts` 순환 의존을 만드는 복붙 예제가 있었다.
- AxiosResponse 객체 자체를 Zod schema로 검증하는 잘못된 예제가 있었다.
- 상대경로 import와 HTTP verb별 반복 try/catch·console logging 예제가 있었다.
- mutation hook에서 `window.alert`를 호출했다.
- QueryCache만 다뤄 Mutation 오류 중앙 처리가 빠졌다.
- broad hook barrel import와 production Mock 완전 제거를 권장했다.

변경:

- 문서를 Vite API client 전용 규칙으로 전면 재작성했다.
- `config.ts`와 `http.ts`의 책임과 단방향 import를 고정했다.
- `safeFactory`가 raw data를 검증하고 실패 시 422 validation error를 전달하도록 명시했다.
- Component → domain hook → Query Factory → endpoint → Axios → MSW 흐름을 고정했다.
- QueryCache와 MutationCache 오류를 공통 error bus로 전달하도록 명시했다.
- production Mock은 기본 비활성화하되 demo build에서 `VITE_ENABLE_MOCKS=true`로만 활성화하도록 수정했다.

## 스킬 변경

### 교체한 스킬

다음 스킬은 이름과 역할은 유지하되 Next.js 중심 본문을 제거하고 Vite 기준으로 다시 작성했다.

- `.cursor/skills/react-server-data/SKILL.md`
  - 제거: RSC serialization, server DB cache, `React.cache`, `after`, SWR
  - 추가: TanStack Query, Axios, Zod, MSW, Query Factory, payload 안전성
- `.cursor/skills/react-critical-performance/SKILL.md`
  - 제거: Next API Route, Server Action, `next/dynamic`, Next config 최적화
  - 추가: `React.lazy`, React Router route splitting, bundle·payload·storage 최적화
- `.cursor/skills/react-render-optimization/SKILL.md`
  - 제거: SSR hydration mismatch용 inline DOM script
  - 추가: Vite CSR, Zustand selector, functional update, storage adapter, 접근성 보존

### 정리한 스킬

- `.cursor/skills/js-advanced-patterns/SKILL.md`에서 Next.js, SWR, 현재 사용하지 않는 cache package 참조를 제거했다.
- `.agents/skills/code-formatting/references/lint-format.md`에서 임시 규칙 충돌 설명과 `.next` ignore를 제거했다.

### 추가한 Graph Engineering

- `.agents/skills/graph/SKILL.md`
- `.codex/config.toml`
- `.codex/agents/graph-explorer.toml`
- `.codex/agents/graph-reviewer.toml`
- `.codex/agents/graph-tester.toml`

Graph는 사용자가 `$graph` 또는 multi-agent graph를 명시적으로 요청한 복잡한 작업에만 사용한다. Source 수정 agent는 하나만 허용하고 explorer와 reviewer는 read-only, tester는 검증 전용으로 제한했다.

## 실제 설정에서 제거한 항목

`eslint.config.mjs`에서 Vite 프로젝트에 필요 없는 `.next/**` ignore를 제거했다.

현재 추적 파일과 프로젝트 root에는 다음 항목이 없다.

- Next.js 설정과 dependency
- `next-env.d.ts`
- `.next` build directory
- Prisma schema와 dependency
- SQLite database
- 실제 backend server code

금지 대상임을 설명하기 위한 문서 문구와 장기 로드맵의 미래 후보 표기는 남아 있지만, 현재 구현을 지시하는 규칙은 아니다.

## Git branch 정리

삭제 완료:

- 로컬 `codex/p0-containment`
- 원격 `origin/codex/p0-containment`

이 브랜치는 잘못 진행된 Next.js·Prisma 작업과 그 migration 문서를 보관하던 브랜치였다. `main`에는 병합되지 않았다.

유지:

- `main`: 현재 실제 기준 브랜치
- `codex/vite-baseline-alignment`: 정리 완료 시점의 P0 기준선 commit `525541c`를 보관하는 안전 브랜치

## 로컬 산출물 처리

잘못된 브랜치에서 사용했던 local `.env`의 `DATABASE_URL`, Next build, Prisma DB, 이전 `node_modules`는 현재 Vite 프로젝트에서 제거했다. 직접 삭제하지 않고 다음 경로로 이동해 복구 가능하게 보관했다.

```text
/Users/doji/Desktop/dev/.nihongo-backups/vite-realignment-20260811
```

현재 local `.env`는 `.env.example`과 동일한 Vite Mock API 설정이며 Git에 포함되지 않는다.

## Phase 1A 준비 상태

현재 판정은 **Ready**다.

- `main`과 `origin/main` 동기화
- Vite·React Router·TanStack Query·Zustand·Axios·Zod·MSW 기준 고정
- 규칙·스킬 validation 통과
- format과 lint 통과
- TypeScript 오류 없음
- Vitest 14 files, 40 tests 통과
- Vite production build 통과
- Phase 1A 이동 매핑과 rollback 기준 작성 완료

다음 작업은 `docs/monorepo-readiness.md`에 따라 기존 Vite 앱을 pnpm workspace의 `apps/web`으로 이동하는 것이다. Phase 1A에는 backend, ORM, auth, 기능 refactor를 포함하지 않는다.
