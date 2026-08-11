---
title: JLPT Drill Note v1.0 전체 완성 로드맵
document_status: Source of Truth
current_stage: Phase 0 완료 — Vite 기준선 확정, Phase 1A 준비
product_target: Public Beta 및 v1.0 정식 공개
last_updated: 2026-08-11
---

# JLPT Drill Note v1.0 전체 완성 로드맵

## 0. 이 문서의 역할

이 문서는 **간단한 Alpha 버전이 완성된 이후부터 v1.0 정식 공개까지의 전체 개발 기준 문서**다.

Codex는 이 문서를 프로젝트의 장기 로드맵이자 작업 범위의 기준으로 사용한다. 다만 한 번의 요청으로 전체 로드맵을 모두 구현하지 않는다. 이후 사용자가 특정 Phase 또는 Vertical Slice를 지정하면 **지정된 범위만 완성하고 검증한 뒤 멈춘다.**

현재 적용 범위와 장기 목표를 구분한다. 현재 P0 기준선은 Vite와 MSW 기반 프런트엔드이며, 실제 API·DB·인증은 사용자가 해당 미래 Phase를 명시적으로 시작하기 전까지 구현하지 않는다. 미래 백엔드 단계에서도 `apps/web`은 Vite를 유지하며 Next.js로 전환하지 않는다.

pnpm workspace 모노레포 전환은 승인된 결정이다. Phase 2 ADR은 API 프레임워크, ORM, 인증 방식을 선택하지만 모노레포 여부를 다시 결정하지 않는다.

### Codex 작업 원칙

1. 작업 시작 전 저장소와 현재 구현 상태를 직접 확인한다.
2. 이 문서의 추정과 실제 코드가 다르면 실제 코드를 우선하되, 차이를 결과 보고에 명시한다.
3. 다음 규칙 파일이 저장소에 있다면 항상 먼저 읽고 적용한다.
   - `01-frontend-guidelines.mdc`
   - `02-formatting.mdc`
   - `03-api-guidelines.mdc`
   - React/JavaScript 성능 관련 `SKILL.md`
   - Web Interface Guidelines 관련 `SKILL.md`
4. 기존 ESLint, Prettier, TypeScript, Vite 설정을 이유 없이 덮어쓰지 않는다.
5. 이미 동작하는 기능을 깨뜨리는 대규모 재작성은 피한다.
6. 핵심 기능을 TODO, 빈 함수, 미동작 버튼, 하드코딩된 성공 결과로 남기지 않는다.
7. 범위 밖 기능을 임의로 추가하지 않는다.
8. 완료라고 표시하기 전에 관련 테스트와 검증 명령을 실제로 실행한다.
9. 실행하지 않은 검증을 실행했다고 주장하지 않는다.
10. 각 Phase 종료 시 로드맵 진행 상태와 결정 문서를 갱신한다.

### 매 작업 종료 시 기본 검증

저장소의 실제 스크립트를 먼저 확인한 뒤, 가능한 범위에서 다음을 실행한다.

```bash
pnpm run format
pnpm run lint:fix
pnpm run typecheck
pnpm run test
pnpm run build
```

E2E가 구성된 이후에는 다음도 포함한다.

```bash
pnpm run test:e2e
```

---

# 1. 제품 목표

## 1.1 서비스 정의

**JLPT Drill Note**는 JLPT N5부터 N1까지의 학습자가 청해를 제외한 다음 과목을 공부하는 웹 서비스다.

- 문자·어휘
- 문법
- 독해

사용자는 급수와 과목을 선택해 문제를 풀고, 결과를 확인하며, 틀린 문제를 자동으로 오답노트에 저장해 반복 학습한다. 서비스는 단순 문제은행이 아니라 **틀린 문제와 약점을 추적하고 적절한 시점에 다시 풀게 하는 학습 시스템**을 목표로 한다.

## 1.2 핵심 가치

```text
문제를 많이 푸는 서비스
    ↓
사용자가 무엇을 왜 반복해서 틀리는지 기록하고,
다시 풀어 해결하도록 돕는 서비스
```

## 1.3 v1.0의 핵심 사용자

- JLPT N5~N1을 준비하는 한국어 사용자
- 책이나 PDF로 문제를 풀지만 오답 정리가 번거로운 사용자
- 급수·과목·문제 유형별 약점을 파악하고 싶은 사용자
- 모바일과 데스크톱을 오가며 학습을 이어가고 싶은 사용자

## 1.4 v1.0 지원 범위

### 포함

- N5, N4, N3, N2, N1
- 문자·어휘, 문법, 독해
- 실제 사용자 인증
- 실제 DB 저장
- 실제 API
- 문제풀이 세션 생성·복구·제출
- 서버 기준 채점
- 결과 및 해설
- 자동 오답노트
- 복습 일정과 복습 이력
- 즐겨찾기
- 학습 대시보드
- 약점 분석
- 규칙 기반 추천
- 관리자 문제 CMS
- 문제 검수·공개·버전 관리
- 문제 오류 신고
- 한국어 UI와 일본어 UI
- 모바일·태블릿·데스크톱 반응형
- 키보드 접근성
- 테스트, 배포, 모니터링, 백업
- 포트폴리오 문서

### v1.0에서 제외

- 청해
- 음원 관리
- AI 자동 해설
- AI 생성 문제의 자동 공개
- 결제
- 커뮤니티
- 랭킹
- 강사·학생 조직 기능
- 네이티브 모바일 앱
- 사용자 간 메시지

제외 기능은 핵심 학습 흐름이 안정된 뒤 v1.x 또는 v2에서 검토한다.

---

# 2. 현재 상태 정의

Phase 0 코드베이스 감사와 Vite 기준선 정리를 완료했다. 결과는 `docs/P0_VITE_BASELINE_REPORT.md`에, Phase 1A 이동 매핑과 위험·rollback 기준은 `docs/monorepo-readiness.md`에 기록한다.

현재 앱은 MSW와 localStorage 기반 Alpha다. 정답 비노출, 오답 상태 머신, 관리자 CRUD, 세션 복구, 권한 분리, 접근성 구조, 테스트와 build 기준선을 확인했다. 실제 API·DB·인증은 현재 결함이 아니라 사용자가 미래 Phase를 시작할 때 구현할 장기 범위다.

따라서 다음 작업은 **Phase 1A: pnpm workspace 기반 모노레포 구축 및 기존 Vite 앱의 `apps/web` 이동**이다.

---

# 3. 기술 및 아키텍처 기준

## 3.1 프런트엔드 기준

현재 프로젝트의 기본 방향을 유지한다.

- Vite
- React
- TypeScript
- React Router `createBrowserRouter`
- TanStack Query
- Zustand
- Axios
- Zod
- MSW
- React Hook Form
- Tailwind CSS 또는 현재 스타일 시스템
- Vitest
- React Testing Library
- Playwright
- pnpm

Next.js 전용 구조로 임의 전환하지 않는다.

## 3.2 프런트엔드 폴더 원칙

```text
src/
├── api/
├── app/
├── common/
├── libs/
├── mocks/
├── provider/
├── store/
├── test/
├── util/
├── main.tsx
└── router.tsx
```

도메인별 기본 구조는 다음을 유지한다.

```text
src/app/{domain}/
├── components/
├── hooks/
├── queries/
├── page.tsx
└── router.tsx
```

## 3.3 데이터 흐름

모든 서버 상태는 아래 경로를 따른다.

```text
MSW 또는 실제 API
→ src/api/{domain}/{endpoint}
→ Query Factory
→ 도메인 커스텀 훅
→ 컴포넌트
```

금지:

- 컴포넌트에서 Axios 직접 호출
- 컴포넌트에서 `fetch` 직접 호출
- 컴포넌트에서 `apiClient` 직접 사용
- 컴포넌트에서 직접 `useQuery` 또는 `useMutation` 호출
- 컴포넌트에서 Mock 데이터 직접 import
- API 응답을 검증하지 않고 사용
- 서버 응답 데이터를 Zustand에 중복 저장

## 3.4 TanStack Query와 Zustand의 역할

### TanStack Query

- 문제 목록
- 세션 상세
- 제출 결과
- 오답노트
- 북마크
- 대시보드 통계
- 관리자 문제 데이터
- 서버에서 생성·수정·삭제되는 모든 데이터

### Zustand

- 현재 문제 번호
- 제출 전 선택 답안
- 세션 시작 시각
- 키보드·모바일 메뉴 같은 UI 상태
- 복구를 위한 클라이언트 임시 상태
- 데모 단계의 인증 표시 상태

실제 인증 세션의 권위 있는 상태는 서버가 가진다.

## 3.5 API 규칙

- 모든 응답은 `safe*`와 Zod schema로 검증한다.
- `apiClient`는 `http.ts` 래퍼를 통해서만 사용한다.
- API 도메인은 명사·단수·소문자를 사용한다.
- 엔드포인트는 `get`, `list`, `search`, `create`, `update`, `delete` 규칙을 따른다.
- mutation 후 관련 detail/list/dashboard 캐시를 정확히 갱신한다.
- API 에러는 인증, 권한, 404, 서버, 네트워크, 오프라인, 검증 오류로 분류한다.
- 인터셉터는 에러 플래그만 구성하고 UI 이동·Toast는 Provider 또는 화면 계층에서 처리한다.

### `config.ts`와 `http.ts` 충돌 해결

규칙 문서의 설명과 예제에 순환 의존 가능성이 있으므로 실제 구현에서는 다음을 우선한다.

```text
config.ts는 http.ts를 import하지 않는다.
http.ts는 config.ts를 import한다.
```

`safeFactory`는 전달받은 비동기 함수의 인자와 반환 타입을 generic으로 추론하도록 구성한다.

## 3.6 TypeScript 및 포맷 기준

- 명시적 `any` 사용 금지
- 알 수 없는 오류는 `unknown`으로 받고 타입 가드로 좁힌다.
- 컴포넌트 Props는 `type`
- 일반 데이터 구조는 `interface`
- 타입 import에는 `type` 접두사 사용
- React 컴포넌트는 Arrow Function
- src 내부는 절대경로 import
- state와 props는 불변으로 취급
- 기존 포맷 설정이 있으면 유지
- 코드 수정 후 format 및 lint 실행

`02-formatting.mdc`의 ESLint 예제에서 `no-explicit-any`가 비활성화되어 있더라도, 프로젝트 코드에서는 더 엄격한 프런트엔드 규칙을 적용해 `any`를 사용하지 않는다.

## 3.7 성능 기준

성능 작업은 미세 최적화보다 다음 순서로 진행한다.

1. 네트워크 waterfall 제거
2. 독립 비동기 작업 병렬화
3. 초기 bundle 축소
4. route와 대형 기능 코드 스플리팅
5. API payload 최소화
6. 중복 요청 제거
7. 긴 목록 렌더링 최적화
8. 반복 탐색을 `Map`·`Set`으로 전환
9. `sort()` 변형 방지 및 `toSorted()` 사용
10. storage 반복 접근 방지
11. functional update와 lazy initialization
12. 실제 병목이 없는 수동 memoization 남용 금지

React Compiler가 활성화되어 있다면 `memo`, `useMemo`, `useCallback`을 습관적으로 추가하지 않는다.

## 3.8 UI 감사 기준

UI·접근성 검토 시 매번 최신 Web Interface Guidelines를 가져와 적용한다.

```text
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

검토 결과는 `file:line` 형식으로 남기고 높은 우선순위와 중간 우선순위 위반을 수정한다.

---

# 4. 목표 아키텍처 방향

정확한 백엔드 프레임워크와 ORM은 Phase 2의 ADR에서 확정한다. 기본 권장 구조는 다음과 같다.

```text
repository/
├── apps/
│   ├── web/                 기존 Vite React 앱
│   └── api/                 TypeScript REST API
├── packages/
│   ├── contracts/           공유 Zod request/response schema
│   ├── domain/              채점·복습·추천 순수 로직
│   └── config/              공통 TypeScript/ESLint 설정
├── docs/
└── pnpm-workspace.yaml
```

기본 데이터베이스는 PostgreSQL을 권장한다.

백엔드 프레임워크와 ORM은 다음 조건으로 선택한다.

- TypeScript 타입 안정성
- Zod 계약 공유 가능성
- transaction 지원
- migration 관리
- 테스트 편의성
- 관리 가능한 배포 복잡도
- 현재 저장소와의 호환성

후보 예시:

- API: Fastify, NestJS, Hono 기반 Node 서버 중 하나
- ORM: Drizzle 또는 Prisma
- 인증: HTTP-only Cookie 기반 서버 세션 또는 검증된 인증 라이브러리

Codex는 사용자 지시 없이 후보 중 하나를 임의로 대규모 도입하지 않는다. Phase 2에서 비교 결과와 ADR을 작성한 뒤 선택한다.

---

# 5. 전체 Milestone 요약

| 순서 | 단계                 | 핵심 결과                                | 출시 상태          |
| ---: | -------------------- | ---------------------------------------- | ------------------ |
|    0 | 코드베이스 감사      | 현재 상태표, Gap Analysis, v1 범위       | Alpha 정리         |
|    1 | 프런트 구조 안정화   | 규칙 위반 제거, API·Query·상태 구조 고정 | Stable Alpha       |
|    2 | 도메인·API 계약      | ERD, 버전 정책, API 계약, ADR            | Backend Ready      |
|    3 | 실제 백엔드·DB·인증  | 첫 실제 Vertical Slice                   | Internal Beta 기반 |
|    4 | 문제풀이 실서비스화  | 세션 복구·제출·채점·결과 무결성          | Internal Beta      |
|    5 | 오답·복습 엔진       | 복습 일정, 상태 머신, 이력               | Internal Beta      |
|    6 | 콘텐츠 파이프라인    | 문제 제작·검수·커버리지                  | Public Beta 기반   |
|    7 | 관리자 CMS           | 코드 배포 없는 콘텐츠 운영               | Public Beta 기반   |
|    8 | 통계·약점·추천       | 설명 가능한 개인화 학습                  | Public Beta        |
|    9 | 디자인·다국어·접근성 | KO/JA, 반응형, 접근성                    | Release Candidate  |
|   10 | 테스트·보안·성능     | 품질 게이트 통과                         | Release Candidate  |
|   11 | 배포·모니터링·운영   | Staging/Production 운영 가능             | Production Ready   |
|   12 | Beta 검증·v1.0       | 실제 사용자 검증, 포트폴리오             | v1.0               |

---

# 6. Phase 0 — 현재 코드베이스 감사 및 v1 범위 확정

## 목표

현재 구현을 추측하지 않고 실제 저장소 기준으로 분류한다. 이후 단계에서 불필요한 재작업이 발생하지 않도록 **무엇이 완성됐고 무엇이 UI만 존재하는지**를 명확히 한다.

## 작업

### 6.1 저장소 점검

- `package.json` 및 pnpm script 확인
- Vite, React, TypeScript 버전 확인
- 라우터 구조 확인
- Provider 중첩 확인
- 도메인별 폴더 구조 확인
- API 계층 확인
- MSW handler와 Mock Repository 확인
- Query Factory와 커스텀 훅 확인
- Zustand 상태 범위 확인
- 인증·권한 처리 확인
- 테스트 구성 확인
- 배포 설정 확인

### 6.2 기능 상태 분류

각 기능을 다음 네 상태로 분류한다.

| 상태        | 의미                                           |
| ----------- | ---------------------------------------------- |
| Complete    | 정상·오류·빈 상태와 테스트까지 동작            |
| Partial     | 정상 흐름은 동작하지만 예외 또는 저장이 미완성 |
| Placeholder | UI 또는 버튼만 존재                            |
| Missing     | 구현 없음                                      |

점검 대상:

- 홈
- 로그인 또는 데모 인증
- 문제풀이 설정
- 세션 생성
- 문제 조회
- 답안 선택
- 키보드 조작
- 새로고침 복원
- 제출
- 결과
- 오답 자동 저장
- 오답 재풀이
- 즐겨찾기
- 대시보드
- 관리자 목록
- 관리자 생성·수정·삭제
- 사용자·관리자 권한
- 로딩·오류·빈 상태
- 모바일 독해 레이아웃
- 접근성
- 단위·컴포넌트·E2E 테스트

### 6.3 구조 위반 검색

- 컴포넌트의 직접 API 호출
- 컴포넌트의 직접 `useQuery`/`useMutation`
- Mock 직접 import
- 서버 데이터를 Zustand에 복제
- 상대경로 import
- 명시적 `any`
- 풀이 API의 정답·해설 노출
- `localStorage` 반복 직접 접근
- state/props 배열의 mutating `sort()`
- 중복 keydown listener
- `window.alert` 및 `window.confirm`
- `config.ts`와 `http.ts` 순환 의존
- 미동작 버튼과 TODO
- 테스트가 없는 핵심 도메인 로직

### 6.4 기준 문서 작성

```text
docs/
├── current-status.md
├── gap-analysis.md
├── v1-scope.md
├── roadmap-progress.md
└── adr/
    └── README.md
```

## 산출물

- 기능별 상태표
- 구조 위반 목록
- 현재 테스트·빌드 결과
- v1 포함·제외 범위
- Phase 1 우선순위
- 변경하지 말아야 할 기존 동작 목록

## 완료 조건

- [ ] 전체 기능 상태가 Complete/Partial/Placeholder/Missing으로 분류됨
- [ ] 현재 `format`, `lint`, `typecheck`, `test`, `build` 결과 기록
- [ ] P0/P1/P2 Gap 목록 작성
- [ ] v1 범위 확정
- [ ] 다음 Phase에서 수정할 파일과 수정하지 않을 파일 구분
- [ ] 코드 변경이 필요한 감사라면 최소 변경만 수행

## Phase 종료 시 보고

1. 현재 구현 수준 요약
2. 확인된 구조 문제
3. 사용자 흐름별 Gap
4. 테스트와 빌드 상태
5. Phase 1 권장 작업 순서
6. 위험 요소

---

# 7. Phase 1 — 프런트엔드 아키텍처 안정화

## 목표

새로운 제품 기능을 추가하기 전에 현재 Alpha의 구조를 규칙에 맞게 고정한다.

## 주요 작업

### 라우팅·Provider

- `createBrowserRouter` 기반 도메인 라우트 정리
- Layout, Outlet, Suspense 구성
- 공개·USER·ADMIN 라우트 구분
- 로그인 전 경로 보존
- Route error boundary
- 403, 404, 일반 오류 분리
- ReactQueryProvider가 RouterProvider 외부에 위치

### API 계층

- 모든 endpoint에 request/response Zod schema
- `safeGet`, `safePost`, `safePut`, `safeDel` 사용
- API 함수 → Query Factory → 도메인 훅 구조 통일
- Query 및 Mutation 중앙 오류 처리
- `config.ts`/`http.ts` 순환 의존 제거
- MSW와 실제 API가 공유할 계약 구조 마련

### 상태 관리

- 서버 상태를 Zustand에서 제거
- 문제풀이 임시 상태만 Zustand에 유지
- storage adapter를 통한 복구
- localStorage 읽기 캐시
- 다른 탭 변경 시 필요한 무효화

### 공통 UI 상태

- Loading
- Skeleton
- Empty
- Error
- Offline
- Forbidden
- Not Found
- Retry

## 산출물

- 안정화된 폴더 구조
- API 계층 정리
- Query Factory/도메인 훅 정리
- 공통 오류·빈 상태 컴포넌트
- 구조 규칙 검사 결과

## 완료 조건

- [ ] 컴포넌트 직접 API 호출 0건
- [ ] 컴포넌트 직접 Query/Mutation 호출 0건
- [ ] Mock 직접 import 0건
- [ ] Zod 미검증 API 응답 0건
- [ ] 명시적 `any` 0건
- [ ] 순환 의존 0건
- [ ] 핵심 route에 Loading/Error/Not Found 처리
- [ ] 기존 핵심 사용자 흐름 회귀 없음
- [ ] format, lint, typecheck, test, build 통과

---

# 8. Phase 2 — 도메인 모델, API 계약, 백엔드 ADR 확정

## 목표

실제 DB와 API를 만들기 전에 데이터 모델과 상태 전이를 확정한다. 이 단계가 끝난 뒤에는 프런트와 백엔드가 같은 계약을 사용해야 한다.

## 핵심 도메인 모델

### 사용자

```text
User
UserProfile
UserGoal
AuthSession
```

### 문제·콘텐츠

```text
Question
QuestionVersion
QuestionOption
Tag
QuestionTag
QuestionSource
ContentReview
QuestionReport
```

### 학습

```text
StudySession
StudySessionQuestion
StudyAnswer
StudyResult
```

### 오답·복습

```text
WrongNote
ReviewSchedule
ReviewEvent
Bookmark
UserMemo
```

### 운영

```text
AdminAuditLog
QuestionStat
DailyUserStat
AnalyticsEvent
```

## 문제 버전 관리

문제의 영구 ID와 실제 공개 내용을 분리한다.

```text
Question
- 영구 식별자
- 현재 상태
- 현재 공개 버전

QuestionVersion
- 실제 지문
- 질문
- 보기
- 정답
- 해설
- 태그 스냅샷
- 버전 번호
- 작성자
- 검수자
- 공개 시각
```

`StudySessionQuestion`은 당시의 `questionVersionId`를 저장한다. 관리자가 문제를 수정해도 과거 결과와 해설이 바뀌지 않아야 한다.

## API 계약 원칙

### 성공

```ts
interface ApiSuccess<T> {
  data: T
  meta?: {
    page?: number
    pageSize?: number
    totalCount?: number
  }
}
```

### 실패

```ts
interface ApiFailure {
  code: string
  message: string
  fieldErrors?: Record<string, string[]>
  requestId?: string
}
```

### 날짜

모든 API 날짜는 ISO 8601 문자열로 전달한다.

### 문제풀이 공개 모델

세션 시작 응답에 다음을 포함하지 않는다.

- 정답 option ID
- `isCorrect`
- 해설
- 정답 근거
- 관리자 메모
- 공개되지 않은 상태 정보

정답과 해설은 제출 결과에서만 반환한다.

## 서버 제출 규칙

1. 세션 존재 여부 확인
2. 사용자 소유권 확인
3. 세션 상태 확인
4. 중복 제출 확인
5. 문제 버전 확인
6. 선택지 유효성 확인
7. 서버 채점
8. 결과 저장
9. 오답·복습 상태 갱신
10. 통계 갱신
11. 결과 반환

관련 저장 작업은 하나의 transaction으로 처리한다.

## ADR 작성

```text
docs/adr/
├── 001-repository-structure.md
├── 002-backend-framework.md
├── 003-database-and-orm.md
├── 004-authentication.md
├── 005-question-versioning.md
├── 006-study-submit-idempotency.md
└── 007-review-algorithm.md
```

## 산출물

- ERD
- 전체 API 목록
- request/response Zod schema
- 상태 머신 문서
- 문제 버전 정책
- 제출 idempotency 정책
- 백엔드·DB·인증 ADR

## 완료 조건

- [ ] ERD 작성
- [ ] 프런트·백엔드 공유 계약 구조 확정
- [ ] Mock handler가 계약과 일치
- [ ] 정답 비노출 계약 테스트
- [ ] 문제 버전 정책 확정
- [ ] 제출 중복·재시도 정책 확정
- [ ] 오답 상태 머신 확정
- [ ] 백엔드 스택 ADR 승인 가능 상태

---

# 9. Phase 3 — 실제 백엔드, DB, 인증 연결

## 목표

Mock 기반 Alpha를 실제 사용자 데이터가 저장되는 Internal Beta 기반으로 전환한다.

## 첫 번째 Vertical Slice

```text
실제 로그인
→ 실제 세션 생성
→ 공개 문제 조회
→ 답안 임시 저장
→ 서버 제출
→ 결과 저장
→ 오답 생성
→ 대시보드 반영
```

이 흐름이 완전히 연결되기 전에는 관리자 기능과 통계를 넓게 확장하지 않는다.

## 주요 작업

### 저장소 구조

고정된 pnpm workspace 모노레포의 `apps/api`에 Phase 2 ADR에서 선택한 API stack을 구성한다.

### DB

- PostgreSQL
- migration
- seed
- transaction
- 개발·테스트·운영 DB 분리
- 안전한 초기 관리자 생성

### 인증

v1 최소 범위:

- 이메일 또는 소셜 로그인 한 종류 이상
- HTTP-only Cookie 기반 세션 권장
- USER / ADMIN 역할
- 로그아웃
- 세션 만료
- 계정 삭제
- 학습 데이터 내보내기 기반
- 게스트 데이터의 로그인 계정 이전 정책

장기 인증 토큰을 브라우저 localStorage에 직접 저장하지 않는다.

### 권한

- USER가 다른 사용자의 세션을 조회하지 못함
- USER가 관리자 API에 접근하지 못함
- 관리자 기능은 UI 숨김뿐 아니라 서버 권한 검사
- 객체 단위 소유권 검증

### MSW 유지

- 개발에서 선택적 Mock
- 테스트에서 MSW 사용
- Staging/Production 기본 비활성화
- 오류·오프라인·지연 시나리오 테스트에 활용

## 산출물

- 실제 API 앱
- DB schema 및 migration
- 인증·권한
- 공유 contracts
- 첫 실제 Vertical Slice
- 실제 API와 Mock 모드 전환 설정

## 완료 조건

- [ ] 사용자 데이터가 DB에 저장됨
- [ ] 다른 브라우저에서 동일 계정 기록 확인 가능
- [ ] 다른 사용자 세션 접근 차단
- [ ] USER 관리자 API 접근 차단
- [ ] Mock 모드와 실제 API 모드 모두 동작
- [ ] migration과 seed 명령 문서화
- [ ] 첫 Vertical Slice E2E 통과
- [ ] 서버 제출 transaction 테스트 통과

---

# 10. Phase 4 — 문제풀이 핵심 흐름 실서비스화

## 목표

문제풀이를 정상 흐름뿐 아니라 이탈·재접속·네트워크 실패·중복 제출까지 견디는 실제 서비스 수준으로 만든다.

## 전체 흐름

```text
급수 선택
→ 과목 선택
→ 문제 수 선택
→ 출제 모드 선택
→ 세션 생성
→ 문제풀이
→ 답안 임시 저장
→ 재접속 복구
→ 제출 확인
→ 서버 채점
→ 결과
→ 오답·통계 반영
```

## 출제 모드

- RANDOM
- WRONG_NOTE
- WEAKNESS
- BOOKMARK
- DAILY_REVIEW

## 출제 규칙

- 한 세션 안 문제 중복 금지
- 공개된 문제와 공개 버전만 사용
- 삭제·보관·중단 문제 제외
- 세션 생성 시 문제 버전 고정
- 최근 출제 문제 반복 최소화
- 문제 부족 시 실제 출제 수 안내
- 출제 대상이 없으면 EmptyState와 대체 CTA 제공

## 진행 상태

- 세션 ID
- 문제 순서
- 선택 답안
- 문제별 소요 시간
- 전체 시작 시각
- 현재 문제 번호
- 마지막 저장 시각
- 북마크 상태

## 재접속 및 제출

- 새로고침 후 이어풀기
- 다른 기기에서 이어풀기
- 만료 세션 처리
- 제출 완료 세션 수정 금지
- 네트워크 실패 후 재시도
- idempotency key 또는 동등한 중복 제출 방지
- 동일 제출이 두 번 저장되지 않음

## 결과

- 정답·오답 텍스트
- 사용자 선택
- 정답
- 한국어 해설
- 일본어 해설이 있으면 표시
- 태그
- 오답 상태
- 북마크
- 문제 오류 신고

## 완료 조건

- [ ] 직접 URL 진입 정상
- [ ] 새로고침·재로그인 후 세션 복구
- [ ] 중복 제출 방지
- [ ] 제출 전 정답·해설 비노출
- [ ] 결과와 DB 통계 일치
- [ ] 네트워크 오류 재시도 가능
- [ ] 모바일과 키보드만으로 전체 흐름 완료
- [ ] 핵심 E2E 통과

---

# 11. Phase 5 — 오답노트 및 복습 엔진 완성

## 목표

틀린 문제를 단순 저장하지 않고 복습 시점을 관리하며 상태 변화 이력을 보존한다.

## 오답 상태

```text
NEW
REVIEWING
AGAIN
SOLVED
```

## 기본 상태 전이

### 첫 오답

```text
wrongCount = 1
correctStreak = 0
status = NEW
```

### NEW에서 정답

```text
correctStreak = 1
status = REVIEWING
```

### REVIEWING에서 정답

```text
correctStreak = 2
status = SOLVED
```

### NEW 또는 REVIEWING에서 오답

```text
wrongCount += 1
correctStreak = 0
status = AGAIN
```

### AGAIN에서 정답

```text
correctStreak += 1
1회 정답: REVIEWING
2회 이상 연속 정답: SOLVED
```

### SOLVED에서 오답

```text
wrongCount += 1
correctStreak = 0
status = AGAIN
```

## v1 복습 일정 예시

```text
최초 오답       → 1일 뒤
첫 복습 정답    → 3일 뒤
두 번째 정답    → 7일 뒤
추가 정답       → 14일 뒤
안정 정답       → 30일 뒤
복습 중 오답    → 1일 뒤로 초기화
```

정확한 간격은 Phase 2 ADR에서 확정한다.

## ReviewEvent

현재 상태만 저장하지 않고 모든 복습 이력을 기록한다.

```text
ReviewEvent
- userId
- questionVersionId
- previousStatus
- nextStatus
- isCorrect
- elapsedSec
- reviewedAt
```

## 화면 기능

- 오늘 복습할 문제
- 미복습
- 반복 오답
- 해결됨
- 급수·과목·유형·태그 필터
- 복습 예정일 정렬
- 많이 틀린 순
- 사용자 메모
- 문제 신고
- 한 문제 재풀이
- 묶음 복습

## 완료 조건

- [ ] 전체 상태 전이 단위 테스트
- [ ] 복습 일정 계산 단위 테스트
- [ ] ReviewEvent 이력 보존
- [ ] 문제 수정 후 과거 이력 유지
- [ ] SOLVED 재오답 시 AGAIN 복귀
- [ ] 오늘 복습 수와 실제 목록 일치
- [ ] DAILY_REVIEW E2E 통과

---

# 12. Phase 6 — 문제 콘텐츠 제작 및 검수 파이프라인

## 목표

기술적으로 동작하는 앱을 실제로 공부할 수 있는 서비스로 전환한다. 콘텐츠 작업은 Phase 2부터 병렬로 시작한다.

## 우선 제작 순서

1. N3
2. N2
3. N4
4. N5
5. N1

현재 사용자 학습 목적과 제작 난이도를 고려한 권장 순서이며 필요하면 변경할 수 있다.

## 콘텐츠 상태

```text
DRAFT
IN_REVIEW
CHANGES_REQUESTED
APPROVED
PUBLISHED
SUSPENDED
ARCHIVED
```

## Coverage Matrix

문제 수만 집계하지 않고 다음 조합을 관리한다.

```text
급수
× 과목
× 문제 유형
× 난이도
× 태그
```

지원한다고 표시하는 급수에는 빈 핵심 유형이 없어야 한다.

## 권장 콘텐츠 규모

| 단계          |                                  기준 |
| ------------- | ------------------------------------: |
| Alpha         |                 현재 샘플 65문제 이상 |
| Internal Beta |                N3·N2 중심 300~500문제 |
| Public Beta   |       전 급수 합계 800~1,000문제 이상 |
| v1.0          | 1,000문제 이상 및 핵심 유형 공백 없음 |

숫자는 운영 상황에 따라 조정할 수 있으나, 공개 범위와 실제 문제 수가 일치해야 한다. 문제 수보다 정답 정확도와 유형 커버리지가 우선이다.

## 검수 기준

- 일본어가 자연스러운가
- 정답이 하나뿐인가
- 보기에 모호성이 없는가
- 급수 수준에 맞는가
- 해설이 충분한가
- 오답 선택지가 왜 틀렸는지 설명 가능한가
- 중복 문항이 아닌가
- 태그가 정확한가
- 출처·저작권 문제가 없는가
- 공개 후 정답률·풀이시간이 비정상적이지 않은가

## 저작권 원칙

허용:

- 직접 제작
- 공개 자료의 유형만 참고한 자체 문제
- AI 초안 후 사람 검수
- 사용자 신고에 따른 자체 수정

금지:

- JLPT 기출 복사
- 교재 문제 복사
- 출처 불명 문제 대량 등록
- AI 생성 문제 무검수 공개

## 문제 품질 지표

- 노출 횟수
- 정답률
- 평균 풀이시간
- 보기별 선택률
- 신고 횟수
- 스킵률
- 재오답률

비정상 문제는 검토 큐에 자동 등록할 수 있게 설계한다.

## 완료 조건

- [ ] Coverage Matrix 존재
- [ ] 문제별 작성자·검수자·상태 존재
- [ ] 중복 탐지 절차 존재
- [ ] 오류 신고 흐름 존재
- [ ] 공개 후 수정 시 새 버전 생성
- [ ] 문제 삭제 대신 보관 정책 적용
- [ ] 코드 배포 없이 문제 추가·수정 가능
- [ ] 공개 급수와 실제 콘텐츠 범위 일치

---

# 13. Phase 7 — 관리자 CMS 완성

## 목표

단순 CRUD를 실제 콘텐츠 제작·검수·공개·품질 관리 시스템으로 확장한다.

## 문제 목록

- 검색
- 급수
- 과목
- 문제 유형
- 난이도
- 상태
- 태그
- 작성자
- 검수자
- 작성·수정일
- 정답률
- 신고 수
- 페이지네이션
- 일괄 상태 변경

## 문제 편집

- 문제 미리보기
- 보기 4개
- 보기 순서 변경
- 정답 지정
- 한국어·일본어 해설
- 태그 자동완성
- 독해 지문
- 초안 저장
- 변경사항 비교
- 검수 요청
- 수정 요청
- 승인
- 공개
- 공개 중단
- 새 버전 생성

## 대량 작업

- CSV 또는 JSON Import
- Export
- Import 전 Zod 검증
- 오류 행 보고
- 중복 ID 차단
- 중복 보기 차단
- 잘못된 태그 차단
- 전체 실패 시 부분 저장 금지

## 감사 로그

다음을 기록한다.

```text
누가
언제
무슨 문제를
어떤 상태에서
어떤 상태로
무엇을 변경했는가
```

## 신고 처리

- 신고 사유
- 사용자 설명
- 처리 담당자
- 처리 상태
- 수정 버전 연결
- 종료 사유

## 완료 조건

- [ ] 콘텐츠 공개에 코드 배포 불필요
- [ ] 모든 상태 전환에 서버 권한 검증
- [ ] 변경 이력 확인 가능
- [ ] 공개 전 Preview 가능
- [ ] Import transaction 보장
- [ ] 신고가 관리자 큐에 연결
- [ ] 관리자 핵심 E2E 통과

---

# 14. Phase 8 — 대시보드, 약점 분석, 추천

## 목표

사용자가 다음에 무엇을 공부해야 하는지 설명 가능한 근거와 함께 제시한다.

## 기본 통계

- 전체 풀이 수
- 전체 정답률
- 급수별 정답률
- 과목별 정답률
- 유형별 정답률
- 태그별 정답률
- 평균 풀이시간
- 최근 학습
- 오늘 복습 예정 수
- 누적 오답 수
- 해결된 오답 수
- 반복 오답 수

## 약점 판정

표본이 없는 과목이나 한 문제만 푼 유형을 바로 약점으로 판단하지 않는다.

개념식:

```text
weaknessScore =
  오답률
  × 최근성 가중치
  × 반복 오답 가중치
  × 표본 신뢰도
```

최소 시도 횟수와 최근 학습 기간을 명시적으로 둔다.

## 추천 우선순위

```text
1. 오늘 복습 예정 문제
2. 반복 오답 문제
3. 최근 정답률이 낮은 유형
4. 오랫동안 학습하지 않은 약한 과목
5. 목표 급수의 새 문제
```

추천에는 이유를 표시한다.

예:

```text
최근 N2 문장 배열 문제의 정답률이 43%입니다.
오늘 복습 예정인 오답이 8개 있습니다.
```

## 성능 원칙

- 최솟값·최댓값 하나를 찾기 위해 전체 정렬 금지
- 반복 ID 조회는 Map
- 반복 포함 여부 검사는 Set
- 독립 통계 요청은 병렬 실행
- 차트는 route 초기 bundle에서 분리
- 텍스트 대체 정보 제공

## 완료 조건

- [ ] 대시보드 수치와 원본 답안 데이터 일치
- [ ] 표본 없는 항목을 약점으로 표시하지 않음
- [ ] 추천 이유 표시
- [ ] 문제 부족 시 fallback
- [ ] 통계 단위 테스트
- [ ] 중복 요청·waterfall 제거

---

# 15. Phase 9 — 디자인 시스템, 반응형, 다국어, 접근성

## 목표

기능이 동작하는 앱을 실제 공개 가능한 학습 서비스 UI로 정리한다.

## 디자인 시스템

- 색상 token
- 타이포그래피
- 간격
- 반경
- 그림자
- breakpoint
- focus 스타일
- 상태 색상
- z-index

공통 컴포넌트:

- Button
- IconButton
- Input
- Textarea
- Select
- RadioGroup
- Checkbox
- Dialog
- Toast
- Tabs
- Table
- Pagination
- Badge
- Progress
- Skeleton
- EmptyState
- ErrorState

## 반응형

### 모바일

- 한 열
- 터치 영역 확보
- 독해 지문 → 질문 → 보기 → 이동 버튼
- 가로 스크롤 최소화

### 태블릿

- 필요한 카드 2열
- 관리자 표 가로 스크롤 허용

### 데스크톱

- 독해 지문과 문제 2열
- 적절한 최대 콘텐츠 너비
- 지문 독립 스크롤 필요 여부 검증

## 다국어

v1 권장:

- 한국어 UI
- 일본어 UI
- 문제 본문 일본어
- 한국어 해설 기본
- 일본어 해설 선택

주요 UI 문자열을 JSX에 직접 흩어놓지 않고 i18n key로 관리한다.

## 접근성

- 올바른 heading 계층
- header/nav/main/footer landmark
- 모든 폼 label 연결
- 키보드 전체 사용 가능
- native radio 또는 올바른 radiogroup
- 숫자 1~4 답안 선택
- 이전·다음 단축키
- 입력창 포커스 시 단축키 비활성화
- 명확한 `focus-visible`
- Dialog 포커스 트랩 및 복귀
- 비동기 결과 `aria-live`
- 정답·오답 텍스트 병기
- 색상 대비
- 모바일 터치 영역
- reduced motion
- 표 정렬 `aria-sort`

## 최신 UI 감사

1. 최신 Web Interface Guidelines 가져오기
2. `src/app` 및 `src/common/components` 검토
3. `file:line` 결과 작성
4. 높은·중간 우선순위 수정
5. 재검토

## 완료 조건

- [ ] 한국어·일본어 전환
- [ ] 주요 하드코딩 UI 문자열 제거
- [ ] 모바일·태블릿·데스크톱 수동 검증
- [ ] 키보드 전체 플로우 통과
- [ ] Critical 접근성 오류 0건
- [ ] 최신 UI 가이드 감사 완료
- [ ] 높은·중간 우선순위 위반 해결

---

# 16. Phase 10 — 테스트, 보안, 성능 최적화

## 목표

정상 동작만 확인하는 수준을 넘어 회귀, 권한 우회, 데이터 누출, 네트워크 실패를 검증한다.

## 테스트 전략

### 단위 테스트

- 채점
- 정답률 계산
- 오답 상태 머신
- 복습 일정
- 약점 점수
- 추천 순위
- 문제 shuffle
- 문제 공개 모델 변환
- 세션 만료
- 문제 버전 처리
- idempotency

### 컴포넌트 테스트

- 문제 보기 클릭
- 숫자 키 선택
- 이전·다음 키
- 제출 Dialog
- 관리자 문제 폼
- 중복 보기 검증
- 독해 passage 검증
- 오류·오프라인·빈 상태
- 필터와 페이지네이션

### API 통합 테스트

- 인증
- 소유권
- USER/ADMIN 권한
- 세션 생성
- 중복 제출
- 잘못된 option ID
- 정답 사전 비노출
- 오답 상태 갱신
- 문제 버전 고정
- 관리자 상태 전환

### E2E

사용자:

```text
가입·로그인
→ 설정
→ 문제풀이
→ 제출
→ 결과
→ 오답노트
→ 복습
→ 대시보드 반영
```

관리자:

```text
관리자 로그인
→ 문제 생성
→ 검수
→ 공개
→ 사용자 출제
→ 수정 버전 생성
```

## 보안

- IDOR 방지
- 서버 역할·소유권 검증
- Zod 입력 검증
- 출력 필드 최소화
- 정답 사전 노출 방지
- XSS 방지
- HTML sanitize
- Rate limit
- Secure/HttpOnly/SameSite Cookie
- CORS 제한
- 환경변수 보호
- 관리자 감사 로그
- dependency audit
- transaction
- 중복 제출 방지

## 성능

- waterfall 제거
- `Promise.all` 또는 병렬 Query
- route lazy loading
- 관리자·차트 지연 로드
- large module conditional import
- API 응답 필드 최소화
- Query 중복 제거
- Map/Set 인덱스
- immutable sorting
- `content-visibility` 또는 가상화
- storage 메모리 캐시
- functional state update
- lazy initialization
- 고정 RegExp module scope
- 실제 측정 없는 수동 memoization 남용 금지

## 완료 조건

- [ ] 핵심 도메인 단위 테스트
- [ ] 사용자·관리자 E2E 통과
- [ ] 권한 우회 테스트 통과
- [ ] 정답 누출 테스트 통과
- [ ] 핵심 접근성 테스트 통과
- [ ] bundle 분석 기록
- [ ] API waterfall 분석
- [ ] 성능 baseline 기록
- [ ] CI에서 전체 품질 게이트 실행

---

# 17. Phase 11 — 배포, 모니터링, 운영 체계

## 목표

개발자의 로컬 환경이 아니라 실제 운영 환경에서 안정적으로 배포·복구·추적 가능한 상태를 만든다.

## 환경

```text
Local
Development
Staging
Production
```

## CI/CD

```text
install
→ format check
→ lint
→ typecheck
→ unit/component test
→ API integration test
→ build
→ E2E smoke
→ deploy
```

## 배포 항목

- Web 배포
- API 배포
- PostgreSQL
- migration 자동화
- 환경변수 관리
- HTTPS
- custom domain
- SPA fallback
- CORS
- Production MSW 비활성화

## 운영

- 프런트 오류 수집
- API 구조화 로그
- request ID
- 오류율과 지연시간
- 배포 버전 표시
- health check
- 사용자 문제 신고
- DB 자동 백업
- 복원 절차
- migration rollback 또는 forward-fix 절차
- 장애 대응 문서

## 분석 이벤트

최소 이벤트:

```text
sign_up
login
practice_configured
study_started
question_answered
study_submitted
wrong_note_opened
review_started
review_submitted
bookmark_created
question_reported
```

정답 원문이나 사용자 메모처럼 불필요한 학습 내용을 외부 분석 도구에 전송하지 않는다.

## 법적·운영 문서

- 이용약관
- 개인정보 처리방침
- 저작권 안내
- 계정 삭제 방법
- 데이터 내보내기 방법
- 문제 신고 방법
- 문의 방법

## 완료 조건

- [ ] Staging과 Production 분리
- [ ] CI 품질 게이트 통과 후 배포
- [ ] 배포 실패 시 복구 가능
- [ ] migration 절차 문서화
- [ ] 자동 백업과 복원 점검
- [ ] 오류 위치 추적 가능
- [ ] Production MSW 비활성화
- [ ] 배포 후 smoke test 통과

---

# 18. Phase 12 — Public Beta 검증 및 v1.0 정리

## 목표

실제 사용자가 전체 흐름을 사용하도록 하고 치명적인 문제를 제거한 뒤 v1.0으로 고정한다.

## Beta 시나리오

테스터가 다음을 직접 수행한다.

- 가입
- 목표 급수 설정
- 첫 문제풀이
- 결과 확인
- 오답 재풀이
- 다음 날 복습
- 즐겨찾기
- 문제 신고
- 모바일 사용
- 언어 전환

## 수집할 피드백

- 어디서 흐름을 잃는가
- 난이도가 급수에 맞는가
- 해설이 이해되는가
- 문제 반복이 지나친가
- 복습 일정이 유용한가
- 모바일 독해가 불편한가
- 오답 상태가 이해되는가
- 오류·로딩·저장 실패가 있는가

## 버그 우선순위

- P0: 데이터 손실, 보안, 정답 오류, 서비스 불가
- P1: 핵심 흐름 실패, 반복 재현 가능한 주요 UX 문제
- P2: 개선 사항, 비핵심 화면 문제

## v1.0 출시 조건

### 기능

- [ ] 핵심 버튼 미구현 0건
- [ ] 실제 인증·DB·API
- [ ] 문제풀이 전체 흐름
- [ ] 오답·복습
- [ ] 관리자 콘텐츠 운영
- [ ] 대시보드·추천

### 콘텐츠

- [ ] 공개 급수에 충분한 문제 확보
- [ ] 문제 검수 상태 존재
- [ ] 치명적 정답 오류 0건
- [ ] 신고 처리 가능

### 품질

- [ ] P0 버그 0건
- [ ] P1 버그 0건
- [ ] Critical 접근성 오류 0건
- [ ] 핵심 E2E 전체 통과
- [ ] Production 빌드 통과
- [ ] 백업·모니터링 활성화

### 문서

- [ ] README
- [ ] 아키텍처 다이어그램
- [ ] ERD
- [ ] API 계약
- [ ] 오답 상태 머신
- [ ] 테스트 전략
- [ ] 접근성 문서
- [ ] 성능 개선 기록
- [ ] 저작권 정책
- [ ] 배포·운영 문서

---

# 19. 병렬 Workstream

Phase를 순차적으로 진행하더라도 다음 작업은 병렬로 관리한다.

## 19.1 콘텐츠

Phase 2부터 문제 제작·검수·태그 설계를 시작한다. 기술 구현이 끝난 뒤 콘텐츠를 시작하지 않는다.

## 19.2 문서와 ADR

중요한 구조 변경은 코드만 남기지 않고 ADR을 작성한다.

## 19.3 품질

테스트를 마지막 Phase에 몰아서 작성하지 않는다. 각 Vertical Slice가 완성될 때 함께 추가한다.

## 19.4 접근성

접근성은 최종 장식 작업이 아니다. 문제 선택, Dialog, 결과 알림, 표, 폼 구현 시점부터 적용한다.

## 19.5 보안

인증과 실제 API 도입 시점부터 서버 권한, 입력 검증, 출력 최소화를 적용한다.

---

# 20. 우선순위 Backlog

## P0 — v1.0 전에 반드시 완료

- 실제 인증
- 실제 DB와 API
- 문제 버전 관리
- 서버 채점
- 세션 중복 제출 방지
- 오답·복습 엔진
- 콘텐츠 검수 체계
- 관리자 CMS
- 권한·보안
- 핵심 테스트
- 접근성
- 배포·백업·모니터링

## P1 — Public Beta 전후

- 대시보드 고도화
- 약점 추천
- 일본어 UI
- 문제 오류 신고
- 대량 Import
- 문제 품질 통계
- 다른 기기 이어풀기
- 데이터 내보내기

## P2 — v1.x

- 언어지식·독해 실전 모드
- 학습 목표와 연속 학습
- 복습 알림
- 더 정교한 추천
- PWA 일부 오프라인 지원
- 고급 콘텐츠 분석

## 현재 제외

- 청해
- AI 자동 해설
- AI 생성 문제 자동 공개
- 결제
- 커뮤니티
- 랭킹
- 네이티브 앱

---

# 21. Vertical Slice 우선순위

화면 수를 넓히는 방식보다 끝까지 연결되는 세로 흐름을 우선한다.

## Slice 1 — 실제 학습 저장

```text
실제 로그인
→ 실제 세션 생성
→ 문제 조회
→ 답안 저장
→ 서버 제출
→ 결과 저장
→ 오답 생성
→ 대시보드 반영
```

## Slice 2 — 콘텐츠 운영

```text
관리자 문제 생성
→ 검수
→ 공개
→ 사용자 출제
→ 문제 통계 생성
→ 수정 버전 생성
```

## Slice 3 — 반복 학습

```text
오답 발생
→ 복습 예정일 생성
→ 오늘의 복습
→ 재풀이
→ 상태 변경
→ ReviewEvent 저장
```

이 세 흐름이 완전히 연결되기 전에는 청해, AI, 결제 같은 범위로 확장하지 않는다.

---

# 22. Release Gate

## Stable Alpha

- 구조 감사 완료
- 규칙 위반 정리
- Mock 기반 핵심 흐름 안정
- 기본 테스트와 빌드 통과

## Internal Beta

- 실제 인증·DB·API
- 실제 세션·제출·결과
- 오답·복습
- N3·N2 중심 콘텐츠
- 본인이 매일 사용할 수 있음

## Public Beta

- 관리자 CMS
- 문제 검수·버전·신고
- 전 급수 기본 콘텐츠
- 대시보드와 추천
- Staging/Production 운영
- 외부 테스터 사용 가능

## v1.0

- 공개 범위와 콘텐츠가 일치
- P0/P1 치명 문제 없음
- 접근성·보안·테스트 게이트 통과
- 백업·모니터링·운영 문서
- 포트폴리오 문서 완성

---

# 23. 포트폴리오 최종 산출물

## 프로젝트 설명

```text
문제:
기존 문제풀이 방식은 사용자가 무엇을 반복해서 틀리는지
체계적으로 관리하기 어렵다.

해결:
급수·과목·유형·태그 단위로 오답을 기록하고,
복습 일정과 약점 추천을 제공하는 JLPT 학습 서비스를 구현했다.
```

## 기술적으로 설명할 핵심

- Mock API에서 실제 API로 교체 가능한 계층 구조
- TanStack Query와 Zustand 역할 분리
- Zod 기반 런타임 계약 검증
- 문제 버전 관리
- 정답 사전 노출 방지
- 세션 idempotency
- 오답 상태 머신과 복습 일정
- 관리자 검수 워크플로
- 접근 가능한 문제풀이 UI
- route 코드 스플리팅
- E2E와 API 통합 테스트
- 모니터링·백업·운영 체계

## 포트폴리오 페이지 구성

1. 프로젝트 배경
2. 사용자 문제
3. 서비스 목표
4. 핵심 사용자 흐름
5. 아키텍처
6. 데이터 모델
7. 가장 어려웠던 문제
8. 해결 방식
9. 접근성
10. 성능
11. 테스트
12. 운영
13. 실제 결과
14. 향후 개선

---

# 24. 진행 상태 체크리스트

## 현재

- [x] 간단한 Alpha 레벨 완성 — 코드와 실행 검증 기준
- [x] Phase 0 코드베이스 감사와 Vite 기준선 정리
- [ ] Phase 1A pnpm workspace 모노레포 전환
- [ ] Phase 1 프런트 구조 안정화
- [ ] Phase 2 도메인·API 계약
- [ ] Phase 3 실제 백엔드·DB·인증
- [ ] Phase 4 문제풀이 실서비스화
- [ ] Phase 5 오답·복습 엔진
- [ ] Phase 6 콘텐츠 파이프라인
- [ ] Phase 7 관리자 CMS
- [ ] Phase 8 통계·추천
- [ ] Phase 9 디자인·다국어·접근성
- [ ] Phase 10 테스트·보안·성능
- [ ] Phase 11 배포·운영
- [ ] Phase 12 Public Beta·v1.0

## 상태 갱신 규칙

각 Phase 종료 시 이 체크리스트와 `docs/roadmap-progress.md`를 갱신한다.

완료 표시는 다음 조건을 만족할 때만 한다.

- Acceptance Criteria 충족
- 관련 테스트 통과
- lint/typecheck/build 통과
- 남은 제한사항 명시
- 필요한 문서 갱신

---

# 25. 즉시 진행할 다음 Step

다음 작업은 **Phase 1A — pnpm workspace 기반 모노레포 구축 및 기존 Vite 앱 이동**이다.

Phase 1A에서는 기능 refactor와 backend 구현을 섞지 않는다. `docs/monorepo-readiness.md`의 이동 매핑, 실행 순서, Acceptance Criteria, rollback 기준을 그대로 따른다.

## Phase 1A 핵심 순서

1. Phase 0 기준선 commit과 clean working tree 확인
2. root workspace package와 `pnpm-workspace.yaml` 작성
3. 기존 Vite 앱을 `apps/web`으로 Git move
4. alias, MSW, Tailwind, Vitest, CI 경로 수정
5. frozen install과 전체 품질 gate 실행
6. 개발 서버와 핵심 흐름 smoke 확인
7. 하나의 독립 commit으로 기록하고 rollback commit 명시

---

# 26. 다음 요청에 사용할 Codex 프롬프트

아래 프롬프트를 다음 단계에서 Codex에 전달한다.

```text
저장소의 JLPT Drill Note 전체 로드맵, P0 Vite 기준선 보고서,
monorepo readiness 문서, 기존 규칙과 관련 SKILL.md를 먼저 읽어라.
이번에는 Phase 1A — pnpm workspace 기반 모노레포 구축과
기존 Vite 앱의 apps/web 이동만 수행해라.

중요:
- 전체 로드맵이나 backend Phase를 함께 구현하지 마라.
- Next.js, Prisma, 실제 API, database, auth를 추가하지 마라.
- 기존 Vite 앱 기능과 API/Query/Zustand/MSW 경계를 변경하지 마라.
- 파일 이동은 가능한 한 git mv로 수행해 history를 보존해라.
- 사용자 .env를 commit하지 말고 apps/web 위치로 안전하게 이동해라.
- root scripts와 CI가 workspace web package를 실행하도록 수정해라.
- 이동 전후 format, lint, typecheck, test, build를 실제 실행해라.
- docs/monorepo-readiness.md의 Acceptance Criteria를 모두 확인해라.

최종 보고:
1. 이동 매핑 결과
2. root와 apps/web package 구조
3. 환경변수와 MSW 처리
4. CI와 scripts 변경
5. format/lint/typecheck/test/build 결과
6. smoke 결과
7. rollback commit
8. 남은 낮은 우선순위 제한
```

---

# 27. 변경 기록

| 날짜       | 버전 | 내용                                            |
| ---------- | ---- | ----------------------------------------------- |
| 2026-08-10 | 1.0  | Alpha 이후부터 v1.0까지의 전체 로드맵 최초 작성 |
| 2026-08-11 | 1.1  | Phase 0 Vite 기준선 완료 및 Phase 1A 범위 확정  |
