# google-calendar-tasks

Google Calendar と Google Tasks を Claude から扱うための MCP サーバーと CLI。

pnpm workspaces の monorepo。Google API を叩くサービス層（`packages/core`）を runtime 非依存（`fetch` のみ）で作り、それを CLI（Node）と MCP サーバー（Cloudflare Workers）の両方から使っています。

```
packages/core   Calendar / Tasks のサービス層（neverthrow ResultAsync + zod、runtime 非依存）
packages/cli    `gct` CLI（gunshi、OAuth loopback + PKCE、トークンは ~/.config/gct に保存）
apps/mcp        MCP サーバー（Hono on Cloudflare Workers、Cloudflare Access 配下）
```

## できること

Claude のチャットから、こんな頼み方で使えます。

- 「今日と明日の予定と、期限切れのタスクをまとめて」
- 「来週火曜 15 時から 1 時間『定例』を入れて。Meet 付きで」
- 「来週の空き時間を出して」
- 「タスクボード見せて」 → カンバンが会話の中に表示され、ドラッグで状態を変えられます
- 「『引っ越しの準備』を進行中にして」
- 「日常タスクの完了済みを片付けて」

### MCP ツール（44 個）

| 分類             | ツール                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 予定             | `list_events` `get_event` `create_event` `update_event` `delete_event` `move_event` `quick_add_event` `import_event` `list_event_instances`           |
| 空き時間         | `query_freebusy`                                                                                                                                      |
| カレンダー       | `list_calendars` `get_calendar` `create_calendar` `update_calendar` `delete_calendar` `clear_calendar`                                                |
| カレンダーリスト | `get_calendar_list_entry` `subscribe_calendar` `update_calendar_list_entry` `unsubscribe_calendar`                                                    |
| 共有（ACL）      | `list_calendar_acl` `get_calendar_acl_rule` `share_calendar` `update_calendar_acl_rule` `unshare_calendar`                                            |
| 色・設定         | `get_colors` `list_settings` `get_setting`                                                                                                            |
| タスク           | `list_tasks` `get_task` `create_task` `update_task` `complete_task` `reopen_task` `delete_task` `move_task` `clear_completed_tasks` `set_task_status` |
| タスクリスト     | `list_task_lists` `get_task_list` `create_task_list` `rename_task_list` `delete_task_list`                                                            |
| MCP App          | `show_task_board`                                                                                                                                     |

### 設計方針

- **読み出しは正規化**：LLM が次の呼び出しにそのまま使えるよう、id を必ず含め、時刻はオフセット付きで返し、etag などのノイズは落とします。`list_tasks` は親タスクの直後にサブタスクが並ぶアウトライン順で、`depth` と `parentId` を持ちます。
- **書き込みは厳格**：不正な入力は推測で補わずに拒否し、何が悪いか・正しい形式・次に呼ぶツールをエラーで返します。
- **破壊的な操作は明示的**：削除は更新とは別の専用ツールに分けています。カレンダーの全予定削除（`clear_calendar`）、完了済みタスクの一括非表示（`clear_completed_tasks`）、owner 権限での共有には、確認用の `confirm` 引数を必須にしています。
- **通知は既定でしない**：`sendUpdates` を指定しない限り、参加者にメールは飛びません。

### タスクボードと状態タグ

`show_task_board` は [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) の UI（`ui://gct/task-board.html`）を返し、Claude の会話の中にカンバンを描画します。列（todo / doing / done）は、タスクのメモの 1 行目にあるタグで決まります。

```
[status: doing]
ここから下は普通のメモ
```

- タグがなければ todo、Google 側で完了済みなら done として扱います。
- ボードでカードを移動するか `set_task_status` を呼ぶと、タグが書き換わります。done に移すと Google 側でも完了になります。
- Google Tasks アプリでメモの 1 行目を直接書き換えても反映されます。

## MCP サーバーの構成

```
Claude ──▶ Cloudflare MCP Server Portal ──▶ Cloudflare Access ──▶ Worker (/mcp)
                                                                     │  Access JWT の email で
                                                                     ▼  Durable Object を選ぶ
                                                       GoogleTokenStore (SQLite DO)
                                                                     │  refresh token
                                                                     ▼
                                                       Google Calendar / Tasks API
```

- 利用者の認証は Cloudflare Access が行い、Worker は `Cf-Access-Jwt-Assertion` を検証して email を得ます。
- Access は IdP の Google トークンを origin に渡さないため、Google API 用の OAuth は Worker が別に持ちます（`/google/connect` → `/google/callback`）。refresh token は email ごとの Durable Object に保存します。
- ツールは Calendar（予定・カレンダー・ACL・freebusy など）と Tasks（タスク・タスクリスト）をほぼ全 API カバーしています。読み出しは LLM 向けに正規化し、書き込みは不正な入力を推測で補わずに拒否します。
- `show_task_board` は [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) のカンバンボードを返します。列はタスクのメモ 1 行目のタグ `[status: todo|doing|done]` で決まります。
- サーバーの `instructions` で既定（Asia/Tokyo、参加者への通知は明示時のみ、既定タスクリスト `DEFAULT_TASK_LIST`）をクライアントに伝えます。

## Tech Stack

| 領域           | 採用技術                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------- |
| MCP            | `@modelcontextprotocol/server`（Streamable HTTP, stateless）+ `@modelcontextprotocol/ext-apps` |
| Server         | [Hono](https://hono.dev/) on Cloudflare Workers + Durable Objects（`cf` CLI でデプロイ）       |
| CLI            | [gunshi](https://github.com/kazupon/gunshi) + tsx                                              |
| Errors / Async | [neverthrow](https://github.com/supermacro/neverthrow) + error classes                         |
| Validation     | [zod](https://zod.dev/)                                                                        |
| Dates          | dayjs（utc + timezone）                                                                        |
| Build          | [tsdown](https://tsdown.dev/)（auto exports）                                                  |
| Lint / Format  | [oxlint](https://oxc.rs/) + oxfmt                                                              |
| Type Check     | [`@typescript/native-preview`](https://github.com/microsoft/typescript-go)（`tsgo`）           |
| Test           | [Vitest](https://vitest.dev/)                                                                  |

## Setup

```bash
pnpm install
```

### Google Cloud

1. Google Cloud のプロジェクトで **Google Calendar API** と **Google Tasks API** を有効にします。
2. OAuth 同意画面を作り、スコープ `https://www.googleapis.com/auth/calendar` と `https://www.googleapis.com/auth/tasks` を追加します。テスト中のままだと refresh token が 7 日で切れるので、使い続けるなら本番に公開します。
3. OAuth クライアントを用途ごとに作ります。
   - CLI 用：**デスクトップ アプリ**
   - MCP サーバー用：**ウェブ アプリケーション**。承認済みリダイレクト URI に `https://<host>/google/callback` を登録します。

### CLI

```bash
cp packages/cli/.env.example packages/cli/.env   # GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を記入
pnpm cli login                                   # ブラウザで Google にログイン（loopback + PKCE）
pnpm cli events list
pnpm cli tasks list
```

| コマンド                          | 内容                                       |
| --------------------------------- | ------------------------------------------ |
| `gct login` / `logout` / `status` | ログイン、トークンの失効と削除、状態の確認 |
| `gct calendars`                   | カレンダー一覧                             |
| `gct events`                      | 予定の一覧・表示・作成・更新・削除         |
| `gct freebusy`                    | 空き時間の確認                             |
| `gct tasklists`                   | タスクリストの一覧・追加・名前変更・削除   |
| `gct tasks`                       | タスクの一覧・追加・更新・完了・再開・削除 |

各コマンドの詳細は `pnpm cli <command> --help` で確認できます。

### MCP サーバー

1. Cloudflare Zero Trust で、Worker のホスト（例：`gct.example.com`）全体を守る self-hosted の Access アプリを作り、AUD タグを控えます。
2. `apps/mcp/cloudflare.config.ts` に、mode（`staging` / `production`）ごとの Worker 名・ドメイン・Access の team / AUD・リダイレクト URI と、Google OAuth クライアント（ウェブ アプリ）の id を書きます。
3. client secret を Worker secret `GOOGLE_CLIENT_SECRET` として設定します。ローカル開発では `apps/mcp/.dev.vars` に置きます（gitignore 済み）。
4. デプロイします。

   ```bash
   pnpm --filter @napolab/gct-mcp deploy:staging
   pnpm --filter @napolab/gct-mcp deploy:production
   ```

5. ブラウザで `https://<host>/` を開き、Connect Google から Google を接続します。
6. Cloudflare の MCP Server Portal に `https://<host>/mcp` を MCP サーバーとして登録し、Claude からは Portal の URL をコネクタとして追加します。

| 環境変数                                   | 内容                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`  | Access JWT の検証に使う team と AUD                                                         |
| `GOOGLE_CLIENT_ID` / `GOOGLE_REDIRECT_URI` | Worker 用の Google OAuth クライアント                                                       |
| `GOOGLE_CLIENT_SECRET`                     | 同上の secret（Worker secret）                                                              |
| `DEFAULT_TASK_LIST`                        | `list` を省略したときに使うタスクリスト（タイトルか id。`@default` で Google の既定リスト） |

## Scripts

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `pnpm lint`       | oxfmt --check + oxlint                   |
| `pnpm fmt`        | oxfmt --write + oxlint --fix             |
| `pnpm typecheck`  | tsgo --noEmit                            |
| `pnpm test`       | vitest run --typecheck                   |
| `pnpm build`      | tsdown（package.json の exports を生成） |
| `pnpm cli <args>` | CLI をソースから実行                     |

## License

[MIT](LICENSE)
