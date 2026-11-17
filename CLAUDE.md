## project setup rules

- pnpm で setup すること（pnpm workspaces の monorepo）
    - `packages/core` = Google Calendar / Google Tasks のサービス層。runtime 非依存（fetch のみ。`node:*` 禁止）。`.claude/rules/shared.md`
    - `packages/cli` = core を使う CLI（tsx で実行。OAuth loopback / token 保存など Node 依存はここ）
    - `apps/mcp`（次フェーズ）= core を使う MCP server。Cloudflare Workers + Hono（`Variables.services` DI）。Cloudflare Access + MCP Server Portal 配下に置く
- 開発時の実行は tsx、build は tsdown を利用すること
    - package.json の `exports` / `publishConfig` / `bin` は tsdown の auto exports（`exports: { devExports: true }`）が生成する。手で書かないこと
    - subpath を増やすときは `tsdown.config.ts` の entry を追加して `pnpm build`
- pnpm fmt で oxfmt --write, oxlint --fix を実行すること
- pnpm lint で oxfmt --check, oxlint を実行すること
- `@typescript/native-preview`（tsgo）を利用すること
- 実装をする前にライブラリや Google / Cloudflare の仕様について知らないことがある時は context7, web で調査してから進めること
- vitest を利用した TDD で実装すること
- husky で commit 時に lint, typecheck を実行すること
- 勝手に commit しないこと
- 実装は小さいタスクに分けて実装すること。実装が終わったら difit を起動して私に review 依頼すること
- review で繰り返し受けた内容は rules, skills にすることで永続化して
    - review の内容はまず memory に記憶して繰り返し指摘されるものは skills にすること

## secrets rules

- Google OAuth の client secret / refresh token は commit しないこと（`.env`, `client_secret*.json`, `credentials*.json` は gitignore 済み）
- Workers の secret は `wrangler secret put` で設定し、`wrangler.jsonc` に書かないこと

## coding rules

- あなたは実装計画、ステークホルダーである私に対して要件のブレがなくなるまで AskUserQuestion で質問することに努め、実装は subagent に任せること
- 関数は単一責任で実装すること
- 同時に命令が複数来た時は Task で優先順位をつけて subagent に実装を任せること

## ref repository

既存実装を参照する前に ref repository の内容を先に探すこと。

@docs/ref.md

## comment rules
- `<--- ここから --->` `<--- ここまで --->` と書かれている場合はその範囲は commit しないこと
