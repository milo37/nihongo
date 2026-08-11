---
title: JLPT Drill Note Phase 0 Vite 기준선 보고서
document_status: Complete
result: Ready
completed_at: 2026-08-11
next_stage: Phase 1A 모노레포 전환
---

# Phase 0 Vite 기준선 보고서

## 결론

현재 프로젝트는 **Vite 프런트엔드 기준으로 Phase 0을 완료했고 Phase 1A를 시작할 수 있는 Ready 상태**다.

작업 기준 저장소는 `/Users/doji/Desktop/dev/nihongo` 하나다. 삭제된 Documents 경로는 사용하지 않는다. `main`과 `origin/main`은 정리 시작 시점에 동일한 `34ab1bc`였으며, 이번 기준선 변경은 그 위에서 작성했다.

이전에 작성된 Next.js·Prisma 실험은 `codex/p0-containment` 보관 브랜치에만 남아 있다. 해당 브랜치는 현재 Vite 기준선에 병합하지 않는다.

## 확정 기술 기준

- Vite, React, strict TypeScript
- React Router `createBrowserRouter`
- TanStack Query, Zustand
- Axios, Zod, MSW
- React Hook Form, Tailwind CSS
- React Compiler
- Vitest, React Testing Library
- pnpm 10.2.1, Node.js 22 LTS

현재 기준선에는 Next.js, Prisma, SQLite, Server Components, Server Actions, SWR, 실제 백엔드 코드가 없다.

## 규칙과 스킬 정리 결과

- `.cursor/rules/01-frontend-guidelines.mdc`의 Provider 파일명, 오류 처리 범위, type import, 설정 파일명을 실제 프로젝트와 맞췄다.
- `.cursor/rules/02-formatting.mdc`에서 명시적 `any` 허용과 Next 전용 ignore를 제거했다.
- `.cursor/rules/03-api-guidelines.mdc`에서 `config.ts`와 `http.ts` 순환 의존 예제, AxiosResponse 자체 검증, 직접 `alert`, broad hook barrel 예제를 제거했다.
- `react-server-data` 스킬을 TanStack Query·Axios·Zod·MSW 데이터 경계 지침으로 교체했다.
- `react-critical-performance` 스킬을 Vite route splitting과 bundle·payload 지침으로 교체했다.
- `react-render-optimization` 스킬을 Vite CSR·Zustand·React Compiler 기준으로 교체했다.
- `$graph`를 명시적으로 요청한 복잡한 작업에서만 사용하는 Graph Engineering 스킬과 read-only explorer/reviewer, 검증 전용 tester 설정을 추가했다.

## 코드 구조 감사

다음 항목을 확인했다.

- `src/App.tsx`, `src/App.css` 없음
- `src/router.tsx`, `src/app/layout.tsx`, Provider, API, MSW 구조 존재
- 모든 도메인 route lazy loading
- `src` 내부 상대경로 import와 명시적 `any` 없음
- `config.ts`와 `http.ts` 순환 의존 없음
- 컴포넌트의 직접 Axios, fetch, Mock data, Query primitive 사용 없음
- 서버 응답을 Zustand에 복제하지 않음
- 문제풀이 전 정답과 해설을 공개 모델에서 제거
- Query와 Mutation 오류를 공통 error bus와 Provider에서 중앙 처리
- 추적 파일과 현재 로컬 프로젝트에 Next·Prisma·SQLite 산출물 없음

## 실행 검증

Node.js `22.20.0`, pnpm `10.2.1`에서 실행했다.

| 검증                             | 결과                       |
| -------------------------------- | -------------------------- |
| `pnpm install --frozen-lockfile` | 통과                       |
| `pnpm run format`                | 통과                       |
| `pnpm run lint:fix`              | 통과                       |
| `pnpm run format:check`          | 통과                       |
| `pnpm run lint`                  | 통과                       |
| `pnpm run typecheck`             | 통과                       |
| `pnpm run test`                  | 14 files, 40 tests 통과    |
| `pnpm run build`                 | Vite production build 통과 |

개발 서버에서 `/`, `/login`, `/practice`, `/wrong-notes`, `/admin/questions`, 임의 Not Found 경로의 SPA 직접 URL 응답이 모두 HTTP 200임을 확인했다. 핵심 세션 생성·제출·오답 저장 흐름은 MSW 통합 테스트가 검증한다.

## 로컬 환경 정리

이전 브랜치에서 남은 Next용 `.env`, `.next` 계열 빌드 산출물, Prisma DB, 이전 `node_modules`는 현재 프로젝트에서 제거했다. 삭제 대신 다음 복구 가능 위치에 보관했다.

```text
/Users/doji/Desktop/dev/.nihongo-backups/vite-realignment-20260811
```

현재 `.env`는 `.env.example`과 동일한 Vite Mock API 설정이다.

## 비차단 제한

Codex 앱의 브라우저 자동화 런타임이 삭제된 이전 Documents 작업 경로를 참조하여 이번 작업에서는 시각적 브라우저 감사를 실행하지 못했다. 사용자가 삭제를 요청한 경로를 다시 만들지 않았으며, 이는 소스·테스트·빌드 결함이 아니다. 다음 작업을 Desktop/dev 저장소에서 새로 열면 시각적 smoke audit을 추가할 수 있다.

Playwright는 선택 항목이며 현재 설치하지 않았다.

## Phase 1A 시작 조건

상세 이동 매핑과 rollback 기준은 `docs/monorepo-readiness.md`를 따른다.

- 이 기준선 커밋을 원격 저장소에 반영
- Phase 1A는 Vite 앱을 `apps/web`으로 이동하는 범위만 수행
- Next.js·Prisma 브랜치를 병합하지 않음
- 기존 Vite 품질 게이트를 이동 전후 모두 통과
- 실제 백엔드 프레임워크와 ORM은 Phase 1A에서 추가하지 않음
