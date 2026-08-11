---
name: react-server-data
description: Vite React 애플리케이션에서 TanStack Query, Axios, Zod, MSW를 사용해 서버 상태 경계와 데이터 흐름을 설계하고 검토합니다. Query Factory, 도메인 훅, 캐시 무효화, Mock API, payload 최소화가 필요한 작업에 사용합니다.
---

# React Server State for Vite

이 문서의 `src/` 경로는 workspace의 `apps/web/src/`를 뜻합니다.

## 적용 범위

이 저장소는 클라이언트 Vite 애플리케이션입니다. 서버 상태는 다음 경계를 지킵니다.

```text
MSW handler
→ src/api endpoint
→ Query Factory
→ domain hook
→ component
```

다음 패턴은 사용하지 않습니다.

- Next.js, React Server Components, Server Actions, Route Handlers
- React.cache, next/dynamic, next/server의 after
- Prisma, SQLite, 실제 백엔드 코드
- SWR 또는 컴포넌트의 직접 fetch/Axios 호출
- API 응답을 Zustand에 복제하는 구조

## API 경계

- `src/api/config.ts`는 Axios client, interceptor, error flags, generic `safeFactory`만 소유합니다.
- `config.ts`는 `http.ts`를 import하지 않습니다.
- `src/api/http.ts`는 `config.ts`를 import하고 `response.data`를 반환합니다.
- 모든 endpoint는 request와 response Zod schema를 가집니다.
- `safeGet`, `safePost`, `safePut`, `safeDel`은 raw response data를 검증합니다.
- 검증 실패는 status 422와 `isValidationError`를 가진 오류로 전달합니다.
- 날짜는 ISO 8601 문자열로 전송합니다.

## Query Factory와 도메인 훅

Query key는 도메인별 factory에서 생성합니다.

```ts
export const questionQueries = {
  allKey: () => ['question'],
  detail: (id: string) => [...questionQueries.allKey(), 'get-question', id],
  list: (params: QuestionListParams) => [
    ...questionQueries.allKey(),
    'list-questions',
    params
  ]
} as const
```

컴포넌트는 Query Factory나 Query primitive를 직접 사용하지 않습니다. 도메인 훅만 `useQuery`, `useMutation`, `useQueries`, `useQueryClient`를 사용할 수 있습니다.

Mutation 후에는 의미에 맞게 캐시를 갱신합니다.

- 생성: 관련 목록 invalidate
- 수정: detail과 list invalidate
- 삭제: detail remove, list invalidate
- 학습 제출: result, session, wrong-note, dashboard invalidate
- 독립적인 invalidate 또는 요청은 `Promise.all`로 병렬 처리

## Waterfall 방지

독립 데이터는 동시에 요청합니다. 의존 관계가 있는 Query만 `enabled`로 연결합니다. 조건에 따라 필요하지 않은 요청은 만들지 않고 early return 또는 `enabled: false`를 사용합니다.

## Payload 안전성

- 문제풀이 시작 응답에는 정답 ID, `isCorrect`, 해설, 관리자 상태를 포함하지 않습니다.
- 정답과 해설은 제출 결과에서만 제공합니다.
- 관리자 목록은 목록에 필요한 요약 필드만 반환합니다.
- 대시보드는 화면에 필요한 집계만 반환합니다.
- 반복 ID 조회가 필요한 Mock repository는 Map 또는 Set index를 사용합니다.

## MSW와 저장소

- Mock 데이터는 `src/mocks` 안에서만 관리합니다.
- MSW handler만 Mock repository에 접근합니다.
- 개발 환경은 Mock을 기본 활성화합니다.
- 일반 production은 Mock을 비활성화하고, 데모 빌드만 `VITE_ENABLE_MOCKS=true`로 활성화합니다.
- localStorage는 공통 adapter 또는 Zustand persist 초기화 시 한 번 읽고 메모리 상태를 사용합니다.
- mutation은 메모리와 저장소를 함께 갱신합니다.

## 오류 처리

Axios interceptor는 오류 플래그만 설정합니다. QueryCache와 MutationCache는 공통 error bus로 오류를 전달하고, `AuthErrorHandlerProvider`가 `unknown` 오류를 타입 가드로 좁혀 UI와 이동을 처리합니다. 컴포넌트별 `alert` 또는 중복 오류 처리는 금지합니다.

## 완료 체크리스트

- [ ] config와 http 사이에 순환 import가 없음
- [ ] 모든 endpoint 응답이 Zod 검증됨
- [ ] 컴포넌트가 API와 Query primitive를 직접 사용하지 않음
- [ ] Query 데이터를 Zustand에 복제하지 않음
- [ ] mutation 후 관련 캐시가 갱신됨
- [ ] 독립 요청이 불필요하게 직렬 실행되지 않음
- [ ] 제출 전 정답과 해설이 노출되지 않음
- [ ] Query와 Mutation 오류가 모두 중앙 처리됨
- [ ] Mock 데이터가 `src/mocks` 밖으로 누출되지 않음
