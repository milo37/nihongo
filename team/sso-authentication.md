# SSO 전용 인증 전환 — 현재 기준

2026-10-19 사용자 정정 및 god sso04b/sso04w에 따라 가입·재로그인은 SSO 전용입니다. 자체 이메일 가입·암호 로그인·메일 소유 인증·암호 찾기/재설정/변경 및 관리자 암호 재인증 규칙은 superseded 이력으로 보존합니다. Google 1차는 기존 기획의 구현 기준이며 사용자 지정 공급자를 뜻하지 않습니다.

## 이번 체크포인트와 남은 구현

첫 BE 체크포인트는 `ssoProtocol`, Google 검증 포트, 보호된 DB 임시 상태 저장 함수와 집계 진단입니다. **서버는 이 기반에 아직 연결되지 않았고 기존 암호 경로도 아직 제거되지 않았습니다.** SSO 로그인 구현 완료나 실제 Google/DB 검증 PASS를 뜻하지 않습니다.

후속 BE는 public gateway/server/env 연결, 공급자 계정 해석·신규 회원·PHASE7_V1 세션 발급/확인/실패 보상, 기존 회원 명시 연결, 관리자 fresh SSO 재인증, 암호 경로 제거·전진 정리를 이어갑니다. FE는 확정 transport로 화면·Query/MSW를 전환합니다. 최종 공개 전 암호 endpoint와 관리자 암호 fallback을 닫아야 합니다.

## 회원·데이터·권한

- 로그인 키는 기존 `Account(providerId, accountId)` 복합 유일성입니다. accountId는 서명 검증된 Google sub이고 이메일은 연락 정보입니다. 공급자 프로필의 role은 무시합니다.
- 내부 User.id, 서버 role/accountStatus/authorityGeneration, 학습·오답·복습·책갈피 FK와 기존 자료를 보존합니다. 신규 회원은 서버에서 USER로 생성하고 삭제/중지 회원은 로그인할 수 없습니다.
- 이메일이 같은 미연결 계정을 자동 연결하거나 덮어쓰지 않습니다. 기존 확인된 서버 세션과 새 공급자 증명으로 명시 연결하거나, 검증된 운영자 이전을 사용해야 합니다. 증명이 없는 과거 계정은 데이터와 함께 보존하며 접근 복구를 별도로 해결합니다.
- 유일한 SSO 연결 해제는 접근 불능을 만들므로 차단합니다. 로그아웃은 서버 세션 종료이며 연결 해제·탈퇴와 구분합니다. 탈퇴와 관리자 민감 명령은 현재 사용자/세션에 묶인 fresh SSO 증명과 기존 서버 role 검사를 요구합니다. 로그인으로 권한을 자동 승격하지 않습니다.
- credential-totality 제약과 관리자 password SQL은 후속 전진 migration에서 함께 전환해야 합니다. 기존 불변 migration을 수정하거나 제약을 우회하지 않습니다.

## 콜백 보안 기반

상태·브라우저 바인딩은 각 32바이트 난수이고 DB에는 digest만 저장합니다. nonce 32바이트·PKCE verifier 64바이트를 사용합니다. 고정 Google HTTPS authorization endpoint와 정확한 state/nonce/S256 challenge만 허용합니다. 기존 better-auth 1.6.28 공급자를 사용하며, 해당 버전의 getUserInfo가 JWT를 decode하므로 verifyIdToken(idToken, nonce)을 먼저 호출해 서명·issuer·audience·만료/최대 수명·nonce를 검증합니다. 브라우저 직접 ID-token 로그인은 제공하지 않습니다.

SsoLoginTransaction은 TTL 10분, 단회 DELETE RETURNING 소비입니다. 잘못된 브라우저 바인딩은 정상 상태를 소비하지 않습니다. 실제 DB 동시성/ACL은 격리 TEST 검사가 남아 있습니다. 새 로그인은 만료된 임시 행만 정리합니다. 두 로그인 탭은 하나의 쿠키를 공유하므로 최근 시작만 완료할 수 있고 이전 탭은 안전하게 재시작합니다.

바인딩 쿠키는 host-only·HttpOnly·SameSite=Lax, 운영은 \_\_Host-/Secure입니다. 콜백 결과에서 쿠키를 만료시켜야 합니다. code/state/provider 오류를 SPA·storage·Zustand·로그로 전달하지 않습니다. IDENTITY_VERIFIED는 공급자 증명 결과이며 제품 로그인 성공이 아닙니다. 호출자는 내부 회원 확인과 기존 세션 발급·확인·실패 보상 뒤에만 세션과 성공 복귀를 허용합니다.

## FE transport 논의안 — shared 합의 전

- 시작 POST /api/auth/sign-in/social: provider=google 및 선택 callbackURL 상대 업무 경로 → 승인된 url, redirect=true. 미설정/일시 장애는 503 SSO_UNAVAILABLE 제안입니다. Origin/JSON/체적/속도 제한을 유지합니다.
- 고정 GET /api/auth/callback/google: 상태 검증 후 서버 HttpOnly 세션과 trusted SPA redirect. 취소·실패는 CANCELLED/FAILED/INVALID_CALLBACK 유한 결과로 번역하고 안전한 로그인 오류 상태와 원래 업무 경로를 보존합니다. 실제 오류 query/공유 schema는 FE와 합의 후 확정합니다.
- /api/v1/me와 정상 POST /api/auth/sign-out의 canonical 권위를 유지합니다. 최종 전환에서 암호·메일 인증 endpoint는 404로 닫습니다. 같은 내부 회원 복원·다른 회원 격리 검사를 재사용합니다.
- 복귀는 현재 업무 route와 허용 필터 query만 보존합니다. 외부·//·역슬래시·제어문자·fragment·encoded path·인증 자기복귀·중복 query는 /로 바꿉니다. 현재 필터는 level/subject/type/status/tagId/difficulty/mode/page/pageSize/sort/search이며 FE가 실제 사용 항목을 대조한 뒤 확정합니다.

## 안전한 DB 전환·계수

첫 migration은 임시 테이블과 소유 함수만 추가합니다. User/Account/Verification·세션·학습 데이터를 갱신/삭제하지 않습니다. application/auth gateway/erasure 역할에 임시 테이블의 직접 접근을 금지하고 auth gateway에 두 소유 함수 실행만 부여합니다. 기존 canonical migration principal·owner·search_path 경계를 유지합니다.

readSsoDataImpact는 제공된 client로 집계 SELECT만 실행하며 스스로 환경·접속·migration을 실행하지 않습니다. 명시된 읽기 진단 연결에서 회원/연락 이메일/암호 값/credential/provider 계정/미연결 회원·관리자/Verification/세션·학습·오답·책갈피 수를 계수해야 합니다. 실제 수는 아직 측정하지 않았으며 0으로 가정하지 않습니다. 운영 DB는 이번 체크포인트의 실행 대상이 아닙니다.

집계·보존 기준 확인 → 새 identity/세션/fresh-assurance 기반 연결 → 기존 회원의 증명된 명시 매핑 → SSO-only 공개 경로 전환 → 미연결·참조·세션 영향 재계수 → 불필요한 자체 credential/token/field 전진 정리 순서입니다. 연락 email/emailVerified와 OAuth 상태용 Verification을 암호 전용으로 보고 일괄 삭제하지 않습니다. 이번 migration은 계정 변환 자체를 실행하지 않습니다.

## 나중에 필요한 외부 입력

Google OAuth Web client ID와 client secret, 정확한 API/SPA origin이 필요합니다. secret은 브라우저 환경에 넣지 않습니다. 등록 redirect는 정확히 `<BETTER_AUTH_URL>/api/auth/callback/google`이며 개발 예시는 `http://localhost:3001/api/auth/callback/google`입니다. 운영 origin은 미제공이므로 임의 지정하지 않습니다. 외부 앱 등록·실제 Google 로그인·배포는 실행하지 않습니다.

참고: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [Better Auth 계정 연결](https://better-auth.com/docs/concepts/users-accounts). 최신 문서와 설치된 1.6.28 소스 동작을 구분했습니다.
