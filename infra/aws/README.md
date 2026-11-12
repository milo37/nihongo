# 하루마루 AWS 배포 (#40)

상태: **코드와 견적만 있습니다.** AWS 계정, `terraform plan`·`apply`, 자격 증명, 비용 발생은 아직 없습니다. 설계 기준은 2026-11-05 사용자가 확정한 AWS 서울(ap-northeast-2)입니다.

## 구성

```
사용자 ─ HTTPS ─ CloudFront (*.cloudfront.net, WAF: IP별 rate limit + AWS 관리 규칙 3개)
                    │ /assets/* 캐시, 그 외(/api, /health, /admin, 화면) 캐시 안 함
                    ▼ HTTP 3001 + X-Origin-Verify 비밀 헤더 (보안그룹: CloudFront origin-facing prefix list만)
               EC2 t4g.small 1대 (22 닫힘, SSM Session Manager)
                 └ Docker Compose: proxy(Caddy, 헤더 검사) → api(ECR 이미지, web·admin 정적 파일 포함, 호스트에 비공개)
                                    api → postgres 18.4 (내부망)
                    └ PostgreSQL 데이터: 별도 gp3 볼륨 /var/lib/harumaru (주 1회 스냅샷 4개)
               매일 pg_dump → S3 (비공개, 30일 후 삭제)
```

- **S3 화면 분리 대신 단일 이미지를 선택했습니다.** 현재 이미지가 이미 web·admin 정적 파일을 서빙하고, `/admin`은 서버의 관리자 가드(`apps/api/src/app/staticWeb.ts`)를 거칩니다. S3로 나누면 원본·업로드·캐시 무효화 단계가 늘고, 관리자 화면 파일이 가드를 거치지 않게 됩니다. 그래서 S3 사이트 버킷과 OAC는 만들지 않았습니다. 화면을 S3로 옮길 때 추가하면 됩니다.
- 로그인 쿠키는 same-origin이 전제라서 모든 경로를 주소 하나로 묶었습니다. 앱 코드는 바꾸지 않았습니다.
- CloudFront 정액 요금제의 Free·Pro에는 VPC origin이 없습니다(Business 이상). 그래서 EC2에 공인 IPv4(EIP)를 붙이고, 보안그룹으로 CloudFront만 들어오게 막았습니다.
- 보안그룹의 prefix list는 **모든 AWS 계정의** CloudFront를 허용합니다. 그래서 CloudFront가 origin에 비밀 헤더(`X-Origin-Verify`, Terraform `random_password`)를 붙이고, compose 안의 Caddy가 헤더가 없거나 틀린 요청에 403을 돌려줍니다. 다른 배포를 거쳐 우리 WAF를 우회하는 길이 이것으로 막힙니다.
- API 3001은 호스트에 공개하지 않습니다. 앱은 compose 고정 서브넷(`172.30.0.0/24`)만 trusted proxy(`AUTH_TRUSTED_PROXY_CIDRS`)로 믿고, Caddy는 CloudFront가 붙인 `X-Forwarded-For`를 그대로 넘깁니다. 앱 코드는 바꾸지 않았습니다.
- **origin TLS:** `origin_domain_name`(예: `origin.harumaru.app`, EIP를 가리키는 A 레코드)을 설정하면 CloudFront→EC2가 HTTPS 443이 되고, Caddy가 Let's Encrypt 인증서를 DNS-01(Cloudflare API 토큰)로 직접 받고 갱신합니다(#40, 아래 "origin 인증서"). 기본값은 꺼짐(빈 값)이고 PRODUCTION만 켭니다. EC2 기본 DNS(amazonaws.com)에는 공인 인증서를 받을 수 없어서 도메인이 있어야 합니다.
- 정액 요금제 제약에 맞췄습니다. 관리형 cache·origin request policy만 쓰고, cache behavior는 2개(한도 5), WAF 규칙은 4개(한도 5)입니다.
- 도메인은 `domain_name`·`acm_certificate_arn` 변수로 나중에 붙입니다. 비어 있으면 `https://<id>.cloudfront.net`이 `BETTER_AUTH_URL`이자 하나뿐인 `TRUSTED_ORIGINS`가 됩니다.

## 파일

| 파일                      | 내용                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compute.tf`              | EC2, EIP, 보안그룹, 인스턴스 역할(SSM 경로 읽기, ECR pull, 백업 PutObject만), 데이터 볼륨, DLM 주간 스냅샷                                                                 |
| `edge.tf`                 | CloudFront 배포, origin 비밀 헤더(값은 SSM에도 저장), WAF web ACL(us-east-1)                                                                                               |
| `registry.tf`             | ECR(태그 불변, push 시 스캔, 릴리스 10개 보존: `<SHA>`·`<SHA>-migrate`). 계정에 1개, STAGING이 만들고 PRODUCTION은 읽기만                                                  |
| `backup.tf`               | 백업 버킷(공개 차단, SSE, TLS 강제, 30일 수명주기)                                                                                                                         |
| `audit.tf`                | 계정 CloudTrail 1개(관리 이벤트 읽기·쓰기, 전 리전, 로그 파일 검증)와 보관 버킷(공개 차단, SSE, TLS 강제, 400일 수명주기). 운영자 접속기록 1년(JLP-842), STAGING만 만듦    |
| `monitoring.tf`           | SNS 메일, 경보 8개(상태 검사+자동 복구, CPU, CPU 크레딧, 메모리, 디스크, CloudFront 5xx, 백업 누락, 예약 시작 실패), 예약 작업 실패 알림(EventBridge 규칙), 로그 그룹 30일 |
| `cost.tf`                 | 월 5,000엔(세포함)을 USD로 환산한 Budgets, 50/80/100% 실제·100% 예측 알림, 100% 초과 시 EC2 정지(기본 꺼짐), Cost Anomaly                                                  |
| `github.tf`               | GitHub Actions OIDC 역할(STAGING `main`만·ECR push, PRODUCTION environment `production`만, 배포 문서 실행만)                                                               |
| `operations.tf`           | 배포 SSM 문서, #57 계정 삭제·#694 비회원 정리 SSM 문서와 예약(둘 다 매시, 기본 **DISABLED**)                                                                               |
| `files/`, `templates/`    | 호스트 compose, Caddyfile, 배포·환경·백업·삭제 스크립트, cloud-init                                                                                                        |
| `scripts/render-check.sh` | CI에서 cloud-init·compose·Caddyfile을 두 origin 모드로 렌더링해 검사                                                                                                       |

## 비밀값

앱 비밀값은 Terraform이 만들지도 읽지도 않아서 state에 남지 않습니다. 예외는 origin 비밀 헤더 `ORIGIN_VERIFY_SECRET` 하나입니다. CloudFront 설정에 값이 들어가야 하므로 Terraform이 만들어 SSM에도 쓰고, 그래서 **state에 남습니다**. state는 운영자 로컬이나 암호화된 비공개 backend에만 둡니다. 첫 배포 전에 운영자가 아래 이름으로 SecureString을 한 번 씁니다(`output secret_parameter_names`). 호스트는 부팅·배포 때 tmpfs(`/run/harumaru`)로만 읽습니다.

`/harumaru/<env>/POSTGRES_PASSWORD`, `DATABASE_URL`(`sslmode=require` 필수), `MIGRATION_DATABASE_URL`, `BETTER_AUTH_SECRET`, `GUEST_COOKIE_SECRET`(앞의 값과 달라야 함), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`(로그인은 Google뿐이라 없으면 `render-env.sh`가 배포와 부팅을 멈춤), `PRODUCTION_DATABASE_URL`(계정 삭제 명령·migration 대상 확인용, API 런타임에는 넘기지 않음), DB login 비밀번호 `PROD_MIGRATION_LOGIN_PASSWORD`·`PROD_APP_LOGIN_PASSWORD`·`PROD_GUEST_CLEANUP_LOGIN_PASSWORD`(서로 다른 24자 이상, URL-safe). `DATABASE_URL`은 `nihongo_production_app_login`, `MIGRATION_DATABASE_URL`은 `nihongo_production_migration_login`과 같은 비밀번호를 쓰고 DB 이름은 `nihongo`입니다(`provision-db.sh`가 대조). origin TLS를 켤 때(PRODUCTION)만 `CLOUDFLARE_API_TOKEN`도 씁니다(아래 "origin 인증서"). `render-env.sh`에 남은 `ORIGIN_TLS_*` 처리는 쓰지 않는 옛 경로이고, STAGING 호스트 파일을 바꾸지 않으려고 다음 STAGING 변경 때 지웁니다. 약관·문의 화면의 보호책임자·문의 메일은 선택값 `LEGAL_PRIVACY_OFFICER`·`LEGAL_CONTACT_EMAIL`(`output legal_parameter_names`)이고, PRODUCTION 전에만 넣습니다. `render-env.sh`가 `/var/lib/harumaru/web/legal-settings.json`으로 쓰고 api가 `/app/web/legal-settings.json`으로 읽기 전용 마운트합니다. 없으면(STAGING) `{}`라 화면은 대체 문구를 씁니다(#705, [runbook](../../operations/runbooks/production-database.v1.md) "Legal contact").

```sh
aws ssm put-parameter --type SecureString --name /harumaru/production/BETTER_AUTH_SECRET --value "$(openssl rand -base64 48)"
```

## 배포 흐름

**배포 절차는 [operations/runbooks/deploy.v1.md](../../operations/runbooks/deploy.v1.md) 하나에 있습니다.** 기본은 자동입니다: `main` 병합 → `release-image.yml`이 `ECR:<SHA>`·`ECR:<SHA>-migrate` push → 같은 워크플로의 `Deploy to STAGING`이 OIDC 역할로 `harumaru-staging-deploy`(releaseId=그 SHA) 실행 → `/health/ready` 200 확인. PRODUCTION은 GitHub environment 승인 버튼으로 할 예정입니다(아직 없음). 수동 `send-command`는 그 문서의 부록(비상·학습용)에만 있습니다.

호스트의 `deploy.sh`: 비밀값 갱신 → 두 이미지 pull → postgres 기동 → `provision-db.sh`(DB 역할 생성·검증) → `migrate.sh`(S3에 `pg_dump` 스냅샷 → `prisma migrate deploy` 1회성 컨테이너) → `register-capability.sh`(빈 DB면 `DatabaseCapability` 등록, 있으면 확인만, 어긋나면 중단) → api 재시작 → `/health/ready`의 `x-release-id` 확인 → 실패하면 직전 이미지로 롤백. 자세한 내용과 롤백은 [production-database.v1.md](../../operations/runbooks/production-database.v1.md)에 있습니다. 환경을 처음 채울 때만 첫 관리자 → [question-import.v1.md](../../operations/runbooks/question-import.v1.md)(태그 18 → 500문제 → 일괄 검수 요청·승인·공개)를 한 번 합니다.

**CSP(JLP-788):** API가 모든 응답에 `Content-Security-Policy`를 붙이고, STAGING·PRODUCTION 모두 기본으로 막습니다(enforce). `CSP_MODE=report-only`를 명시할 때만 보고만 하고(브라우저 콘솔), 그 밖의 값이면 API가 시작하지 않습니다.

**로컬 확인:** 빈 DB 첫 배포를 PRODUCTION과 STAGING(#649 뒤) 모두 로컬에서 끝까지 확인했습니다. STAGING도 capability 행은 `PRODUCTION`으로 들어갑니다(런북 'Local rehearsal').

## #57 계정 삭제 실행 경로

- `harumaru-<env>-erase-deletion-pending` SSM 문서가 `erase-deletion-pending.sh`를 실행합니다. 이 스크립트는 배포된 이미지로 `node api/dist/auth/ssoAccountErasureCommand.js`(= `auth:erase-deletion-pending:compiled`)를 한 번 돌립니다. 종료 코드 0이면 남은 일이 없고, 1이면 실패했거나 일이 남았습니다.
- 수동 실행: `aws ssm send-command --document-name harumaru-<env>-erase-deletion-pending --instance-ids <id>`
- 예약: EventBridge Scheduler가 `erasure_schedule_expression`대로 실행합니다. PRODUCTION은 기본값인 매시 정각(JST), STAGING은 평소 정지라 하루 한 번 창(05:00 JST, 아래 'STAGING 평소 정지')입니다. 기본값은 `state = DISABLED`이고, apply 때 `erasure_schedule_enabled = true`로 켭니다(#670).
- 스크립트는 이 명령에만 `ACCOUNT_ERASURE_ENVIRONMENT=PRODUCTION`, `ACCOUNT_ERASURE_CONFIRM=ERASE_DELETION_PENDING_ACCOUNTS`, `PRODUCTION_DATABASE_URL`(SSM)을 환경 변수로 넘깁니다(명령줄 인자에는 나타나지 않음).
- STAGING 호스트도 DB는 PRODUCTION 형태(capability `PRODUCTION`)라 같은 값으로 돌고, 실제 대상은 `PRODUCTION_DATABASE_URL`과 정확히 같은지로 묶입니다.
- #696부터 앱이 provider 토큰을 보관하지 않으므로 provider 정리는 `NOT_HELD`로 완료 처리되고 앱 데이터를 지웁니다.

## #694 비회원 데이터 정리

- `harumaru-<env>-guest-cleanup` SSM 문서가 `guest-cleanup.sh`로 배포된 이미지의 `studyGuestCleanupRuntime.js`를 한 번 돌립니다. 만료 7일 지난 비회원 기록·임시저장, 비회원 식별자, 끝난 재요청 기록, 제한 창이 끝나고 7일 지난 요청 제한 기록을 지웁니다. 한 번에 최대 1,000행이고, 남으면 종료 코드 1입니다.
- 예약은 `guest_cleanup_schedule_expression`대로 PRODUCTION은 매시 30분, STAGING은 하루 한 번 05:30(Asia/Tokyo)이고 기본 `DISABLED`입니다. `guest_cleanup_schedule_enabled = true`로 켭니다. 절차는 [operations/runbooks/guest-cleanup-worker.v1.md](../../operations/runbooks/guest-cleanup-worker.v1.md) 'AWS host'.
- 회원의 만료 임시저장 정리(`studyDraftCleanupCommand`)는 아직 운영 환경을 거부해서 여기 없습니다(BE 변경, 배포 이후 #699).

## state와 두 스택 (JLP-835)

STAGING과 PRODUCTION은 같은 계정에 같은 코드를 각자의 state로 올립니다. state는 S3 backend(버전 관리, `use_lockfile`)에 환경별 key로 둡니다. 비밀 헤더 값이 state에 있으므로 버킷은 비공개·암호화·버전 관리로 만듭니다.

```sh
# 한 번(계정당): 버킷. 이름은 harumaru-tfstate-<계정 ID>
b=harumaru-tfstate-$(aws sts get-caller-identity --query Account --output text)
aws s3api create-bucket --bucket "$b" --create-bucket-configuration LocationConstraint=ap-northeast-2
aws s3api put-bucket-versioning --bucket "$b" --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket "$b" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$b" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
# 환경마다(작업 폴더를 환경별로 따로 두거나, 바꿀 때 -reconfigure)
terraform init -backend-config=backends/staging.s3.tfbackend -backend-config=bucket="$b"   # 처음엔 -migrate-state
```

- **지금 STAGING은 로컬 state입니다.** 이 코드 뒤 첫 `terraform init`은 `-migrate-state`로 로컬 state를 S3 `staging/terraform.tfstate`로 옮깁니다. 그 뒤 `terraform plan`에서 아래 "이동"만 나오는지 확인합니다.
- 이동(`moved`): ECR이 계정에 1개가 되면서 `aws_ecr_repository.api` → `api[0]`, `aws_ecr_lifecycle_policy.api` → `api[0]`. 실제 변경 없음.
- PRODUCTION tfvars: `github_deploy_environment = "production"`(없으면 validation 거부), `create_ecr_repository = false`, `create_github_oidc_provider = false`, `create_cost_anomaly_monitor = false`(계정당 1개). 예시는 `terraform.tfvars.example`.
- 예산: 필터가 없으면 각 스택 예산이 **계정 전체**를 셉니다. PRODUCTION을 만들 때 두 스택 모두 `budget_filter_by_environment = true`, STAGING에 `manage_cost_allocation_tag = true`(태그 `Environment` 활성화, 계정 설정). 활성화 뒤의 비용부터 태그가 붙고 최대 24시간 걸리므로 **PRODUCTION apply 하루 전**에 STAGING에서 먼저 켭니다. 한도는 스택마다 `monthly_budget_jpy`로 따로 정합니다. 태그 없는 비용(일부 데이터 전송 등)은 어느 예산에도 안 들어가므로 계정 전체는 Cost Anomaly 메일로 봅니다.
- STAGING 평소 정지(선택, 2026-11-12 STAGING 적용): 저장소 변수 `STAGING_START_IF_STOPPED = true`면 배포 잡이 서버를 켜고(`deploy_role_can_start_host = true`), 배포 문서의 `stopAfterMinutes`로 **배포 뒤 3시간에 서버가 스스로 정지**합니다(다음 배포가 오면 다시 3시간). 안전망으로 `host_stop_schedule_expression`이 매일 정지합니다. 탈퇴·손님 정리 예약은 매시로 두면 꺼진 서버에 전달되지 않아 실패 알림이 계속 오므로, STAGING은 하루 한 번 창으로 모읍니다: `host_start_schedule_expression` 04:40 시작 → `erasure_schedule_expression` 05:00 → `guest_cleanup_schedule_expression` 05:30 → `host_stop_schedule_expression` 05:50 정지(JST). `host_kept_stopped = true`면 백업 누락·CloudFront 5xx 경보는 남지만 알림을 보내지 않습니다(꺼진 동안 거짓 경보). 호스트 백업 타이머는 cloud-init이 처음 한 번만 쓰므로 창으로 옮기는 것은 다음 호스트 교체 때 합니다. 정지 중에도 EIP·EBS 약 $6.4/월. PRODUCTION에는 쓸 수 없습니다(validation).

## 비용 방어

EC2와 백업 버킷은 CloudFront나 IAM으로만 접근됩니다. WAF는 IP별 5분 `waf_rate_limit_per_5min`회로 제한합니다. 이상 비용이 5달러 이상이면 메일이 옵니다. 견적은 [COST.md](COST.md)에 있습니다.

- 월 예산은 소비세 포함 `monthly_budget_jpy = 5000`엔입니다(사용자 확정 2026-11-05). Budgets는 USD만 받으므로 `한도 USD = 5000 ÷ (1 + 0.10) ÷ 158.38 = $28.69`로 환산합니다. 세율(`budget_consumption_tax_rate`)과 환율(`budget_jpy_per_usd`, 2026-11-05 기준)은 변수 기본값이고, 예산은 세전 비용과 비교합니다(`include_tax = false`).
- 알림: 실제 50%(2,500엔)·80%(4,000엔)·100%와 100% 예측. EC2 자동 정지(Budget Action)는 기본 꺼짐입니다(`budget_stop_ec2_enabled = false`). 켜면 실제 100%를 넘을 때 EC2를 정지합니다(데이터는 EBS에 남음).
- CloudFront Free 정액 요금제에 못 들어가면 WAF 요금(약 1,620엔, 세포함)이 더해져 예산을 넘습니다. COST.md를 보세요.
- 예산은 크레딧을 빼기 전 사용액으로 판정합니다(`include_credit = false`). 크레딧이 남아 있는 동안에도 실제 사용량이 보이게 하려는 것입니다.

## 계정 플랜과 크레딧 (2026-11-12, JLP-834)

계정은 **유료(PAID) 플랜**입니다(2026-11-12 전환). Free plan 때 받은 크레딧 $118.11(2027-05-05 만료)은 그대로 이어져 먼저 쓰이고, 다 쓰면 현금 청구가 시작됩니다. 잔액은 Billing 콘솔 Credits에서 봅니다.

- STAGING 배포는 CloudFront **Free 정액 요금제**에 가입했습니다(WAF 포함, 초과 과금 없음). 월 약 $21.88, 세포함 약 3,810엔으로 예산 한도 $28.69 안입니다(COST.md).
- 정액 가입 뒤 배포의 price class가 `PriceClass_All`이 되어 있어 코드도 그 값으로 맞췄습니다(`edge.tf`). 정액 요금제에서는 price class가 요금에 영향이 없고, 다른 값으로 되돌리면 plan에 CloudFront 변경이 생깁니다.
- EC2 자동 정지를 켭니다: STAGING `terraform.tfvars`에 `budget_stop_ec2_enabled = true`. plan은 `aws_iam_role.budget_action`, 정책 연결, `aws_budgets_budget_action.stop_ec2` **3개 추가만**이어야 합니다. 끌 때는 값을 지우면 3개가 삭제되고 예산·알림은 그대로입니다.
- 예산은 크레딧을 빼기 전 사용액으로 판정하므로(`include_credit = false`) 크레딧이 남아 있어도 한도를 넘으면 정지합니다.
- 사람 로그인은 MFA를 건 IAM 관리 사용자 1명이고, 루트는 쓰지 않습니다. 계정이 유료라 IAM Identity Center(AWS Organizations 필요)로 옮길 수 있지만 지금은 옮기지 않습니다.
- PRODUCTION이 생기면 예산이 계정 전체를 세지 않도록 "state와 두 스택"의 예산 필터를 먼저 켭니다.

## DNS (Cloudflare, Route 53 없음)

도메인 harumaru.app은 AWS 밖 Cloudflare Registrar에서 삽니다. PRODUCTION은 **도메인을 산 뒤에 apply합니다**(남는 위험 절). STAGING은 `*.cloudfront.net` 주소로 운영합니다. `.app`은 브라우저가 HTTPS로만 여는 TLD(HSTS preload)입니다. CloudFront는 이미 http를 https로 돌리고, 쿠키는 `__Secure-`·`__Host-`라 그대로 맞습니다. 아래 DNS 검증(ACM CNAME, Let's Encrypt DNS-01, Search Console TXT)은 브라우저를 거치지 않아 영향이 없습니다. Route 53 hosted zone은 만들지 않습니다. 산 뒤 할 일:

1. us-east-1 ACM에서 `harumaru.app` 인증서를 DNS 검증으로 요청하고, ACM이 주는 검증 CNAME을 Cloudflare DNS에 넣습니다. 발급되면 ARN을 `acm_certificate_arn`에, `harumaru.app`을 `domain_name`에 넣습니다.
2. Cloudflare에 `harumaru.app` → `<id>.cloudfront.net` CNAME을 만듭니다(apex는 Cloudflare CNAME flattening). **프록시는 끕니다(DNS only, 회색 구름).** 켜면 Cloudflare가 CloudFront 앞에 한 겹 더 서서 TLS·캐시·클라이언트 IP가 꼬입니다.
3. origin TLS: Cloudflare에 `origin.harumaru.app` A 레코드 → EIP(`output`의 공인 IP)를 DNS only로 만들고 `origin_domain_name = "origin.harumaru.app"`을 설정합니다. 인증서는 공인 CA여야 하므로 Cloudflare Origin CA 인증서는 쓸 수 없습니다(CloudFront가 믿지 않음). 발급·갱신은 아래 "origin 인증서"대로 Caddy가 합니다.
4. 도메인을 붙이면 `BETTER_AUTH_URL`·`TRUSTED_ORIGINS`가 `https://harumaru.app`으로 바뀌므로, Google OAuth 클라이언트의 redirect URI도 새 `google_oauth_redirect_uri`로 바꿉니다.

## origin 인증서 (PRODUCTION, Let's Encrypt DNS-01, #40)

보안그룹이 CloudFront만 들이므로 HTTP-01·TLS-ALPN-01 검증은 못 씁니다. 그래서 Caddy가 Cloudflare DNS에 TXT를 잠깐 써서 인증서를 받고, 만료 전에 스스로 갱신합니다(Let's Encrypt 수명이 2027-02부터 64일, 2028년 45일로 줄어도 손댈 일 없음).

- 이미지: 기본 Caddy에는 Cloudflare 모듈이 없어서 `caddy/Dockerfile`(Caddy 2.11.8 + `caddy-dns/cloudflare` v0.2.4, 베이스 digest 고정)을 `.github/workflows/caddy-image.yml`이 arm64로 빌드해 **PRODUCTION 전용 ECR `harumaru/caddy`**(`output caddy_ecr_repository_url`, 최근 5개 보관)에 넣습니다. 역할은 api 이미지와 같은 GitHub OIDC 배포 역할이고(main만 신뢰), 그 리포 push만 별도 정책 `caddy-push`로 더합니다. 서버는 인스턴스 역할로 같은 리포를 pull합니다. 호스트는 `caddy_dns_image`(`<리포 URL>@sha256:<digest>`)를 digest로 고정합니다. STAGING은 이 리포·정책·변수 모두 없고 `caddy_image` 그대로입니다.
- 토큰: Cloudflare API 토큰은 권한 **Zone · DNS · Edit**, 대상 **harumaru.app 한 zone**, **Client IP 필터 = EIP**로 만듭니다. SSM `/harumaru/production/CLOUDFLARE_API_TOKEN`(SecureString)에만 두고, 부팅 때 `harumaru-origin-env.service`(`render-origin-env.sh`)가 tmpfs `/run/harumaru/origin.env`로 꺼내 proxy에 넘깁니다. 바꿀 때는 SSM 값을 고친 뒤 호스트에서 `sudo /opt/harumaru/bin/render-origin-env.sh && cd /opt/harumaru && sudo docker compose up -d --force-recreate proxy`.
- 저장: ACME 계정과 인증서는 Docker 볼륨 `caddy-data`(`/data`)에 남아 재시작해도 다시 발급하지 않습니다(발급 한도 주 5회/같은 이름).
- 첫 PRODUCTION apply 순서(이 변경이 main에 들어간 뒤, 워크플로가 main에서만 돕니다):
  1. 리포·push 권한·EIP만 먼저: `terraform apply -target=aws_iam_role_policy.github_caddy_push -target=aws_ecr_lifecycle_policy.caddy -target=aws_eip.host` → 6 to add(계정에 GitHub OIDC 공급자가 이미 있어 `create_github_oidc_provider = false`면 5), 0 change, 0 destroy. `caddy-push` 정책에 `ecr:GetAuthorizationToken`도 있어 이 단계만으로 Caddy 이미지를 push할 수 있습니다(배포 정책 `deploy`는 서버와 함께 전체 apply 때 생김).
  2. Cloudflare: 위 조건으로 토큰을 만들고 SSM에 넣습니다(값은 채팅·파일에 남기지 않음). `origin.harumaru.app` A → EIP(DNS only)도 이때 만듭니다.
  3. GitHub 저장소 변수 `PRODUCTION_AWS_DEPLOY_ROLE_ARN`(`output github_deploy_role_arn`)·`CADDY_ECR_REPOSITORY_URL`(`output caddy_ecr_repository_url`)을 넣고 Actions에서 "Caddy image"를 main으로 실행합니다. 요약에 나온 `caddy_dns_image = "...@sha256:..."` 줄을 `terraform.tfvars`에 붙입니다.
  4. 전체 apply: 50 to add, 0 change, 0 destroy(기본값 기준 합계 56). `caddy_dns_image` 없이 plan하면 precondition이 멈춥니다.
  5. 확인: 호스트에서 `sudo docker compose -f /opt/harumaru/compose.yaml logs proxy | grep -i 'certificate obtained'`, 밖에서 `curl -sI https://harumaru.app/health/ready`.

## 검증

- 자격 증명 없이 할 수 있는 것: `terraform fmt -check -recursive`, `terraform init -backend=false && terraform validate`, `tflint`, `bash scripts/render-check.sh`
- CI: `.github/workflows/infra.yml`이 `infra/aws/**`가 바뀔 때 버전과 SHA256을 고정한 terraform·tflint로 위 검사를 모두 돌리고, `caddy validate`로 두 모드의 Caddyfile을 확인합니다.
- `terraform plan`은 data source(기본 VPC, AMI, prefix list)가 계정을 조회하므로 **AWS 계정이 생긴 뒤에** 실행합니다.

## 남는 위험

- **origin 평문 구간:** `origin_domain_name`이 비어 있는 동안 CloudFront→EC2는 HTTP라서 쿠키·Authorization·OAuth code가 공개망을 평문으로 지납니다. 비밀 헤더도 같은 구간을 지나므로, 경로상 도청자가 있으면 헤더 보호도 완전하지 않습니다. **도메인/origin TLS 결정(사용자) 전에는 apply하지 않습니다.** 사용자가 2안(도메인 미룸)을 고르면 STAGING에서만 평문을 감수하고, 도메인을 산 뒤 origin TLS를 켭니다. PRODUCTION은 `origin_domain_name` 없이는 validation에서 거부됩니다.
- **비밀 헤더 값이 Terraform state에 남습니다**(위 비밀값 절).
- 헤더를 바꾸려면 `terraform apply -replace=random_password.origin_verify` 후 호스트에서 `render-env.sh`와 `docker compose up -d proxy`를 실행합니다. 둘 사이에는 잠깐 403이 납니다.

## apply 뒤 수동 단계

1. SNS·Budgets·Cost Anomaly 메일 구독 확인
2. CloudFront 콘솔에서 배포를 **Free 정액 요금제**에 가입(Terraform 미지원, 계정이 유료여야 함). STAGING은 2026-11-12에 가입했습니다.
3. 비밀값 SSM 등록 → Google OAuth 클라이언트에 `output google_oauth_redirect_uri` 등록 → 첫 배포([deploy.v1.md](../../operations/runbooks/deploy.v1.md): 저장소 변수 2개를 넣으면 다음 `main` 병합부터 자동)
4. 백업 되살리기 시험: [operations/runbooks/recovery.v1.md](../../operations/runbooks/recovery.v1.md)의 'STAGING 첫 배포 직후' 절
