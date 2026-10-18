# SSO 전용 인증 전환 — 현재 기준

2026-10-19 사용자 정정 및 god sso04b/sso04w에 따라 가입·재로그인은 SSO 전용입니다. 자체 이메일 가입·암호 로그인·메일 소유 인증·암호 찾기/재설정/변경 및 관리자 암호 재인증 규칙은 superseded 이력으로 보존합니다. 최신 사용자 확정 공급자는 Apple(Sign in with Apple)과 Google뿐입니다. 이전 Google 1차 기획 기준은 이 결정으로 대체됐습니다. Kakao/Naver/자체 암호 fallback은 추가하지 않습니다.

## 이번 체크포인트와 남은 구현

현재 로컬 체크포인트는 technical TEST/development 모드의 public start/callback, Apple·Google env schema/process mapping, provider/sub→stable User 해석, PHASE7_V1 발급·확인·실패 보상까지 연결합니다. FE 화면은 `269fbeaad334f19b83626fa33e8c9b864ad82b36`에 고정했습니다. 공개 이메일 가입·암호 로그인·reset/verify/change 경로는 gateway allowlist에서 404로 닫고 일반 Better Auth email/password를 비활성화했습니다.

**SSO 전용 제품 전환은 미완료이며 배포 후보가 아닙니다.** 기존 관리자 password reauthentication과 fresh-operation guard/service/route, mail startup 요건은 대체 fresh SSO 보호 검증 전까지 보존합니다. god admin-fresh-sso-order에 따라 동일 내부 ADMIN·현재 세션·generation·provider-bound fresh SSO를 먼저 완성한 뒤 기존 관리자 암호 경로와 mail wiring을 종료합니다. LINK/UNLINK/탈퇴/capabilities·목적별 결과 계약은 FE 합의 요구사항이 있으며 아직 제공하지 않습니다. 다른 SSO 로그인이나 이메일 일치로 현재 회원의 fresh 권한을 만들지 않습니다.

로컬 API SSO unit 70개, API type/build, Web type/build·architecture, scoped lint/format과 Prisma schema validation을 확인했습니다. 이 결과는 DB SQL 실행·동시성/ACL·실제 Apple/Google·전체 auth 회귀·독립 최종 QA/실화면 승인과 구분합니다. production의 기존 mode 제한·TLS·역할·원래 checkout/5173도 그대로입니다.

## 회원·데이터·권한

- 로그인 키는 기존 `Account(providerId, accountId)` 복합 유일성입니다. accountId는 선택한 공급자의 서명 검증된 sub이고 이메일은 연락 정보입니다. 공급자 프로필의 role은 무시합니다.
- 내부 User.id, 서버 role/accountStatus/authorityGeneration, 학습·오답·복습·책갈피 FK와 기존 자료를 보존합니다. 신규 회원은 서버에서 USER로 생성하고 삭제/중지 회원은 로그인할 수 없습니다.
- 이메일이 같은 미연결 계정을 자동 연결하거나 덮어쓰지 않습니다. 기존 확인된 서버 세션과 새 공급자 증명으로 명시 연결하거나, 검증된 운영자 이전을 사용해야 합니다. 증명이 없는 과거 계정은 데이터와 함께 보존하며 접근 복구를 별도로 해결합니다.
- 유일한 SSO 연결 해제는 접근 불능을 만들므로 차단합니다. 로그아웃은 서버 세션 종료이며 연결 해제·탈퇴와 구분합니다. 탈퇴와 관리자 민감 명령은 현재 사용자/세션에 묶인 fresh SSO 증명과 기존 서버 role 검사를 요구합니다. 로그인으로 권한을 자동 승격하지 않습니다.
- 새 `20261019100000_sso_identity_mapping`은 legacy credential을 보존하면서 신규 SSO 회원을 허용하고, 마지막 SSO 삭제를 별도 검사합니다. 같은 User의 deferred 검사를 잠금으로 직렬화하며 실제 동시성·ERASURE 검사는 격리 TEST에서 남아 있습니다. 관리자 password SQL 전환은 아직 남아 있습니다. 기존 불변 migration을 수정하거나 제약을 우회하지 않습니다.

## 콜백 보안 기반

상태·브라우저 바인딩은 각 32바이트 난수이고 DB에는 digest만 저장합니다. nonce 32바이트·PKCE verifier 64바이트를 사용합니다. 고정 Google HTTPS authorization endpoint와 정확한 state/nonce/S256 challenge만 허용합니다. 기존 better-auth 1.6.28 공급자를 사용하며, 해당 버전의 getUserInfo가 JWT를 decode하므로 verifyIdToken(idToken, nonce)을 먼저 호출해 서명·issuer·audience·만료/최대 수명·nonce를 검증합니다. 브라우저 직접 ID-token 로그인은 제공하지 않습니다.

SsoLoginTransaction은 TTL 10분, 단회 DELETE RETURNING 소비입니다. 잘못된 브라우저 바인딩은 정상 상태를 소비하지 않습니다. 실제 DB 동시성/ACL은 격리 TEST 검사가 남아 있습니다. 새 로그인은 만료된 임시 행만 정리합니다. 두 로그인 탭은 하나의 쿠키를 공유하므로 최근 시작만 완료할 수 있고 이전 탭은 안전하게 재시작합니다.

바인딩 쿠키는 host-only·HttpOnly·SameSite=Lax, 운영은 \_\_Host-/Secure입니다. 콜백 결과에서 쿠키를 만료시켜야 합니다. code/state/provider 오류를 SPA·storage·Zustand·로그로 전달하지 않습니다. IDENTITY_VERIFIED는 공급자 증명 결과이며 제품 로그인 성공이 아닙니다. 호출자는 내부 회원 확인과 기존 세션 발급·확인·실패 보상 뒤에만 세션과 성공 복귀를 허용합니다.

## FE transport 합의 v1 — technical runtime 연결

- 시작 POST /api/auth/sign-in/social: provider=apple|google 및 선택 callbackURL 상대 업무 경로 → 선택 공급자에 대응하는 고정 HTTPS url, redirect=true. 미설정/일시 장애는 503 SSO_UNAVAILABLE입니다. Origin/JSON/체적/속도 제한을 유지합니다.
- 고정 GET /api/auth/callback/google: 상태 검증 후 서버 HttpOnly 세션과 trusted SPA redirect. 취소·실패는 CANCELLED/FAILED/INVALID_CALLBACK 유한 결과로 번역하고 안전한 로그인 오류 상태와 원래 업무 경로를 보존합니다. 공유 request/response와 이 유한 outcome은 FE55d1fc 합의로 packages/contracts/auth/sign-in-social에 제공합니다.
- /api/v1/me와 정상 POST /api/auth/sign-out의 canonical 권위를 유지합니다. gateway의 암호·메일 인증 endpoint는 404이며 별도 관리자 재인증 종료는 fresh SSO 대체 검증 뒤입니다. 같은 내부 회원 복원·다른 회원 격리 검사를 재사용합니다.
- 복귀는 현재 업무 route와 허용 필터 query만 보존합니다. 외부·//·역슬래시·제어문자·fragment·encoded path·인증 자기복귀·중복 query는 /로 바꿉니다. 허용18키는 level/subject/type/status/tagId/difficulty/mode/page/pageSize/sort/search/view/count/resumePage/questionType/tag/question/returnTo입니다. returnTo는 wrong-note 상세에서만 review 목록·legacy history를 받으며 공유 review query 의미로 /wrong-notes에 정규화합니다. 외부/인증/중복/중첩 returnTo는 callback 기본 /로 거부합니다. API와 FE가 같은 브라우저 안전 함수를 소비합니다.

## 안전한 DB 전환·계수

첫 migration은 임시 테이블과 소유 함수만 추가합니다. User/Account/Verification·세션·학습 데이터를 갱신/삭제하지 않습니다. application/auth gateway/erasure 역할에 임시 테이블의 직접 접근을 금지하고 auth gateway에 두 소유 함수 실행만 부여합니다. 기존 canonical migration principal·owner·search_path 경계를 유지합니다.

readSsoDataImpact는 제공된 client로 집계 SELECT만 실행하며 스스로 환경·접속·migration을 실행하지 않습니다. 명시된 읽기 진단 연결에서 회원/연락 이메일/암호 값/credential/provider 계정/미연결 회원·관리자/Verification/세션·학습·오답·책갈피 수를 계수해야 합니다. 실제 수는 아직 측정하지 않았으며 0으로 가정하지 않습니다. 운영 DB는 이번 체크포인트의 실행 대상이 아닙니다.

집계·보존 기준 확인 → 새 identity/세션/fresh-assurance 기반 연결 → 기존 회원의 증명된 명시 매핑 → SSO-only 공개 경로 전환 → 미연결·참조·세션 영향 재계수 → 불필요한 자체 credential/token/field 전진 정리 순서입니다. 연락 email/emailVerified와 OAuth 상태용 Verification을 암호 전용으로 보고 일괄 삭제하지 않습니다. 이번 migration은 계정 변환 자체를 실행하지 않습니다.

## 나중에 필요한 외부 입력

Google OAuth Web client ID/secret 및 Apple Services ID/client-secret JWT, 정확한 API/SPA origin이 필요합니다. secret은 브라우저 환경에 넣지 않습니다. 등록 redirect는 정확히 `<BETTER_AUTH_URL>/api/auth/callback/google`이며 개발 예시는 `http://localhost:3001/api/auth/callback/google`입니다. 운영 origin은 미제공이므로 임의 지정하지 않습니다. 외부 앱 등록·실제 Google 로그인·배포는 실행하지 않습니다.

참고: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [Better Auth 계정 연결](https://better-auth.com/docs/concepts/users-accounts). 최신 문서와 설치된 1.6.28 소스 동작을 구분했습니다.

## 최신 Apple·Google 공급자 차이

사용자 확정 두 공급자만 공유 enum/승인 URL에서 허용합니다. 상태는 provider와 함께 저장·소비하고, 콜백 route의 provider와 저장 상태·검증 identity가 같아야 합니다. 같은 email/sub 문자열이어도 provider가 다르면 같은 내부 회원이라고 간주하지 않습니다. 기존 ID/학습 FK의 실제 매핑/보존은 후속 서버 연결·DB 회귀가 남아 있습니다.

Google은 GET /api/auth/callback/google, Apple은 HTTPS POST form /api/auth/callback/apple입니다. Apple 승인 URL은 response_type=code, response_mode=form_post로 고정하고 front-channel id_token/user JSON을 회원 증명으로 사용하지 않습니다. 서버 code 교환에서 받은 ID token을 기존 Apple provider로 서명/issuer/audience/expiry/nonce 검증한 뒤에만 profile을 decode합니다. private relay email도 연락 정보일 뿐 연결 키가 아닙니다. Apple에는 원시 또는 SHA256 nonce를 확인하는 설치 라이브러리 검증을 사용합니다.

Apple cross-site form_post용 binding 쿠키는 개발 모드여도 \_\_Host-/Secure/SameSite=None입니다. Google은 Lax를 유지합니다. Apple callback은 HTTPS 도메인이 필요하며 localhost/IP는 거부합니다. 원래 Google-only migration은 보존하고 20261019093000 전진 migration으로 두 공급자 제약·provider-bound v2 함수를 추가하며 옛 함수 실행은 닫습니다. 실제 DB/HTTP form callback 연결은 아직 미실행입니다. PKCE 매개변수는 두 어댑터에 전달되지만 Apple 서버의 PKCE enforcement를 실제 검증했다고 주장하지 않습니다.

후속 환경 제안 이름은 GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET 및 APPLE_CLIENT_ID/APPLE_CLIENT_SECRET입니다. Apple secret JWT 발급에는 Team ID/Key ID/개인키가 필요할 수 있으며 운영자 비밀 전달로 처리합니다. 네 이름은 이제 env.ts schema/process mapping과 technical startup에 연결돼 있으며 각 ID/secret을 함께 설정해야 합니다. Apple은 HTTPS domain API origin을 요구하고 Google은 기존 HTTPS/loopback callback 정책을 사용합니다. 미설정된 선택 공급자는 공개503을 반환합니다. Apple secret은 운영자가 전달하는 signed client-secret JWT 문자열이며 이 저장소가 개인키 발급·외부 등록·rotation을 수행하지 않습니다. mail 요건 제거와 production 활성화는 아직 남아 있습니다. callback 등록은 실제 API origin의 각 /api/auth/callback/google 및 /api/auth/callback/apple이고 운영 origin을 임의 지정하지 않습니다.

공식 Apple 근거: https://developer.apple.com/documentation/signinwithapple/incorporating-sign-in-with-apple-into-other-platforms

FE는 공유 isSsoAuthorizationURLForProvider(provider, url)로 선택한 공급자와 응답 URL의 대응도 검증합니다. 서버 서비스도 provider와 URL·저장 상태·검증 identity를 함께 대조합니다.
