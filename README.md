# google-calendar-tasks

Google Calendar と Google Tasks を Claude から扱うための MCP サーバーと CLI。

pnpm workspaces の monorepo。Google API を叩くサービス層（`packages/core`）を runtime 非依存（`fetch` のみ）で作り、それを CLI（Node）と MCP サーバー（Cloudflare Workers）の両方から使っています。

```
packages/core   Calendar / Tasks のサービス層（neverthrow ResultAsync + zod、runtime 非依存）
packages/cli    `gct` CLI（gunshi、OAuth loopback + PKCE、トークンは ~/.config/gct に保存）
apps/mcp        MCP サーバー（Hono on Cloudflare Workers、Cloudflare Access 配下）
```

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

### CLI

Google Cloud で Calendar API / Tasks API を有効にし、OAuth クライアント（デスクトップ アプリ）を作って `packages/cli/.env` に書きます。

```bash
cp packages/cli/.env.example packages/cli/.env
pnpm cli login
pnpm cli events list
pnpm cli tasks list
```

### MCP サーバー

`apps/mcp/cloudflare.config.ts` に Cloudflare アカウント、Access の team / AUD、Google OAuth クライアント（ウェブ アプリ）の id、リダイレクト URI を mode（`staging` / `production`）ごとに書きます。client secret は Worker secret（`GOOGLE_CLIENT_SECRET`）として設定し、ローカルでは `apps/mcp/.dev.vars` に置きます。

```bash
pnpm --filter @napolab/gct-mcp deploy:staging
pnpm --filter @napolab/gct-mcp deploy:production
```

デプロイ後、ブラウザで `https://<host>/` を開いて Google を接続し、MCP Server Portal に `https://<host>/mcp` を登録します。

## Scripts

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `pnpm lint`       | oxfmt --check + oxlint                   |
| `pnpm fmt`        | oxfmt --write + oxlint --fix             |
| `pnpm typecheck`  | tsgo --noEmit                            |
| `pnpm test`       | vitest run --typecheck                   |
| `pnpm build`      | tsdown（package.json の exports を生成） |
| `pnpm cli <args>` | CLI をソースから実行                     |
