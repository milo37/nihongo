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
- **origin TLS:** `origin_domain_name`(예: `origin.harumaru.net`, EIP를 가리키는 A 레코드)을 설정하면 CloudFront→EC2가 HTTPS 443이 되고, Caddy가 SSM의 `ORIGIN_TLS_CERT_B64`·`ORIGIN_TLS_KEY_B64`(공인 CA 인증서와 키의 PEM을 base64로) 파일로 TLS를 엽니다. 기본값은 꺼짐(빈 값)입니다. EC2 기본 DNS(amazonaws.com)에는 공인 인증서를 받을 수 없어서 도메인이 있어야 합니다. 인증서 발급·갱신 방법(Let's Encrypt DNS-01 등)은 도메인을 정할 때 고릅니다.
- 정액 요금제 제약에 맞췄습니다. 관리형 cache·origin request policy만 쓰고, cache behavior는 2개(한도 5), WAF 규칙은 4개(한도 5)입니다.
- 도메인은 `domain_name`·`acm_certificate_arn` 변수로 나중에 붙입니다. 비어 있으면 `https://<id>.cloudfront.net`이 `BETTER_AUTH_URL`이자 하나뿐인 `TRUSTED_ORIGINS`가 됩니다.

## 파일

| 파일                      | 내용                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `compute.tf`              | EC2, EIP, 보안그룹, 인스턴스 역할(SSM 경로 읽기, ECR pull, 백업 PutObject만), 데이터 볼륨, DLM 주간 스냅샷                |
| `edge.tf`                 | CloudFront 배포, origin 비밀 헤더(값은 SSM에도 저장), WAF web ACL(us-east-1)                                              |
| `registry.tf`             | ECR(태그 불변, push 시 스캔, 릴리스 10개 보존: `<SHA>`·`<SHA>-migrate`)                                                   |
| `backup.tf`               | 백업 버킷(공개 차단, SSE, TLS 강제, 30일 수명주기)                                                                        |
| `monitoring.tf`           | SNS 메일, 경보 7개(상태 검사+자동 복구, CPU, CPU 크레딧, 메모리, 디스크, CloudFront 5xx, 백업 누락), 로그 그룹 14일       |
| `cost.tf`                 | 월 5,000엔(세포함)을 USD로 환산한 Budgets, 50/80/100% 실제·100% 예측 알림, 100% 초과 시 EC2 정지(기본 꺼짐), Cost Anomaly |
| `github.tf`               | GitHub Actions OIDC 역할(`main`만, ECR push와 배포 문서 실행만)                                                           |
| `operations.tf`           | 배포 SSM 문서, #57 계정 삭제 SSM 문서, 삭제 예약(**DISABLED**)                                                            |
| `files/`, `templates/`    | 호스트 compose, Caddyfile, 배포·환경·백업·삭제 스크립트, cloud-init                                                       |
| `scripts/render-check.sh` | CI에서 cloud-init·compose·Caddyfile을 두 origin 모드로 렌더링해 검사                                                      |

## 비밀값

앱 비밀값은 Terraform이 만들지도 읽지도 않아서 state에 남지 않습니다. 예외는 origin 비밀 헤더 `ORIGIN_VERIFY_SECRET` 하나입니다. CloudFront 설정에 값이 들어가야 하므로 Terraform이 만들어 SSM에도 쓰고, 그래서 **state에 남습니다**. state는 운영자 로컬이나 암호화된 비공개 backend에만 둡니다. 첫 배포 전에 운영자가 아래 이름으로 SecureString을 한 번 씁니다(`output secret_parameter_names`). 호스트는 부팅·배포 때 tmpfs(`/run/harumaru`)로만 읽습니다.

`/harumaru/<env>/POSTGRES_PASSWORD`, `DATABASE_URL`(`sslmode=require` 필수), `MIGRATION_DATABASE_URL`, `BETTER_AUTH_SECRET`, `GUEST_COOKIE_SECRET`(앞의 값과 달라야 함), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PRODUCTION_DATABASE_URL`(계정 삭제 명령·migration 대상 확인용, API 런타임에는 넘기지 않음), DB login 비밀번호 `PROD_MIGRATION_LOGIN_PASSWORD`·`PROD_APP_LOGIN_PASSWORD`·`PROD_GUEST_CLEANUP_LOGIN_PASSWORD`(서로 다른 24자 이상, URL-safe). `DATABASE_URL`은 `nihongo_production_app_login`, `MIGRATION_DATABASE_URL`은 `nihongo_production_migration_login`과 같은 비밀번호를 쓰고 DB 이름은 `nihongo`입니다(`provision-db.sh`가 대조). origin TLS를 켤 때만 `ORIGIN_TLS_CERT_B64`, `ORIGIN_TLS_KEY_B64`도 씁니다.

```sh
aws ssm put-parameter --type SecureString --name /harumaru/production/BETTER_AUTH_SECRET --value "$(openssl rand -base64 48)"
```

## 배포 흐름

1. `main` 병합 → `.github/workflows/release-image.yml`(arm64)이 OIDC 역할로 `ECR:<SHA>`(런타임)와 `ECR:<SHA>-migrate`(Dockerfile `migrate` 단계, Prisma CLI와 migration만)를 push. 저장소 변수 `AWS_DEPLOY_ROLE_ARN`·`ECR_REPOSITORY_URL`·`AWS_REGION`을 넣기 전에는 건너뜁니다.
2. `aws ssm send-command --document-name harumaru-<env>-deploy --parameters releaseId=<SHA>`
3. 호스트의 `deploy.sh`: 비밀값 갱신 → 두 이미지 pull → postgres 기동 → `provision-db.sh`(DB 역할 생성·검증) → `migrate.sh`(S3에 `pg_dump` 스냅샷 → `prisma migrate deploy` 1회성 컨테이너) → `register-capability.sh`(빈 DB면 `DatabaseCapability` 등록, 있으면 확인만, 어긋나면 중단) → (태그 적재, BE 명령 준비 중) → api 재시작 → `/health/ready`의 `x-release-id` 확인 → 실패하면 직전 이미지로 롤백

절차·롤백은 [operations/runbooks/production-database.v1.md](../../operations/runbooks/production-database.v1.md)에 있습니다.

**아직 막힌 점:** STAGING에서는 capability 등록 명령이 거부되어 배포가 `register-capability.sh`에서 멈춥니다(이전 API는 그대로). 백엔드 PR #649(JLP-734, capability 명령만 STAGING 허용, 행은 PRODUCTION) 병합 뒤에 풀립니다. PRODUCTION 이름으로 빈 DB 첫 배포는 로컬에서 끝까지 확인했습니다(런북 'Local rehearsal').

## #57 계정 삭제 실행 경로

- `harumaru-<env>-erase-deletion-pending` SSM 문서가 `erase-deletion-pending.sh`를 실행합니다. 이 스크립트는 배포된 이미지로 `node api/dist/auth/ssoAccountErasureCommand.js`(= `auth:erase-deletion-pending:compiled`)를 한 번 돌립니다. 종료 코드 0이면 남은 일이 없고, 1이면 실패했거나 일이 남았습니다.
- 수동 실행: `aws ssm send-command --document-name harumaru-<env>-erase-deletion-pending --instance-ids <id>`
- 예약: EventBridge Scheduler가 매일 03:00 JST에 실행하도록 만들어 두었지만 `state = DISABLED`입니다. `erasure_schedule_enabled = true`는 소유자 승인 뒤에만 켭니다.
- 스크립트는 이 명령에만 `ACCOUNT_ERASURE_ENVIRONMENT=PRODUCTION`, `ACCOUNT_ERASURE_CONFIRM=ERASE_DELETION_PENDING_ACCOUNTS`, `PRODUCTION_DATABASE_URL`(SSM)을 환경 변수로 넘깁니다(명령줄 인자에는 나타나지 않음).
- `DEPLOYMENT_ENVIRONMENT=STAGING`이면 DB에 접근하기 전에 거부합니다. CLI가 `TEST|DEVELOPMENT|PRODUCTION`만 받기 때문입니다(STAGING 지원 여부는 BE 결정).
- 명령 자체가 credentialed revoke adapter 없이는 PRODUCTION을 거부합니다(BE 소관). 그래서 지금 켜도 매번 실패합니다.

## 비용 방어

EC2와 백업 버킷은 CloudFront나 IAM으로만 접근됩니다. WAF는 IP별 5분 `waf_rate_limit_per_5min`회로 제한합니다. 이상 비용이 5달러 이상이면 메일이 옵니다. 견적은 [COST.md](COST.md)에 있습니다.

- 월 예산은 소비세 포함 `monthly_budget_jpy = 5000`엔입니다(사용자 확정 2026-11-05). Budgets는 USD만 받으므로 `한도 USD = 5000 ÷ (1 + 0.10) ÷ 158.38 = $28.69`로 환산합니다. 세율(`budget_consumption_tax_rate`)과 환율(`budget_jpy_per_usd`, 2026-11-05 기준)은 변수 기본값이고, 예산은 세전 비용과 비교합니다(`include_tax = false`).
- 알림: 실제 50%(2,500엔)·80%(4,000엔)·100%와 100% 예측. EC2 자동 정지(Budget Action)는 기본 꺼짐입니다(`budget_stop_ec2_enabled = false`). 켜면 실제 100%를 넘을 때 EC2를 정지합니다(데이터는 EBS에 남음).
- CloudFront Free 정액 요금제에 못 들어가면 WAF 요금(약 1,620엔, 세포함)이 더해져 예산을 넘습니다. COST.md를 보세요.
- 예산은 크레딧을 빼기 전 사용액으로 판정합니다(`include_credit = false`). 크레딧이 남아 있는 동안에도 실제 사용량이 보이게 하려는 것입니다.

## AWS Free plan 동안 운용 (사용자 결정 2026-11-05, JLP-716)

계정은 일반 가입(서울)의 Free plan입니다. 공개 직전에 유료 플랜으로 바꾸고, 그때까지는 크레딧으로 STAGING만 시험 배포합니다.

- Free plan 계정은 CloudFront 정액 요금제에 가입할 수 없습니다. 그래서 CloudFront는 종량제와 WAF로 돌고(코드 변경 없음), 비용은 크레딧에서 빠집니다. 월 약 $31, 세전 약 4,940엔입니다(COST.md).
- 이 사용액은 예산 한도 $28.69보다 많습니다. Free plan은 현금 청구가 없으므로 이 기간에는 EC2 자동 정지를 끄고 알림만 받습니다(사용자 결정 2026-11-06, 기본값 `budget_stop_ec2_enabled = false`). 정지를 켜 두면 매달 말 무렵 사이트가 멈춥니다.
- Free plan은 가입 6개월 뒤나 크레딧이 떨어지면 계정이 닫힙니다(90일 안에 전환하지 않으면 데이터 삭제). 크레딧 잔액은 Billing 콘솔에서 확인합니다.
- 사람 로그인은 MFA를 건 IAM 관리 사용자 1명이고, 루트는 쓰지 않습니다. IAM Identity Center는 AWS Organizations가 필요하고, Organizations에 들어가면 계정이 자동으로 유료 전환되므로 지금은 쓰지 않습니다. 배포는 원래대로 GitHub OIDC 역할입니다.
- 유료 전환 시점은 공개 직전입니다. 전환한 뒤 아래 'apply 뒤 수동 단계' 2번(정액 요금제 가입)을 하고, 필요하면 Identity Center로 옮깁니다. 남은 크레딧은 이어집니다.
- 유료 전환 때 EC2 자동 정지를 다시 켭니다: `terraform.tfvars`에 `budget_stop_ec2_enabled = true`를 넣고 plan에서 `aws_iam_role.budget_action`, 정책 연결, `aws_budgets_budget_action.stop_ec2` 3개 추가만 있는지 확인한 뒤 apply합니다. 끌 때는 값을 지우면 3개가 삭제되고 예산·알림은 그대로입니다.

## DNS (Cloudflare, Route 53 없음)

도메인 harumaru.net은 AWS 밖(Cloudflare 등)에서 삽니다. 구매 시점은 아직 정하지 않았고, **그 전에는 apply하지 않습니다**(남는 위험 절). Route 53 hosted zone은 만들지 않습니다. 산 뒤 할 일:

1. us-east-1 ACM에서 `harumaru.net` 인증서를 DNS 검증으로 요청하고, ACM이 주는 검증 CNAME을 Cloudflare DNS에 넣습니다. 발급되면 ARN을 `acm_certificate_arn`에, `harumaru.net`을 `domain_name`에 넣습니다.
2. Cloudflare에 `harumaru.net` → `<id>.cloudfront.net` CNAME을 만듭니다(apex는 Cloudflare CNAME flattening). **프록시는 끕니다(DNS only, 회색 구름).** 켜면 Cloudflare가 CloudFront 앞에 한 겹 더 서서 TLS·캐시·클라이언트 IP가 꼬입니다.
3. origin TLS: Cloudflare에 `origin.harumaru.net` A 레코드 → EIP(`output`의 공인 IP)를 DNS only로 만들고 `origin_domain_name = "origin.harumaru.net"`을 설정합니다. 인증서는 공인 CA여야 하므로 Cloudflare Origin CA 인증서는 쓸 수 없습니다(CloudFront가 믿지 않음). Let's Encrypt DNS-01(Cloudflare API 토큰) 등으로 받아 SSM `ORIGIN_TLS_CERT_B64`·`ORIGIN_TLS_KEY_B64`에 넣습니다. 발급·갱신 방식은 그때 정합니다.
4. 도메인을 붙이면 `BETTER_AUTH_URL`·`TRUSTED_ORIGINS`가 `https://harumaru.net`으로 바뀌므로, Google OAuth 클라이언트의 redirect URI도 새 `google_oauth_redirect_uri`로 바꿉니다.

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
2. CloudFront 콘솔에서 배포를 **Free 정액 요금제**에 가입(Terraform 미지원). 계정이 AWS Free plan이면 가입할 수 없으므로 유료 전환 뒤에 합니다.
3. 비밀값 SSM 등록 → Google OAuth 클라이언트에 `output google_oauth_redirect_uri` 등록 → 첫 배포
4. 백업 복구 연습(#40): 최신 dump를 새 컨테이너에 `pg_restore`
