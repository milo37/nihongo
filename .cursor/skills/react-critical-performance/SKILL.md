---
name: react-critical-performance
description: Vite와 React Router 기반 React 애플리케이션의 핵심 성능을 검토하고 개선합니다. 비동기 waterfall, route code splitting, bundle 크기, payload, 검색 자료구조, 저장소 접근을 최적화할 때 사용합니다.
---

# React Critical Performance for Vite

이 스킬의 애플리케이션 범위는 workspace의 `apps/web`입니다.

## 기본 원칙

측정 가능한 병목과 구조적 비용을 먼저 해결합니다. React Compiler가 활성화되어 있으므로 단순한 렌더 최적화를 위해 `memo`, `useMemo`, `useCallback`을 습관적으로 추가하지 않습니다.

이 프로젝트에서는 Next.js 전용 API를 사용하지 않습니다.

- `next/dynamic`, Server Components, Server Actions
- Next API Route, Route Handler, `React.cache`
- `next/server`의 `after`, Next 설정 기반 import 최적화

## 비동기 waterfall 제거

필요하지 않은 작업은 조건 분기 뒤로 미루고, 서로 독립적인 작업은 동시에 시작합니다.

```ts
const [profile, statistics] = await Promise.all([getProfile(), getStatistics()])
```

다음 기준을 적용합니다.

- 결과가 이미 결정된 분기는 early return
- 독립 요청은 `Promise.all` 또는 병렬 Query
- 실제 의존 Query만 `enabled`로 순차 실행
- 하나의 값을 찾기 위해 전체 배열을 정렬하지 않음

## Route와 모듈 code splitting

도메인 route와 초기 화면에 필요하지 않은 큰 모듈은 `React.lazy` 또는 동적 `import()`로 분리합니다.

```tsx
import { lazy } from 'react'

const AdminQuestionPage = lazy(() => import('@app/admin-question/page'))
```

- 각 도메인 route module은 lazy loading
- 관리자 화면과 차트는 초기 bundle에서 분리
- lazy fallback은 실제 콘텐츠와 유사한 크기의 Skeleton 제공
- hover 또는 focus preload는 체감 지연이 큰 기능에만 적용
- 작은 모듈을 과도하게 나누지 않음

## Import와 번들

- broad barrel file을 만들지 않습니다.
- 도메인 훅과 컴포넌트는 실제 파일 경로에서 직접 import합니다.
- 아이콘 라이브러리는 공식 세부 경로가 안정적으로 지원될 때 필요한 아이콘만 import합니다.
- 비공개 package 내부 경로는 사용하지 않습니다.
- bundle 분석 없이 의존성을 무작정 교체하지 않습니다.

## 배열과 검색

- 반복 `find`는 Map index를 고려합니다.
- 반복 `includes`는 Set을 고려합니다.
- props와 state 배열에 mutating `sort`를 사용하지 않습니다.
- 최소값이나 최대값 하나는 단일 순회로 찾습니다.
- Fisher-Yates 또는 seed shuffle을 사용하고 원본 배열을 변경하지 않습니다.
- hot path 최적화가 가독성을 크게 해치면 측정 근거를 먼저 확보합니다.

## 네트워크 payload

- 문제풀이 시작 전 정답, 해설, 관리자 필드를 전달하지 않습니다.
- 관리자 목록과 상세 응답을 분리합니다.
- 대시보드는 집계 결과만 반환합니다.
- 불필요한 직렬화와 중복 요청은 Query cache로 제거합니다.

## 저장소와 이벤트

- localStorage를 렌더마다 직접 읽지 않습니다.
- 공통 storage adapter 또는 Zustand persist로 초기 한 번 복구합니다.
- 동일한 전역 keydown listener를 여러 컴포넌트에 중복 등록하지 않습니다.
- 최신 callback이 필요하면 안전한 latest-ref 패턴을 사용합니다.
- 외부 탭 storage 변경은 필요한 데이터만 동기화합니다.

## 렌더링 비용

- 긴 목록은 pagination 또는 `content-visibility: auto`를 고려합니다.
- 큰 차트는 lazy loading하고 텍스트 대체 정보를 제공합니다.
- `0 && element`처럼 숫자가 노출될 수 있는 조건식을 피합니다.
- 정적 SVG 정밀도를 합리적으로 줄이고 애니메이션은 wrapper에 적용합니다.
- `prefers-reduced-motion`을 존중합니다.

## 완료 체크리스트

- [ ] 독립 요청이 병렬 실행됨
- [ ] route와 관리자·차트가 필요에 맞게 분할됨
- [ ] broad barrel과 불안정한 내부 import가 없음
- [ ] payload에 화면에서 쓰지 않는 데이터가 없음
- [ ] 배열 검색과 정렬이 원본 변경 없이 수행됨
- [ ] storage와 전역 listener를 반복 등록하지 않음
- [ ] React Compiler와 중복되는 수동 memoization이 없음
- [ ] 로딩 UI가 layout shift를 과도하게 만들지 않음
