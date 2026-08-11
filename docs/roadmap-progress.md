---
title: JLPT Drill Note 로드맵 진행 상태
last_updated: 2026-08-11
---

# 로드맵 진행 상태

| 단계                                  | 상태   | 근거                                |
| ------------------------------------- | ------ | ----------------------------------- |
| Alpha MVP                             | 완료   | `README.md`, Vite source와 40 tests |
| Phase 0 Vite 기준선 감사              | 완료   | `docs/P0_VITE_BASELINE_REPORT.md`   |
| Phase 1A pnpm workspace 전환          | 대기   | `docs/monorepo-readiness.md`        |
| Phase 1 프런트 구조 안정화            | 미시작 | Phase 1A 이후                       |
| Phase 2 API·domain 계약과 backend ADR | 미시작 | 사용자 명시적 시작 필요             |
| Phase 3 이후 실제 backend·DB          | 미시작 | 사용자 명시적 시작 필요             |

## 현재 판정

Phase 0은 Ready로 완료했다. 현재 저장소의 적용 기준은 Vite, React Router, TanStack Query, Zustand, Axios, Zod, MSW다. 장기 로드맵의 실제 API와 DB는 현재 범위가 아니다.

## 다음 단일 작업

Phase 1A에서 기존 Vite 앱을 pnpm workspace의 `apps/web`으로 이동한다. backend, ORM, auth, 기능 refactor는 포함하지 않는다.

## 완료 gate

- Phase 0 기준선 commit과 원격 반영
- `docs/monorepo-readiness.md` Acceptance Criteria 충족
- format, lint, typecheck, 40 tests 이상, build 통과
- 이동 전후 Vite와 MSW 핵심 흐름 유지
- 독립 commit과 rollback 경로 기록
