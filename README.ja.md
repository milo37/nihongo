# ハルマル（하루마루）

[한국어](README.md) · [日本語](README.ja.md)

**ハルマル**は、JLPT N5〜N1 を目指す韓国語話者のための Web 学習サービスです。
気軽に開いて数問解き、間違えた問題は「間違いノート」で解き直す、という流れに絞って作りました。
問題と解説はすべてオリジナルで、実際の JLPT 過去問や市販教材の問題は使っていません。

- サービス URL: https://harumaru.app （2026 年 11 月公開予定）

## 主な機能

| 領域                     | 内容                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 問題演習                 | 級（N5〜N1）と科目（文字・語彙、文法、読解）を選び、5・10・20 問を解きます。提出すると赤ペンで採点する演出と解説が表示されます。 |
| ゲスト体験               | ログインなしで 1 日 3 回、5 問ずつ解けます。ログインすると直前の結果をアカウントに引き継ぎます。                                 |
| 間違いノート             | 間違えた問題が自動で集まり、解き直して正解すると「復習済み」に移ります。問題ごとにメモを残せます。                               |
| ブックマーク・今日の一問 | 見直したい問題を保存でき、トップ画面で 1 日 1 問をすぐ解けます。                                                                 |
| 管理画面                 | 問題作成 → レビュー依頼 → 承認 → 公開のワークフロー、JSON 一括インポート、問題報告の対応、会員管理。                             |
| 画面                     | 韓国語・日本語 UI、スマートフォン・PC 対応、キーボード操作とスクリーンリーダーへの配慮。                                         |

ログインは Google アカウントのみです。パスワードは保存しません。

## 技術スタック

| 区分       | 技術                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| Web        | React 19, TypeScript, Vite, React Router, TanStack Query, Zustand, Tailwind CSS 4, React Hook Form, Zod, MSW |
| API        | Node.js 22, Hono, Prisma 7, PostgreSQL 18, Better Auth（Google OAuth）                                       |
| 共有コード | `packages/contracts`（リクエスト・レスポンス契約、Zod）、`packages/domain`（ドメインルール）                 |
| テスト     | Vitest, Playwright（実ブラウザ・アクセシビリティ検査）, API・DB 統合テスト                                   |
| インフラ   | AWS（CloudFront・WAF, EC2, S3, ECR, SSM, CloudWatch, Budgets）, Terraform, Docker Compose, Caddy             |
| CI/CD      | GitHub Actions, GitHub OIDC（固定アクセスキーなし）, gitleaks によるシークレット検査, Dependabot             |

## 構成

```text
ユーザー ─ HTTPS ─▶ CloudFront + WAF ─▶ EC2 (Docker Compose)
                                         ├─ Caddy（CloudFront 専用ヘッダーを確認）
                                         ├─ API（Hono）── 画面の静的ファイルも配信
                                         └─ PostgreSQL 18 ──▶ S3 バックアップ

GitHub Actions ─▶ ECR（イメージ）─▶ SSM Run Command でデプロイ
シークレット: SSM Parameter Store / アラート: CloudWatch・Budgets
```

- サーバー状態は API（開発・テストでは MSW）から取得し、画面側では `API 関数 → Query Factory → ドメインフック → コンポーネント` の順でのみ扱います。
- 認証・認可はサーバーが判断します。クライアント状態（Zustand）にはログインユーザーの最小限の情報だけを置きます。
- ブラウザのコードがサーバー専用コード（Prisma、リポジトリ、シークレット）を読み込めないよう、アーキテクチャ検査で防いでいます。

## セキュリティ

- 学習データの参照・更新はすべて、DB でリクエストしたユーザー本人のものだけを対象にします。
- 管理機能はリクエストごとに DB で権限を確認し、管理操作には 30 分以内の再ログインが必要です。
- 書き込みリクエストは同一オリジンのみ受け付け、Cookie は `HttpOnly`・`Secure`・`SameSite=Lax` です。
- 機能ごとのレート制限、WAF ルール、CloudFront からのみ到達できるサーバーポートを設けています。
- シークレットはリポジトリに置きません。PR は gitleaks のシークレット検査を通過しないとマージできません。

## ディレクトリ構成

```text
.
├── apps/
│   ├── web/          # 学習者向け画面（Vite・React）
│   ├── admin/        # 管理画面（Vite・React、/admin）
│   └── api/          # API、認証、学習・問題ドメイン、DB マイグレーション
├── packages/
│   ├── browser/      # 学習者・管理画面の共通 UI
│   ├── contracts/    # 共有リクエスト・レスポンス契約
│   └── domain/       # ドメインルール
├── content/          # 問題インポートファイル、タグ、品質ルール
├── infra/            # Terraform（AWS）、ローカル PostgreSQL 初期化
├── operations/       # 運用手順（デプロイ、復旧、管理者、問題公開）
├── scripts/          # アーキテクチャ・セキュリティ・運用の検査
└── .github/          # CI・デプロイのワークフロー
```

## ローカル実行（Mock）

Node.js **22.23.0**、pnpm **10.2.1** を使います。リポジトリのルートで実行します。

```bash
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env
pnpm run dev:web
```

`http://localhost:5173` で開きます。Mock モードは API サーバーや DB なしで MSW により動作します。
`VITE_API_MODE=mock|real` で切り替え、開発・テストの既定値は `mock`、本番ビルドは `real` のみ許可します。

実際の API と PostgreSQL をローカルで起動する手順は [ローカル API・DB 実行](operations/runbooks/local-database.v1.md)（韓国語）を参照してください。

## 検査コマンド

```bash
pnpm run format:check
pnpm run lint
pnpm run check:architecture
pnpm run typecheck
pnpm run test
pnpm run build
```

## 運用ドキュメント（韓国語）

- [デプロイ](operations/runbooks/deploy.v1.md)
- [バックアップからの復旧](operations/runbooks/recovery.v1.md)
- [最初の管理者の指定](operations/runbooks/first-admin.v1.md)
- [問題のインポート・公開](operations/runbooks/question-import.v1.md)
- [AWS 構成](infra/aws/README.md) · [月額費用](infra/aws/COST.md)
