# 하루마루 AWS 배포 (#40)

상태: **코드와 견적만 있습니다.** AWS 계정, `terraform plan`·`apply`, 자격 증명, 비용 발생은 아직 없습니다. 설계 기준은 2026-11-05 사용자가 확정한 AWS 서울(ap-northeast-2)입니다.

## 구성

```
사용자 ─ HTTPS ─ CloudFront (*.cloudfront.net, WAF: IP별 rate limit + AWS 관리 규칙 3개)
                    │ /assets/* 캐시, 그 외(/api, /health, /admin, 화면) 캐시 안 함
                    ▼ HTTP 3001 (보안그룹: CloudFront origin-facing prefix list만)
               EC2 t4g.small 1대 (22 닫힘, SSM Session Manager)
                 └ Docker Compose: api(ECR 이미지, web·admin 정적 파일 포함) + postgres 18.4
                    └ PostgreSQL 데이터: 별도 gp3 볼륨 /var/lib/harumaru (주 1회 스냅샷 4개)
               매일 pg_dump → S3 (비공개, 30일 후 삭제)
```

- **S3 화면 분리 대신 단일 이미지를 선택했습니다.** 현재 이미지가 이미 web·admin 정적 파일을 서빙하고, `/admin`은 서버의 관리자 가드(`apps/api/src/app/staticWeb.ts`)를 거칩니다. S3로 나누면 원본·업로드·캐시 무효화 단계가 늘고, 관리자 화면 파일이 가드를 거치지 않게 됩니다. 그래서 S3 사이트 버킷과 OAC는 만들지 않았습니다. 화면을 S3로 옮길 때 추가하면 됩니다.
- 로그인 쿠키는 same-origin이 전제라서 모든 경로를 주소 하나로 묶었습니다. 앱 코드는 바꾸지 않았습니다.
- CloudFront 정액 요금제의 Free·Pro에는 VPC origin이 없습니다(Business 이상). 그래서 EC2에 공인 IPv4(EIP)를 붙이고, 보안그룹으로 CloudFront만 들어오게 막았습니다. CloudFront→EC2 구간은 HTTP입니다. 도메인을 붙인 뒤 origin TLS를 넣는 것이 다음 개선입니다.
- 정액 요금제 제약에 맞췄습니다. 관리형 cache·origin request policy만 쓰고, cache behavior는 2개(한도 5), WAF 규칙은 4개(한도 5)입니다.
- 도메인은 `domain_name`·`acm_certificate_arn` 변수로 나중에 붙입니다. 비어 있으면 `https://<id>.cloudfront.net`이 `BETTER_AUTH_URL`이자 하나뿐인 `TRUSTED_ORIGINS`가 됩니다.

## 파일

| 파일                   | 내용                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `compute.tf`           | EC2, EIP, 보안그룹, 인스턴스 역할(SSM 경로 읽기, ECR pull, 백업 PutObject만), 데이터 볼륨, DLM 주간 스냅샷          |
| `edge.tf`              | CloudFront 배포, WAF web ACL(us-east-1)                                                                             |
| `registry.tf`          | ECR(태그 불변, push 시 스캔, 최근 10개 보존)                                                                        |
| `backup.tf`            | 백업 버킷(공개 차단, SSE, TLS 강제, 30일 수명주기)                                                                  |
| `monitoring.tf`        | SNS 메일, 경보 7개(상태 검사+자동 복구, CPU, CPU 크레딧, 메모리, 디스크, CloudFront 5xx, 백업 누락), 로그 그룹 14일 |
| `cost.tf`              | Budgets 50/80/100% 실제와 100% 예측 알림, 100% 초과 시 EC2 정지 Budget Action, Cost Anomaly Detection               |
| `github.tf`            | GitHub Actions OIDC 역할(`main`만, ECR push와 배포 문서 실행만)                                                     |
| `operations.tf`        | 배포 SSM 문서, #57 계정 삭제 SSM 문서, 삭제 예약(**DISABLED**)                                                      |
| `files/`, `templates/` | 호스트 compose, 배포·환경·백업·삭제 스크립트, cloud-init                                                            |

## 비밀값

Terraform은 비밀값을 만들지도 읽지도 않아서 state에 남지 않습니다. 첫 배포 전에 운영자가 아래 이름으로 SecureString을 한 번 씁니다(`output secret_parameter_names`). 호스트는 부팅·배포 때 tmpfs(`/run/harumaru`)로만 읽습니다.

`/harumaru/<env>/POSTGRES_PASSWORD`, `DATABASE_URL`(`sslmode=require` 필수), `MIGRATION_DATABASE_URL`, `BETTER_AUTH_SECRET`, `GUEST_COOKIE_SECRET`(앞의 값과 달라야 함), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

```sh
aws ssm put-parameter --type SecureString --name /harumaru/production/BETTER_AUTH_SECRET --value "$(openssl rand -base64 48)"
```

## 배포 흐름

1. `main` 병합 → CI → OIDC 역할로 이미지를 `ECR:<전체 SHA>`로 push
2. `aws ssm send-command --document-name harumaru-<env>-deploy --parameters releaseId=<SHA>`
3. 호스트의 `deploy.sh`: 비밀값 갱신 → pull → postgres 기동 → **migration** → api 재시작 → `/health/ready`의 `x-release-id` 확인 → 실패하면 직전 이미지로 롤백

**막힌 점(백엔드 소관):** 런타임 이미지에 Prisma CLI가 없고(devDependency), 운영 migration 주체도 정의되지 않았습니다(`operations/runbooks/account-erasure.v2.md`). 그래서 `deploy.sh`는 `/opt/harumaru/bin/migrate.sh`가 없으면 배포를 거부합니다. DB 역할 생성(`nihongo_app` 등)도 같은 문제로 정해져야 합니다.

## #57 계정 삭제 실행 경로

- `harumaru-<env>-erase-deletion-pending` SSM 문서가 `erase-deletion-pending.sh`를 실행합니다. 이 스크립트는 배포된 이미지로 `node api/dist/auth/ssoAccountErasureCommand.js`(= `auth:erase-deletion-pending:compiled`)를 한 번 돌립니다. 종료 코드 0이면 남은 일이 없고, 1이면 실패했거나 일이 남았습니다.
- 수동 실행: `aws ssm send-command --document-name harumaru-<env>-erase-deletion-pending --instance-ids <id>`
- 예약: EventBridge Scheduler가 매일 03:00 JST에 실행하도록 만들어 두었지만 `state = DISABLED`입니다. `erasure_schedule_enabled = true`는 소유자 승인 뒤에만 켭니다.
- 명령 자체가 credentialed revoke adapter 없이는 PRODUCTION을 거부합니다(BE 소관). 그래서 지금 켜도 매번 실패합니다.

## 비용 방어

EC2와 백업 버킷은 CloudFront나 IAM으로만 접근됩니다. WAF는 IP별 5분 `waf_rate_limit_per_5min`회로 제한합니다. 예산을 100% 넘으면 EC2가 정지되고(데이터는 EBS에 남음), 이상 비용이 5달러 이상이면 메일이 옵니다. 견적은 [COST.md](COST.md)에 있습니다.

## 검증

- 자격 증명 없이 할 수 있는 것: `terraform fmt -check -recursive`, `terraform init -backend=false && terraform validate`
- `terraform plan`은 data source(기본 VPC, AMI, prefix list)가 계정을 조회하므로 **AWS 계정이 생긴 뒤에** 실행합니다.

## apply 뒤 수동 단계

1. SNS·Budgets·Cost Anomaly 메일 구독 확인
2. CloudFront 콘솔에서 배포를 **Free 정액 요금제**에 가입(Terraform 미지원). 계정이 AWS Free Tier(무료 플랜) 상태면 가입할 수 없습니다.
3. 비밀값 SSM 등록 → Google OAuth 클라이언트에 `output google_oauth_redirect_uri` 등록 → 첫 배포
4. 백업 복구 연습(#40): 최신 dump를 새 컨테이너에 `pg_restore`
