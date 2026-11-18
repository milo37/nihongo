# 행 단위 권한(RLS) 도입 검토 (#1016)

검토일: 2026-11-18. 출처: 2026-11-13 보안 점검 H-01("사용자 데이터 테이블에 per-user RLS가 없음").

## 결론

지금은 RLS를 도입하지 않습니다. 대신 앱 코드의 소유자 조건을 테스트로 지키는 쪽을 유지·보강합니다. 이유는 아래 "효과"와 "비용"입니다. 다시 검토할 조건은 맨 아래에 적었습니다.

## 지금 구조

- API는 DB 역할 하나(`nihongo_app`)로, Prisma 연결 풀(`@prisma/adapter-pg`)을 통해 모든 요청을 처리합니다. 요청마다 DB 역할이 바뀌지 않습니다.
- RLS가 켜진 표는 `_prisma_migrations` 하나입니다(migration 원장 보호용).
- 회원·비회원 데이터 표는 소유자 칸으로 구분됩니다.
  - 직접: `StudySession`·`IdempotencyRecord`(`userId` 또는 `guestPrincipalId`), `Bookmark`, `WrongNote`, `ReviewEvent`, `UserStudyGoal`, `UserSignIn`, `UserConsent`, `Session`, `Account` 등(`userId`), `UserReport`·`QuestionReport`(`reporterUserId`).
  - 간접: `StudyDraft`·`StudyAnswer`는 `StudySession`을 통해, `UserMemo`는 `WrongNote`를 통해 소유자가 정해집니다.
- 소유자 확인은 repository 쿼리의 소유자 조건(`userId = 현재 회원` 또는 guest principal)으로 합니다. 보안 점검에서 SQL 삽입과 소유자 조건이 빠진 쿼리는 발견되지 않았습니다.
- 권한이 중요한 표(계정·세션·관리자 권한·탈퇴 요청)는 이미 열 단위 GRANT와 트리거(`validate_user_change`, `validate_session_write` 등)로 DB가 직접 막습니다.

## RLS를 켜면 막을 수 있는 것과 없는 것

RLS를 이 구조에 넣는 일반적인 방법은 요청마다 트랜잭션 안에서 `SET LOCAL app.user_id = …`를 하고, 정책이 그 값과 소유자 칸을 비교하는 것입니다.

- 막을 수 있는 것: 앞으로 누군가 소유자 조건을 빠뜨린 쿼리를 새로 쓰는 실수.
- 막을 수 없는 것: 보안 점검이 RLS가 필요한 전제로 든 나머지 셋.
  - SQL 삽입, 앱 DB 계정 탈취, 서버 코드 실행: 공격자가 `nihongo_app`으로 임의의 SQL을 실행할 수 있으면 `set_config('app.user_id', …)`로 그 값을 직접 바꿀 수 있습니다. 같은 역할을 쓰는 한 RLS는 이 경우의 방어선이 되지 못합니다.
- 즉 실제 효과는 "소유자 조건 누락" 한 가지이고, 이는 테스트로도 잡을 수 있습니다.

## 비용

- 모든 사용자 데이터 쿼리를 트랜잭션으로 감싸고 요청 회원을 넣어야 합니다. 지금 트랜잭션 없이 도는 읽기 쿼리가 많아 API 전반을 고쳐야 하고, 요청마다 왕복이 늘어납니다.
- 비회원(guest principal), 탈퇴 작업자, 만료 정리 명령, 관리자 화면처럼 여러 회원의 행을 다루는 경로는 정책 예외나 별도 DB 역할이 필요합니다. 별도 역할은 권한 확대 검토 대상입니다.
- 간접 소유 표(`StudyDraft`, `StudyAnswer`, `UserMemo`)는 정책에 조인이 들어가 느려지고 복잡해집니다.
- 새 migration이 많이 필요하고(표마다 정책), 기존 표의 권한 변경이라 운영자 승인과 복구 계획이 필요합니다.

## 대신 할 것 (제안)

1. 사용자 입력은 지금처럼 항상 쿼리 매개변수로만 넘기고 SQL 문자열에 이어 붙이지 않습니다(유지).
2. 소유자 조건 회귀 테스트를 유지합니다. 새 사용자 데이터 표나 API를 만들 때는 "다른 회원·비회원의 행은 읽기·쓰기 모두 안 된다"는 통합 테스트를 같이 넣습니다(검토 기준으로 삼기).
3. 앱 DB 계정이 schema에 객체를 만들 수 없게 한 지금 설정(`provision-db.sh`)과 열 단위 GRANT를 유지합니다. SECURITY DEFINER 함수의 `search_path` 고정은 #1013에서 따로 처리합니다.

## 다시 검토할 때

- 회원끼리 데이터를 공유하는 기능(공유 단어장, 친구 등)이 생겨 소유 규칙이 복잡해질 때.
- 관리자·작업자용 DB 역할을 앱 역할과 나누는 작업을 할 때(그때 RLS를 함께 넣는 비용이 가장 낮습니다).
- 소유자 조건 누락이 실제로 발견될 때.
