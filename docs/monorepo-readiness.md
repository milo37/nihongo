---
title: Phase 1A pnpm 모노레포 전환 준비도
document_status: Ready
based_on: Vite Phase 0 baseline
last_updated: 2026-08-11
---

# Phase 1A pnpm 모노레포 전환 준비도

## 판정

**Ready**. 현재 Vite 앱의 품질 게이트가 통과했고 원격 `main`과 기준 commit이 일치한다. Phase 1A에서는 기능 변경 없이 workspace root를 만들고 기존 앱을 `apps/web`으로 이동한다.

## 범위

포함:

- root `pnpm-workspace.yaml`과 workspace package scripts
- 기존 Vite 앱을 `apps/web`으로 이동
- CI, alias, MSW, build output 경로 조정
- 이동 전후 동일한 lint, typecheck, test, build 검증

제외:

- `apps/api` 구현
- 실제 backend, database, ORM, auth 도입
- shared contracts 또는 domain package 구현
- 기능 refactor와 UI 변경
- Next.js·Prisma 보관 브랜치 병합

## 이동 매핑

| 현재 root                                  | Phase 1A 위치                 | 비고                             |
| ------------------------------------------ | ----------------------------- | -------------------------------- |
| `src/`                                     | `apps/web/src/`               | Git move 유지                    |
| `public/`                                  | `apps/web/public/`            | MSW worker 포함                  |
| `index.html`                               | `apps/web/index.html`         | Vite entry                       |
| `vite.config.ts`                           | `apps/web/vite.config.ts`     | alias base 재확인                |
| `vitest.config.ts`                         | `apps/web/vitest.config.ts`   | setup path 재확인                |
| `tsconfig.json`                            | `apps/web/tsconfig.json`      | alias는 web root 기준            |
| `tailwind.config.ts`                       | `apps/web/tailwind.config.ts` | content glob 수정                |
| `postcss.config.mjs`                       | `apps/web/postcss.config.mjs` | web package 소유                 |
| `.env.example`                             | `apps/web/.env.example`       | Vite 환경변수만 포함             |
| 현재 `package.json`                        | `apps/web/package.json`       | package name을 web 전용으로 조정 |
| root `pnpm-lock.yaml`                      | root 유지                     | workspace install로 갱신         |
| `docs/`                                    | root 유지                     | 장기 로드맵과 ADR                |
| `.cursor/`, `.agents/`, `.codex/`          | root 유지                     | 저장소 전체 규칙과 Graph 설정    |
| `AGENTS.md`                                | root 유지                     | `apps/web` 적용 범위 명시        |
| `.github/workflows/ci.yml`                 | root 유지                     | `pnpm --filter web` 기준 수정    |
| `README.md`                                | root 유지                     | workspace 실행법으로 갱신        |
| `eslint.config.mjs`, `prettier.config.mjs` | root 유지                     | workspace 전체 품질 기준         |

Phase 1A에서는 비어 있는 `apps/api`나 `packages/*`를 보여주기 위해 placeholder 파일을 만들지 않는다. 실제 소유 코드가 생기는 Phase에서 디렉터리를 추가한다.

## Root package 기준

새 root `package.json`은 private workspace orchestration만 담당한다.

- `packageManager`: pnpm 10.2.1 유지
- `engines.node`: Node 22 LTS 기준 유지
- `dev`, `build`, `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test`를 web filter로 위임
- application dependency는 `apps/web/package.json`으로 이동

`pnpm-workspace.yaml`은 우선 `apps/*`와 `packages/*`를 포함한다. 존재하지 않는 package를 dependency로 참조하지 않는다.

## 주요 위험과 대응

### Vite root와 환경변수

Vite command의 working directory가 `apps/web`으로 바뀌어야 한다. `.env`는 Git에 추가하지 않고 사용자의 현재 Vite 값만 `apps/web/.env`로 안전하게 이동한다.

### Alias

`vite.config.ts`, `tsconfig.json`, `vitest.config.ts`가 모두 `apps/web/src`를 같은 alias로 가리키는지 확인한다. `src` 내부 상대 import 금지는 그대로 유지한다.

### MSW

`public/mockServiceWorker.js`가 `apps/web/public`으로 이동했는지 확인한다. 개발과 test server가 실제 network 요청을 만들지 않는지 통합 테스트로 재검증한다.

### CI와 build output

CI는 root에서 frozen install 후 workspace scripts를 실행한다. Vite output은 `apps/web/dist`이며 root `dist`를 기대하는 배포 설정이 있다면 같은 commit에서 경로를 수정한다.

### Git history와 rollback

파일 이동은 가능한 한 `git mv`로 수행한다. Phase 1A를 하나의 독립 commit으로 만들고, rollback은 해당 commit revert로 수행한다. 사용자 파일을 reset, restore, clean하지 않는다.

## 실행 순서

1. 현재 branch, status, Node, pnpm, 원격 기준 commit 확인
2. Phase 0 기준선 commit을 rollback base로 기록
3. root workspace 파일과 orchestration package 작성
4. 기존 Vite 파일을 `apps/web`으로 Git move
5. package scripts, alias, Tailwind, Vitest, CI 경로 수정
6. frozen install로 workspace lockfile 정합성 확인
7. format, lint, typecheck, test, build 실행
8. 개발 서버 직접 URL과 MSW 핵심 흐름 smoke 확인
9. 변경 파일과 rollback commit을 문서화

## Acceptance Criteria

- [ ] root에 `pnpm-workspace.yaml` 존재
- [ ] `apps/web/package.json`에서 기존 Vite 앱 실행 가능
- [ ] root `pnpm dev`가 web app 실행
- [ ] `apps/web/src`, `public`, `index.html` 구조 정상
- [ ] alias가 Vite, TypeScript, Vitest에서 동일하게 동작
- [ ] MSW browser worker와 test server 정상
- [ ] React Router direct URL과 lazy route 정상
- [ ] current `.env`가 Git에 포함되지 않음
- [ ] Next.js, Prisma, backend dependency가 추가되지 않음
- [ ] `pnpm run format:check` 통과
- [ ] `pnpm run lint` 통과
- [ ] `pnpm run typecheck` 통과
- [ ] 14 files, 40 tests 이상 통과
- [ ] `pnpm run build` 통과
- [ ] Phase 1A 변경이 독립 commit이며 revert 가능
