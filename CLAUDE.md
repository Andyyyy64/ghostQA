# ghostqa — 要件定義書 & ロードマップ

> **AIが幽霊のようにブラウザを操作し、diffから潜在的なバグ・脆弱性・回帰を自動で狩り出すOSSツール**

---

## 0. 現在の実装ステータス（v0.1 進捗）

> 最終更新: 2026-03-03

### 動作確認済み（実際のデモで検証）

- **`ghostqa run`** — フルパイプラインが1コマンドで完走する
- **Diff 解析** — `git diff` → AI影響推定（4-6 impact areas 生成）
- **AI探索（Explorer）** — AIがブラウザを実操作し、バグを発見・evidence付きで報告
  - AXツリー＋スクショをAIに渡す observe → plan → act ループ
  - 意図的に仕込んだバグ3つ中3つを検出（typo, ロジックバグ, 表示バグ）
  - 各ステップのスクショ記録、discovery 時の証拠スクショ
  - console error の自動検出
  - JSON パース失敗時の多段リカバリ（壊れた JSON 修復、自然言語からアクション抽出）
- **動画記録** — Playwright native recording で `.webm` 動画を自動保存（デモ検証済み: 4.1MB）
- **HAR トレース** — ブラウザコンテキストの全 HTTP トラフィックを `trace.har` に記録
- **HTML レポート** — ダークテーマ、verdict カード、stats グリッド、discovery 詳細
- **JSON サマリー** — `summary.json` で機械可読な結果出力
- **CLI 4コマンド** — `init` / `run` / `view` / `doctor`（Playwright ブラウザ実存チェック対応）
- **AI プロバイダー** — Gemini API + CLI ツール（`claude -p`, `codex -q`）対応
- **コスト管理** — BudgetExceededError で予算超過時に部分レポート生成。CLI プロバイダーは文字数ベースのトークン推定でコスト概算表示
  - CLI プロバイダー（claude/codex）はレートリミット制。コスト表示ではなく `claude → /usage | codex → /status` への案内を表示
  - API プロバイダー（Gemini等）は従来通り USD 表示
  - 将来的に `/usage` `/status` の情報をプログラム的に取得できるようになれば、% 表示に対応する
- **ガードレール** — max_steps / max_duration / ループ検出 / budget チェック
- **SIGINT/SIGTERM** — Ctrl+C でブラウザ・アプリ・環境を安全にクリーンアップ

### 動くが改善の余地あり

- **Explorer discovery 報告** — AI が `discovery` フィールドに入れ忘れることがまれにある
- **CLI レートリミット表示** — 現在は案内テキストのみ。将来的にプログラム的に取得できれば % 表示に対応

### v0.5 で実装済み

- **Before/After 比較** — `ghostqa run --base <ref>` で base/head 両方実行、結果比較
- **Visual Diff** — pixelmatch ベースのスクショ比較（ヒートマップ出力）
- **Behavioral Diff** — console error の base/head 件数比較、delta 算出
- **GitHub Action** — `packages/action/` に action.yml + ラッパー実装。PR コンテキスト自動検出
- **PR コメント** — GitHub API 連携。Before/After テーブル、新規/修正イシュー表示
- **制約 (constraints)** — no_payment / no_delete / no_external_links / allowed_domains / forbidden_selectors
- **タスク別モデルルーティング** — `ai.routing` でタスクごとに異なる AI プロバイダー設定可能
- **`record` コマンド** — headed ブラウザで手動操作を録画
- **`validate` コマンド** — .ghostqa.yml のバリデーション + 設定サマリー表示

### 未実装（v1.0 ロードマップ — 優先順）

| 優先度 | 項目 | 概要 |
|--------|------|------|
| 1 | **プロバイダー拡充** | Anthropic API / OpenAI API 直接対応 + Gemini CLI 対応。現状 Gemini API + CLI (claude/codex) のみ → 主要3社 API + CLI を全カバー |
| 2 | **computer-use バックエンド** | Web 以外の GUI アプリ対応（CLI / Electron / Tauri）。ghostQA on ghostQA のドッグフーディング |
| 3 | **決定論リプレイモード** | Explorer の発見を Playwright テストに固定化。発見→テスト資産化 |
| 4 | **最小再現生成** | discovery の再現ステップを削減して最短手順を生成 |
| 5 | **Baseline 管理** | 承認済み Artifact Pack を保存し、CI での継続比較基準にする |
| 6 | **導入ガイド** | フレームワーク別（Next.js / Vite / Nuxt 等）クイックスタート |
| 並行 | **自プロジェクトのテスト強化** | Explorer 周りのカバレッジ改善。リファクタ耐性 |

**スコープ外（やらない）:**
- プラグイン機構（過剰設計）
- ダッシュボード / Slack / Discord 通知（CLI + GitHub Action で十分）
- Self-Consistency チェック（コスト2倍でメリット薄い）

### 技術スタック（実装済み）

| 項目 | 技術 |
|------|------|
| 言語 | TypeScript + Node.js v22 |
| パッケージマネージャ | pnpm v9 (workspace monorepo) |
| CLI | commander.js |
| AI (API) | @google/generative-ai (Gemini) |
| AI (CLI) | claude -p / codex -q (stdin pipe) |
| ブラウザ | Playwright (Chromium, headless) |
| Config | yaml + zod |
| ビルド | tsup (esbuild) |
| ログ | consola |
| プロセス実行 | execa v9 |

### プロジェクト構造

```
ghostqa/
├── packages/
│   ├── cli/          # ghostqa コマンド（init/run/view/doctor/validate/record）
│   ├── core/         # ビジネスロジック全体
│   │   └── src/
│   │       ├── ai/           # Provider パターン（Gemini / CLI）+ タスクルーティング
│   │       ├── comparator/   # Before/After 比較（behavioral + visual diff）
│   │       ├── config/       # Zod schema + YAML loader
│   │       ├── diff-analyzer/# git diff → AI 影響推定
│   │       ├── environment/  # Docker / native 環境管理
│   │       ├── app-runner/   # build → start → healthcheck
│   │       ├── explorer/      # AI 探索ループ
│   │       ├── recorder/     # 動画 / スクショ / console / HAR
│   │       ├── reporter/     # HTML / JSON レポート生成
│   │       ├── orchestrator/ # run-pipeline.ts（全体制御）
│   │       └── types/        # 共有型定義
│   ├── docker/       # Dockerfile + entrypoint.sh
│   └── action/       # GitHub Action（プレースホルダー）
└── examples/
    └── demo-app/     # Todo アプリ（動作検証用）
```

### GUI 操作のアーキテクチャ方針

ghostQA は Web QA 専用ツールではなく、**あらゆる GUI アプリのバグを AI が自動で狩るツール**。
Web は現在の主戦場だが、デスクトップアプリ（Electron / Tauri / ネイティブ）も将来スコープに入る。

**ハイブリッド方式を採用する:**

| 対象 | 操作方式 | 環境 |
|------|---------|------|
| Web アプリ | Playwright API（DOM セレクタ + AXツリー） | headless Chromium (native) |
| デスクトップアプリ | computer-use（スクショ → 座標クリック） | VM + Xvfb (docker/vm) |

- Web は Playwright の方が速く・正確・トークン効率が良い（AXツリーはスクショより軽い）
- 非 Web は Cursor Cloud Agent と同様の VM + computer-use API アプローチ
- `engine.mode` で切り替え: `native`（Playwright）/ `vm`（computer-use）

**モード判定:**
- `.ghostqa.yml` で `engine.mode` を明示指定していればそれに従う
- 未指定 or `auto` の場合、LLM がプロジェクト構成（ファイル一覧・package.json・設定ファイル等）を見て判定
- ルールベースのヒューリスティクスは使わない。プロジェクト構成は無限にパターンがあるので LLM に任せる
- diff 解析の前段で `project-analyzer` ステップとして実行

**実装方針:**
- Explorer の `observer` / `navigator` を抽象化し、Playwright 実装と computer-use 実装を差し替え可能にする
- v0.1: Playwright のみ（現状）
- v1.0: computer-use バックエンド追加、Electron / Tauri 対応、LLM モード判定

**参考:** [Cursor Agent Computer Use](https://cursor.com/ja/blog/agent-computer-use) — フル VM 内でエージェントがデスクトップ操作、動画証拠生成、self-validation ループ

### v0.1 成功基準の達成状況

| 基準 | 状態 |
|------|------|
| `ghostqa run` が1コマンドで完走する | ✅ 達成 |
| AIがブラウザを操作している様子が見える（スクショ） | ✅ 達成 |
| 既知のバグを少なくとも1つ検出できる | ✅ 達成（2-3個検出） |
| 動画が出力される | ✅ 達成（4.1MB .webm 検証済み） |
| 15秒デモGIFが作れる | ✅ 達成（327KB、動画から4x早送り生成） |

---

## 1. プロダクト概要

### 1.1 一言定義

ghostqa は、コード変更（diff）に対して隔離されたGUI環境でAIがアプリケーションを実際に操作し、アドリブ探索で潜在的なバグ・回帰・脆弱性を発見し、動画・スクショ・ログの「証拠パック」としてレポートするCLI / GitHub Actionツール。

### 1.2 コアバリュー

- **テスト未整備でも使える**：E2Eテストが0本でも、AIがdiffを読んで自動で探索する
- **証拠ベースのレビュー**：「壊れてないか？」を議論ではなく、Before/Afterの動画・スクショ・ログで判断できる
- **IDE / AIツール非依存**：Cursor / Claude Code / Codex / 手書き、どの開発フローでも同じ価値を提供
- **CLI + GitHub Action の両対応**：手元で即チェック、CIで自動ゲート

### 1.3 ターゲットユーザー

- AIコーディングツールを使って開発しているが、変更の品質に不安がある個人・チーム
- E2Eテストを書くリソースがないが、回帰は防ぎたいスタートアップ・小チーム
- "vibe coding" でプロトタイプを高速に作っている開発者

### 1.4 非ゴール（やらないこと）

- 全状態空間の完全網羅（戦略的カバレッジで現実的に攻める）
- LLMによる最終合否判定（判定は観測事実ベース。AIは「発見」と「説明」を担当）
- Windows/macOSネイティブアプリの対応（v1.0 で computer-use バックエンド追加後に検討）
- セキュリティスキャナの代替（SAST/DAST専用ツールの領域には踏み込まない）

---

## 2. 全体アーキテクチャ

### 2.1 処理フロー（全体像）

```
┌─────────────────────────────────────────────────────────────┐
│  1. トリガー                                                  │
│     PR作成 / CLI手動実行                                      │
│     ↓                                                        │
│  2. diff取得 & 影響範囲推定                                    │
│     git diff → 変更ファイル/関数/コンポーネント抽出              │
│     LLMが「どの画面・フローに影響するか」を推定                  │
│     ↓                                                        │
│  3. 隔離環境の起動                                             │
│     Docker + Xvfb + Chromium + ffmpeg                        │
│     ↓                                                        │
│  4. base側でアプリをビルド & 起動                               │
│     build_command → start_command → healthcheck待ち            │
│     ↓                                                        │
│  5. AI探索 & 発見                                              │
│     AIがブラウザを実際に操作、影響画面を巡回                     │
│     リアルタイム判断でクラッシュ/エラー/崩れを発見               │
│     ↓                                                        │
│  6. 証拠記録                                                   │
│     動画 / スクショ / console / network / 操作トレース          │
│     ↓                                                        │
│  7. head側で同じことを実行（4→5→6）                            │
│     ↓                                                        │
│  8. Before/After 比較                                          │
│     Visual diff（スクショ）+ Behavioral diff（ログ/挙動）       │
│     ↓                                                        │
│  9. レポート返却                                               │
│     PRコメント / HTMLレポート / CLI出力                         │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 AI探索アーキテクチャ（ghostqaの核心設計）

ghostqa の核心は **AI Explorer**。AIがブラウザ上でリアルタイムに操作し、diffの影響範囲を自律的に探索する。

- AIがブラウザ上でリアルタイムに操作し、影響のある画面を探索
- 画面の見た目、遷移の自然さ、エラーの有無をその場で判断
- 「テストコードでは書きにくい異常」（レイアウト崩れ、フリーズ、無限ローディング、クリック不能）を発見
- observe → plan → act ループで自律的に探索を進める
- console error の自動検出 + AI による視覚的・機能的バグの発見

---

## 3. 入力仕様

### 3.1 設定ファイル（`.ghostqa.yml`）

```yaml
# .ghostqa.yml — リポジトリルートに配置
version: 1

# ─── アプリケーション設定 ───
app:
  build: "pnpm i --frozen-lockfile && pnpm build"
  start: "pnpm start --port 3000"
  healthcheck_url: "http://127.0.0.1:3000/health"
  healthcheck_timeout_s: 60
  target_url: "http://127.0.0.1:3000/"

# ─── 実行環境 ───
engine:
  mode: "docker"                    # docker | native
  docker_image: "ghostqa/runner:latest"
  viewport: { width: 1440, height: 900 }
  locale: "ja-JP"
  timezone: "UTC"
  video: true
  screenshots: "step"               # step | transition | off
  network_har: true

# ─── AI設定 ───
ai:
  model: "claude-sonnet-4-20250514"
  provider: "anthropic"
  api_key_env: "ANTHROPIC_API_KEY"
  temperature: 0.2
  max_steps: 80                      # 探索の最大操作回数
  max_minutes: 10                    # 探索の最大実行時間
  budget:
    max_cost_usd_per_run: 5.0        # 1回の実行あたりのコスト上限

# ─── 制約 ───
constraints:
  no_payment: true                   # 課金操作禁止
  no_delete: true                    # 削除操作禁止
  no_external_links: true            # 外部ドメイン遷移禁止
  allowed_domains:
    - "127.0.0.1"
    - "localhost"

# ─── Visual Diff 設定 ───
visual:
  pixel_threshold: 0.1               # 色差の下限
  area_threshold: 0.5                # 変化面積%の閾値
  mask_selectors:                    # 動的領域のマスク
    - "[data-testid='timestamp']"
    - ".ad-banner"
    - "[data-random-id]"
  stabilization:
    force_reduced_motion: true
    wait_for_network_idle: true
    wait_for_fonts: true

# ─── 判定ポリシー ───
policy:
  fail_on:
    - "page_crash"
    - "uncaught_exception"
    - "console_error_count > 3"
    - "http_5xx_count > 0"
    - "visual_area_over_threshold"
  warn_on:
    - "console_warn_spike"
    - "http_4xx_increase"
    - "minor_visual_diff"

# ─── レポート ───
report:
  format: "html"                     # html | json | markdown
  language: "ja"                     # ja | en
  include_video: true
  include_trace: true
```

### 3.2 ユーザーが用意するもの

**必須：**

- `.ghostqa.yml`（上記）
- ビルド可能なWebアプリケーション（Node.js / Python 等）

**任意（精度向上）：**

- `credentials`：テスト用アカウント情報（環境変数参照）
- `seed_script`：テストデータ初期化スクリプト
- `ui_hints`：ログイン手順の注意点、重要なセレクタ等
- 既存のPlaywright / Cypressテスト（あれば探索の参考に活用）

---

## 4. 出力仕様（証拠パック）

### 4.1 成果物ディレクトリ構造

```
.ghostqa-runs/
└── <run_id>/
    ├── report.html                      # メインレポート（ブラウザで開く）
    ├── summary.json                     # 機械可読サマリ
    ├── base/                            # baseコミット側の成果物
    │   ├── videos/
    │   │   ├── login_and_dashboard.mp4
    │   │   └── profile_update.mp4
    │   ├── screenshots/
    │   │   ├── login_and_dashboard/
    │   │   │   ├── step_001.png
    │   │   │   ├── step_002.png
    │   │   │   └── ...
    │   │   └── profile_update/
    │   │       └── ...
    │   ├── logs/
    │   │   ├── console.json             # console.log/error/warn
    │   │   ├── network.har              # HAR形式
    │   │   └── app_stdout.log           # アプリのstdout/stderr
    │   └── traces/                      # 探索トレース
    ├── head/                            # headコミット側（同構造）
    │   └── ...
    ├── diff/                            # 比較結果
    │   ├── visual/
    │   │   ├── login_and_dashboard/
    │   │   │   ├── step_002_before.png
    │   │   │   ├── step_002_after.png
    │   │   │   └── step_002_diff.png    # ヒートマップ
    │   │   └── ...
    │   └── behavioral.json              # ログ差分サマリ
    ├── discoveries/                     # AI探索で発見した異常
    │   ├── discovery_001/
    │   │   ├── screenshot.png
    │   │   ├── video_clip.mp4           # 該当箇所の切り出し
    │   │   ├── description.md           # AIによる説明
    │   │   └── reproduction_steps.json  # 再現手順
    │   └── ...
    └── meta.json                        # 実行メタ情報
```

### 4.2 `summary.json` の構造

```json
{
  "run_id": "ghostqa-20260302-abc123",
  "commit_base": "abc1234",
  "commit_head": "def5678",
  "timestamp": "2026-03-02T10:30:00Z",
  "verdict": "FAIL",
  "duration_s": 245,
  "cost_usd": 1.23,
  "explorer": {
    "pages_visited": 13,
    "steps_taken": 25,
    "discoveries": 1,
    "discovery_summaries": [
      "保存ボタン押下後に500エラー。設定画面が無限ローディング状態に陥る"
    ]
  },
  "total_discoveries": 1,
  "console_errors": { "base": 0, "head": 3 },
  "network_failures": { "base": 0, "head": 1 }
}
```

### 4.3 PRコメントのフォーマット

```markdown
## 👻 ghostqa Report

**Verdict: ❌ FAIL** | ⏱ 4m 5s | 💰 $1.23

### Results

| Category | Result | Verdict |
|----------|--------|---------|
| Explorer (探索) | 1 discovery | ❌ FAIL |

### ❌ Failures

**Explorer (discovery)**
保存ボタン押下後に500エラー。設定画面が無限ローディング状態に陥る
📸 [スクショ](link) | 🎬 [動画](link) | 🔁 [再現手順](link)

### 📊 Console / Network
| | base | head | diff |
|--|------|------|------|
| console.error | 0 | 3 | +3 ⚠️ |
| HTTP 5xx | 0 | 1 | +1 ⚠️ |

> 生成テスト・動画・詳細レポートは [Artifacts](link) からダウンロード可能
```

---

## 5. コンポーネント設計

### 5.1 コンポーネント一覧

```
ghostqa/
├── cli/                    # CLIエントリポイント
├── core/
│   ├── diff-analyzer/      # diff取得 → 影響範囲推定
│   ├── environment/        # 隔離環境の起動・管理（Docker/native）
│   ├── app-runner/         # アプリのビルド・起動・ヘルスチェック
│   ├── explorer/            # AI探索
│   │   ├── navigator/      # GUI操作（クリック/入力/スクロール/待機/戻る）
│   │   ├── observer/       # 画面状態理解（DOM/AXツリー/スクショ/ログ）
│   │   ├── planner/        # 探索計画（影響範囲→巡回順序）
│   │   └── discoverer/     # 異常検出（クラッシュ/エラー/崩れ/フリーズ）
│   ├── recorder/           # 動画・スクショ・ログの記録
│   ├── comparator/         # Before/After比較（visual + behavioral）
│   └── reporter/           # レポート生成（HTML/JSON/PRコメント）
├── action/                 # GitHub Action wrapper
├── docker/                 # Dockerイメージ定義
└── docs/
```

### 5.2 diff-analyzer

**責務：** git diffから「何が変わったか」「どこに影響するか」を抽出し、Explorerに渡す。

**処理：**
1. `git diff base...head` でファイル一覧と変更内容を取得
2. 静的解析で変更された関数/コンポーネント/ルートを特定
   - TypeScript/TSX：AST解析（ts-morph等）
   - Python：AST解析（ast module）
3. LLMに diff + プロジェクト構造を渡し、影響する画面・コンポーネントを推定
4. 出力：`ImpactReport`（影響画面、影響コンポーネント、優先度）

### 5.3 explorer（AI探索）

**責務：** ブラウザ上でAIがリアルタイムに操作し、潜在的な異常を発見する。

**処理：**
1. `ImpactReport` から影響画面の優先リストを受け取る
2. AIがブラウザを操作：
   - 影響画面へ遷移
   - 各画面で操作（ボタン押下、フォーム入力、タブ切替、スクロール等）
   - 予期しない経路も探索（Edge case的な操作順序）
3. 各ステップで異常を検出：
   - ページクラッシュ
   - JavaScriptの未処理例外
   - console.error の発生
   - HTTP 5xx/4xx レスポンス
   - レイアウト崩れ（要素の重なり、はみ出し、非表示）
   - フリーズ / 無限ローディング（一定時間操作不能）
   - クリック不能な要素
   - 空白ページ / 真っ白画面
4. 異常発見時：スクショ + 動画切り出し + 再現手順 + AIによる説明を記録

**探索のガードレール：**
- `max_steps` 超過で強制終了
- `max_minutes` 超過で強制終了
- `constraints` で禁止された操作（削除/課金/送信等）は実行前にブロック
- `allowed_domains` 外への遷移はブロック
- 同じ画面で同じ操作を3回以上繰り返したらスキップ（ループ防止）

### 5.5 comparator

**責務：** base と head の成果物を比較し、差分を定量化する。

**Visual Diff：**
- アルゴリズム：pixel diff + SSIM の併用
- 出力：before / after / diff（ヒートマップ）の3枚セット
- ノイズ対策：
  - `mask_selectors` で指定された要素を除外
  - `force_reduced_motion: true` でアニメーション抑制
  - フォント固定（Noto Sans同梱）
  - ネットワークアイドル待ち + フォントロード待ち

**Behavioral Diff：**
- console.error / warn の件数比較（増減）
- network 失敗リクエストの件数比較
- HTTP ステータスコード分布の変化

### 5.6 reporter

**責務：** 全成果物を集約し、人間が判断しやすいレポートを生成する。

**出力形式：**
- HTML：スタンドアロンで開ける。動画埋め込み、diff画像インライン表示、インタラクティブなフィルタ
- JSON：CIツールやダッシュボードとの連携用
- Markdown：PRコメント用（GitHub Actions経由）

**レポートの構成：**
1. サマリ（verdict、所要時間、コスト、Explorer結果）
2. Failures & Discoveries（失敗詳細 + 動画/スクショリンク）
3. Visual Diff ギャラリー（before/after/diff を並べて表示）
4. Console / Network 比較表
5. AI探索トレース（操作ログ + 判断理由）

---

## 6. CLI仕様

### 6.1 コマンド一覧

```bash
# 初期化：設定ファイル雛形を生成
ghostqa init

# メイン実行：base/headで検証してレポート生成
ghostqa run [--base <ref>] [--head <ref>] [--engine docker|native]

# レポート閲覧：生成済みレポートをブラウザで開く
ghostqa view [<run_id>]

# 環境チェック：依存関係の確認と対処法表示
ghostqa doctor

# 設定検証：.ghostqa.yml のバリデーション
ghostqa validate
```

### 6.2 `ghostqa run` の詳細

```bash
ghostqa run

# オプション
--base <ref>          # 比較元（デフォルト：origin/main との merge-base）
--head <ref>          # 比較先（デフォルト：HEAD）
--engine docker|native  # 実行環境（デフォルト：docker）
--no-explore          # AI探索をスキップ
--no-video            # 動画を記録しない（高速化）
--verbose             # 詳細ログ出力
--output <dir>        # 成果物出力先（デフォルト：.ghostqa-runs/）
```

**実行フロー：**
1. `.ghostqa.yml` を読み込み・バリデーション
2. base/head のコミットを確定
3. 隔離環境を起動（Docker or native）
4. base側：ビルド→起動→ヘルスチェック→AI探索→記録
5. head側：同上
6. 比較（visual + behavioral）
7. レポート生成
8. verdict を exit code で返す（0=PASS、1=FAIL、2=WARN）

### 6.3 `ghostqa init` が生成するもの

```
.ghostqa.yml          # 設定ファイル（コメント付き雛形）
.ghostqa/
└── Dockerfile        # カスタムランナーが必要な場合用
```

---

## 7. GitHub Action仕様

### 7.1 ワークフロー例

```yaml
# .github/workflows/ghostqa.yml
name: ghostqa
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  ghostqa:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0    # full history for diff

      - uses: ghostqa/action@v0
        with:
          config: .ghostqa.yml
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          TEST_USER: ${{ secrets.TEST_USER }}
          TEST_PASS: ${{ secrets.TEST_PASS }}
```

### 7.2 Action の出力

- **Check Run**：PASS / FAIL / WARN（PRのステータスチェック）
- **PRコメント**：セクション4.3のフォーマットで投稿
- **Artifacts**：証拠パック一式をGitHub Actions Artifactsにアップロード（90日保持）

---

## 8. セキュリティ要件

### 8.1 隔離

- 全実行はDocker コンテナ内（デフォルト）
- ホストファイルシステムへのアクセスは最小限（ソースコードのread-only マウント + 成果物出力ディレクトリ）
- ネットワークは `allowed_domains` で制限可能

### 8.2 Secrets 保護

- fork PRでは secrets を注入しない（デフォルト）
- 環境変数経由でのみsecrets を渡す（設定ファイルにハードコードしない）
- ログ・スクショ・動画内の秘密情報をredaction（メール、トークン、パスワード等のパターンマッチ）

### 8.3 破壊操作の防止

- `constraints` で禁止された操作は、AIの操作指示段階でブロック
- 「送信」「購入」「削除」等のボタンはデフォルト禁止リストに含める
- 許可する場合は明示的に `constraints` で解除

---

## 9. AIモデル設定（詳細）

### 9.1 現在の実装

**API プロバイダー:** Gemini API（`@google/generative-ai`）
**CLI プロバイダー:** `claude -p` / `codex -q`（stdin pipe）
**タスク別ルーティング:** `ai.routing` で実装済み（v0.5）

```yaml
ai:
  provider: gemini                    # gemini | cli
  model: gemini-2.0-flash
  max_budget_usd: 5.0
  cli:
    command: claude                   # claude | codex
```

### 9.2 v1.0 で追加するプロバイダー

| プロバイダー | 種別 | 方式 |
|-------------|------|------|
| Anthropic (Claude) | API | `@anthropic-ai/sdk` 直接呼び出し |
| OpenAI | API | `openai` SDK 直接呼び出し |
| Gemini CLI | CLI | `gemini` コマンドを stdin pipe |

**v1.0 完了後のプロバイダー全体像:**

| 種別 | Anthropic | OpenAI | Google |
|------|-----------|--------|--------|
| API | `anthropic` | `openai` | `gemini`（実装済み） |
| CLI | `claude -p`（実装済み） | `codex -q`（実装済み） | `gemini`（v1.0） |

### 9.3 タスク別ルーティング（実装済み）

```yaml
ai:
  provider: gemini
  model: gemini-2.0-flash
  max_budget_usd: 3.0
  routing:
    diff_analysis:
      provider: cli
      cli:
        command: claude
    ui_control:
      provider: gemini
      model: gemini-2.0-flash
```

### 9.4 v1.0 でのルーティング例（全プロバイダー対応後）

```yaml
ai:
  provider: anthropic                  # デフォルト
  model: claude-sonnet-4-20250514
  max_budget_usd: 5.0
  routing:
    diff_analysis:
      provider: anthropic
      model: claude-sonnet-4-20250514
    ui_control:
      provider: gemini                 # vision が安い
      model: gemini-2.0-flash
    triage:
      provider: openai
      model: gpt-4o-mini              # 安いモデルで十分
```

---

## 10. ロードマップ

---

### v0.1 — "動くデモ"（目標：2-3週間）

> **ゴール：「ghostqa run → AIがブラウザ触って → 動画とレポートが出る」を体験できる最小形**

#### スコープ

| 項目 | 内容 |
|------|------|
| 対象 | Webアプリのみ（React / Next.js / Vue / 静的サイト等） |
| 実行環境 | Docker + Xvfb + Chromium + ffmpeg |
| AI | Anthropic API 1モデル固定（Claude Sonnet） |
| AI探索 | AI探索あり（影響画面の巡回 + 異常検出） |
| 比較 | head側のみ実行（Before/After比較はなし。まず"head で動くか"だけ） |
| レポート | HTMLレポート（ローカルで開く） |
| CLI | `init` / `run` / `view` / `doctor` |
| GitHub Action | なし（CLIのみ） |

#### v0.1 でやらないこと

- Before/After比較（base側の実行）
- Visual diff（スクショ比較）
- GitHub Action / PRコメント
- タスク別モデルルーティング
- Baseline管理
- 最小再現生成
- record コマンド

#### v0.1 の体験（ユーザーストーリー）

```bash
# 1. インストール
npm install -g ghostqa

# 2. 初期化
cd my-project
ghostqa init
# → .ghostqa.yml が生成される

# 3. 実行
export ANTHROPIC_API_KEY=sk-...
ghostqa run

# 4. 結果
# → ターミナルに verdict（PASS/FAIL）表示
# → .ghostqa-runs/<id>/report.html をブラウザで開くと：
#    - AIが操作した動画
#    - 各ステップのスクショ
#    - 発見した異常（あれば）
#    - console/networkログ
```

#### v0.1 の成功基準

- `ghostqa run` が1コマンドで完走する
- 動画が出力される（AIがブラウザを操作している様子が見える）
- 既知のバグ（意図的に壊したページ）を少なくとも1つ検出できる
- 15秒デモGIFが作れる

---

### v0.5 — "PRで使える"（目標：v0.1 から +4-6週間）

> **ゴール：GitHub Actionで「PRを出すたびにghostqaが走る」状態。Before/After比較が入り、チーム開発で実用可能に。**

#### v0.1 → v0.5 で追加するもの

| 項目 | 内容 |
|------|------|
| Before/After比較 | base側でもアプリ起動・テスト実行・探索を行い、head側と比較 |
| Visual Diff | スクショのpixel diff + SSIM + ヒートマップ生成 |
| Behavioral Diff | console/network のbase/head件数比較 |
| GitHub Action | PRで自動実行 → Check Run + PRコメント + Artifacts |
| タスク別モデル | diff解析/UI操作/要約を別モデルに振り分け可能 |
| 制約 (constraints) | no_payment / no_delete / no_external_links / allowed_domains / forbidden_selectors |
| `validate` コマンド | .ghostqa.yml のバリデーション + 設定サマリー表示 |
| `record` コマンド | headed ブラウザで手動操作を録画 |

#### v0.5 の体験

```bash
# ローカルで Before/After 比較
ghostqa run --base origin/main --head HEAD

# → レポートに before/after/diff のスクショ3枚セット
# → visual diff のヒートマップで「どこが変わったか」一目瞭然
# → 生成テストの pass/fail 差分
```

```yaml
# GitHub Action でPRに自動コメント
# PRを出すだけで ghostqa が走り、結果がコメントされる
```

#### v0.5 の成功基準

- PRを出すと自動でghostqaが実行され、コメントが付く
- Before/After の Visual Diff が実際に回帰を検出できる
- チームメンバーが「PRにghostqaの結果が付いてると安心」と感じる

---

### v1.0 — "選ばれるツール"（目標：v0.5 から +2-3ヶ月）

> **ゴール：Web 以外の GUI アプリにも対応し、OSS として成熟。コミュニティが使い始める品質。**

#### v0.5 → v1.0 で追加するもの（優先順）

| 優先度 | 項目 | 内容 |
|--------|------|------|
| 1 | **プロバイダー拡充** | Anthropic API / OpenAI API 直接対応 + Gemini CLI 対応。主要3社（Anthropic / OpenAI / Google）の API + CLI を全カバー |
| 2 | **computer-use バックエンド** | スクショ → 座標クリックで任意の GUI アプリを操作。Explorer の observer/navigator を抽象化し、Playwright 実装と computer-use 実装を差し替え可能に。ghostQA 自身の CLI を ghostQA でテストするドッグフーディング |
| 3 | **決定論リプレイモード** | Explorer の探索結果を Playwright テストに固定化 → 以後は決定論実行。発見→テスト資産化 |
| 4 | **最小再現生成** | FAIL 時にステップを削減して最短の再現手順を生成 |
| 5 | **Baseline 管理** | 承認済み Artifact Pack を保存し、次回比較の基準にする |
| 6 | **導入ガイド** | フレームワーク別クイックスタート（Next.js / Vite / Nuxt 等）、トラブルシューティング |
| 並行 | **テスト強化** | Explorer 周りのユニットテスト・E2E テスト拡充 |

#### スコープ外（やらない）

- プラグイン機構（過剰設計。必要になったら検討）
- ダッシュボード / Slack / Discord 通知（CLI + GitHub Action で十分）
- Self-Consistency チェック（コスト2倍でメリット薄い）

#### v1.0 の成功基準

- GitHub 1000★ 到達
- Web 以外のアプリ（CLI / Electron）で ghostQA が動作する
- 週次アクティブユーザー（CLIダウンロード or Action実行）が安定して増加
- 外部からのPR/Issue が定期的に来る

---

## 11. ローンチ戦略（1000★への導線）

### フェーズ1：v0.1 リリース時

1. **15秒デモGIF** を先に作る（「AIが勝手にブラウザ触ってバグ見つけた」の瞬間）
2. **README** を完成させる（GIF + 1行価値 + `npm i -g ghostqa && ghostqa run` の3要素）
3. **X（旧Twitter）** でデモ動画付き投稿（英語 + 日本語）
4. **Hacker News（Show HN）** に投稿

### フェーズ2：v0.5 リリース時

5. **Reddit**：r/programming / r/webdev / r/MachineLearning
6. **Product Hunt** ローンチ
7. **Qiita / Zenn** で日本語導入記事

### フェーズ3：継続

8. awesome-xxx への掲載依頼
9. カンファレンスLT / ブログ記事
10. ユーザー事例の収集 → READMEに掲載
