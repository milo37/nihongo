---
name: react-render-optimization
description: Vite React 애플리케이션에서 상태 구독, effect, 목록, storage, 전역 이벤트의 렌더 비용을 안전하게 줄입니다. React Compiler를 존중하며 실제 렌더 병목을 검토할 때 사용합니다.
---

# React Render Optimization for Vite

## React Compiler 우선

이 프로젝트는 React Compiler를 사용합니다. 단순 props 전달이나 JSX 계산을 이유로 `memo`, `useMemo`, `useCallback`을 무조건 추가하지 않습니다. 다음 경우에만 수동 최적화를 고려합니다.

- profiler로 확인된 비싼 계산
- 외부 라이브러리가 안정적인 참조를 요구하는 경우
- effect 또는 subscription 계약상 참조 안정성이 필요한 경우

## 상태 구독 범위

렌더에 필요한 최소 상태만 구독합니다.

```tsx
const isMenuOpen = useAppStore((state) => state.isMenuOpen)
```

- 연속 숫자 전체가 아니라 필요한 derived boolean을 구독합니다.
- 렌더에 쓰지 않는 최신 값은 이벤트 callback 시점에 읽습니다.
- TanStack Query 데이터를 Zustand에 복제하지 않습니다.
- 비싼 초기값은 lazy `useState` initializer를 사용합니다.

## 이전 상태 기반 업데이트

현재 상태를 기반으로 변경할 때는 functional update를 사용합니다.

```tsx
setItems((current) => [...current, newItem])
```

이는 stale closure를 방지하기 위한 정확성 규칙입니다. 안정적인 callback을 만들기 위한 수동 memoization은 별도로 필요성을 판단합니다.

## Effect 설계

- effect dependency는 실제로 사용하는 primitive로 좁힙니다.
- 렌더 중 계산 가능한 derived state를 effect와 state로 복제하지 않습니다.
- 구독과 event listener는 cleanup을 반환합니다.
- 개발 환경 Strict Mode의 재실행에도 안전하도록 작성합니다.
- 입력과 textarea에 focus된 동안 문제풀이 단축키를 비활성화합니다.

## 전역 이벤트

문제풀이 키보드 처리는 세션 화면에서 하나의 keydown listener만 등록합니다. 동일 목적 listener를 보기 컴포넌트마다 만들지 않습니다. callback 최신성이 필요하면 latest-ref 패턴을 사용하되 listener 자체는 불필요하게 재등록하지 않습니다.

## Storage 복구

Vite CSR 앱에서는 SSR hydration script를 사용하지 않습니다.

- localStorage 접근은 `@libs/storage` adapter 또는 Zustand persist에 둡니다.
- 초기화 시 한 번 읽고 메모리 상태를 사용합니다.
- 렌더 중 `localStorage.getItem`을 반복하지 않습니다.
- 저장 실패와 손상된 JSON은 안전한 기본값으로 복구합니다.
- 직렬화 가능한 Record와 배열만 저장합니다.

## 목록과 조건부 렌더링

- 수십 건 이상의 목록은 pagination을 우선합니다.
- 긴 카드 목록에는 `content-visibility: auto`를 고려합니다.
- 숫자 조건은 `count > 0 ? ... : null`처럼 명시합니다.
- props 또는 state 배열에 mutating `sort`를 사용하지 않습니다.
- Map과 Set은 반복 검색 비용이 실제로 있는 곳에만 사용합니다.

## CSS와 애니메이션

- DOM style 속성을 반복 변경하지 않고 className 또는 data attribute를 사용합니다.
- SVG animation은 wrapper element에 적용합니다.
- `prefers-reduced-motion` 사용자의 동작을 존중합니다.
- loading Skeleton은 실제 콘텐츠 크기와 비슷하게 유지합니다.

## 접근성 보존

성능 최적화가 접근성을 훼손하면 적용하지 않습니다.

- 숨겨진 콘텐츠의 focus 가능 요소를 방치하지 않습니다.
- 가상화 또는 pagination 후에도 heading과 table 의미를 보존합니다.
- 비동기 상태는 스크린리더 텍스트와 `aria-live`로 전달합니다.
- focus-visible을 제거하지 않습니다.

## 완료 체크리스트

- [ ] React Compiler와 수동 memoization이 중복되지 않음
- [ ] Zustand selector가 필요한 상태만 구독함
- [ ] 이전 상태 변경에 functional update를 사용함
- [ ] effect와 listener가 cleanup되고 중복 등록되지 않음
- [ ] localStorage를 렌더마다 읽지 않음
- [ ] 긴 목록 렌더 비용을 제어함
- [ ] 조건부 숫자 렌더와 mutating sort가 없음
- [ ] 최적화 후 키보드와 스크린리더 동작이 유지됨
