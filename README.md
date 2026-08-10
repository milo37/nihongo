# JLPT Drill Note

JLPT N5부터 N1까지 문자·어휘, 문법, 독해 문제를 풀고, 틀린 문제를
자동으로 오답노트에 저장해 반복 학습하는 프런트엔드 포트폴리오
프로젝트입니다.

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
- ESLint, Prettier, pnpm

## 실행 방법

Node.js LTS 22 이상과 pnpm이 필요합니다.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

기본 개발 주소는 `http://localhost:5173`입니다.

프로덕션 번들을 로컬에서 확인하려면 다음 명령을 실행합니다.

```bash
pnpm build
pnpm preview
```

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
src/
├── api/                 # Axios, safe HTTP 함수, 도메인 endpoint와 Zod schema
├── app/                 # 라우트 도메인, Query Factory, 커스텀 훅, 페이지
│   ├── admin-question/
│   ├── bookmark/
│   ├── dashboard/
│   ├── home/
│   ├── login/
│   ├── practice/
│   └── wrong-note/
├── common/              # 재사용 UI, 키보드 훅, 도메인 타입
├── libs/                # QueryClient, 오류 이벤트, storage adapter
├── mocks/               # 자체 제작 seed, MSW handlers, Mock Repository
├── provider/            # Query, Router, 인증, 전역 API 오류 처리
├── store/               # auth/practice/ui Zustand slice
├── test/                # Vitest setup과 MSW test server
├── util/                # shuffle, 채점, 공개 변환, 오답 상태 머신
├── main.tsx
└── router.tsx
```

Vite 기본 `App.tsx`와 `App.css`는 사용하지 않습니다. 각 도메인의 페이지는
React lazy loading으로 분리되고, `src/router.tsx`에서 통합됩니다.

## 데이터 흐름

서버 상태는 다음 단방향 경계를 지킵니다.

```text
컴포넌트
  → 도메인 커스텀 훅
  → TanStack Query Factory
  → src/api/{domain}/{endpoint}
  → safeGet / safePost / safePut / safeDel
  → Axios
  → MSW handler
  → MockDatabase
```

컴포넌트는 Axios, `fetch`, Mock 데이터, `useQuery`, `useMutation`을 직접 사용하지
않습니다. API 응답의 `response.data`는 모든 endpoint에서 strict Zod schema로
검증합니다.

## API 계층

- `src/api/config.ts`: Axios client, timeout, interceptor, 오류 플래그,
  generic `safeFactory`
- `src/api/http.ts`: raw `get/post/put/del`과 검증된
  `safeGet/safePost/safePut/safeDel`
- `src/api/{domain}/{verbNoun}/schema.ts`: 요청·응답 Zod schema와 추론 타입
- `src/api/{domain}/{verbNoun}/index.ts`: 요청 검증과 안전 HTTP 함수 조합

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

상태 전이는 `src/util/wrongNote.ts`의 순수 함수로 구현하고 단위 테스트합니다.
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
2. 현재 `src/api/*/*/schema.ts` 계약과 동일한 JSON 응답을 서버에서 제공합니다.
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
