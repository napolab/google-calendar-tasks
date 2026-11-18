# サブタスクを別カードにするタスクボード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** タスクボードでサブタスクを 1 枚のカードにし、各タスク自身の状態の列に並べる。親カードには列ごとの内訳、サブタスクには「↳ 親タイトル」を出す。

**Architecture:** `buildBoard` で、アウトライン順のタスクをすべて平らなカードにする（カードは `nesting` で root / subtask / orphan を区別する）。並べ替えは「兄弟」（同じリストで同じ親）の間だけ許可する。そのために `ReorderPlan` / `PendingOp` に親を持たせ、楽観的更新と `move_task` の `parentId` まで通す。

**Tech Stack:** TypeScript（strict）、vitest、素の DOM（`view`）、MCP Apps（`@modelcontextprotocol/ext-apps`）

**Spec:** `docs/superpowers/specs/2026-11-18-subtask-cards-design.md`

## Global Constraints

- 作業ディレクトリは `apps/mcp`。テストは `pnpm --filter ./apps/mcp test`、最後に repo root で `pnpm lint && pnpm typecheck`
- **commit しない**（CLAUDE.md「勝手に commit しないこと」）。全タスクが終わったら difit を起動してレビューを依頼する
- アロー関数のみ、`let` 禁止（`main.ts` / `view` にある既存の `let` はそのまま）、`!` 禁止、`forEach` 禁止、ユニオン型は網羅的な `switch` で扱う（`_exhaustive: never`）
- ユーザーに見える文言は日本語。ユーザーのテキストは `textContent` 経由で入れる（`innerHTML` は使わない）
- 親の状態はサブタスクから自動で決めない
- ボード上で親の付け替えや入れ子を外す操作はしない。サブタスクの `move_task` には必ず `parentId` を付ける

## Review Focus

1. サブタスクを兄弟の先頭に並べ替えたとき、楽観的表示でリストの先頭（親の外）に飛ばず、親の直後に入ること → Task 3 のテスト
2. サブタスクの並べ替えで `move_task` に `parentId` が渡り、入れ子が外れないこと → Task 3 の `toolCallFor` テスト
3. 列の中でトップレベルのカードの間にサブタスクのカードが挟まっていても、キーボードの上下ボタンで隣の兄弟を飛び越えて移動できること（ボタンが無効にならない） → Task 2 のテスト
4. 親のサブタスクがすべて別の列にあっても、親カードの内訳は全サブタスクを数えること → Task 1 のテスト
5. 先頭 100 件で切れて親がページにないサブタスク（depth 0 で `parent.kind === 'subtask'`）は orphan のままで、並べ替えはできないこと → Task 1 / Task 2 のテスト

---

### Task 1: ボードのモデルを平らにする（`board`）

**Files:**
- Modify: `apps/mcp/src/task-board-ui/board/index.ts`
- Test: `apps/mcp/src/task-board-ui/board/board.test.ts`

**Interfaces:**
- Produces（`BoardSubtask`、`BoardCard.subtasks`、`BoardCard.orphan` は削除する）:

```ts
export type SubtaskCounts = Readonly<Record<BoardStatus, number>>;

// root: a top-level task (counts of its subtasks per column; all 0 = no subtasks).
// subtask: shown under its parent's title. orphan: a subtask whose parent is not in the page (never reordered).
export type CardNesting =
  | { readonly kind: 'root'; readonly subtaskCounts: SubtaskCounts }
  | { readonly kind: 'subtask'; readonly parentId: string; readonly parentTitle: string }
  | { readonly kind: 'orphan' };

export type BoardCard = {
  readonly task: TaskItem;
  readonly listTitle: string;
  readonly overdue: boolean;
  readonly nesting: CardNesting;
};
```

`buildBoard` のシグネチャは変えない。各列には、表示するリストのタスクを「リスト順、その中はアウトライン順」に並べ、その列の状態のものだけを入れる。

- [ ] **Step 1: テストを書き換える**

既存のフィクスチャ `work`（`a`、`a1`（a の子、done）、`a2`（a の子、todo）、`b`（doing）、`c`（done）、`d`）を使う。
- `'groups top-level tasks …'` を `'puts every task, subtasks included, in the column of its own status in outline order'` に変える。期待値:
  `[['todo', ['a', 'a2', 'd', 'h']], ['doing', ['b']], ['done', ['a1', 'c']]]`
- `'nests subtasks inside their parent card …'` を `'labels a subtask card with its parent'` に変える。`a2` のカードの `nesting` が `{ kind: 'subtask', parentId: 'a', parentTitle: 'a' }` であること
- 追加 `'counts a parent’s subtasks per column, wherever they are shown'`: `a` の `nesting` が `{ kind: 'root', subtaskCounts: { todo: 1, doing: 0, done: 1 } }`。`d` は `{ kind: 'root', subtaskCounts: { todo: 0, doing: 0, done: 0 } }`
- 既存の orphan テスト（110 行目）は `nesting` が `{ kind: 'orphan' }` であることを確かめる形に直す
- 追加 `'treats a subtask whose parent id is not in its list as an orphan'`: `t('x1', { parent: { kind: 'subtask', parentId: 'missing' }, depth: 1 })` → `{ kind: 'orphan' }`

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm --filter ./apps/mcp exec vitest run src/task-board-ui/board`
Expected: FAIL（`nesting` がない、列の中身が違う）

- [ ] **Step 3: `board/index.ts` を実装する**

`cardsOf(list, today): readonly BoardCard[]` を、1 タスク 1 カードの `map` に置き換える。`nestingOf(task: ListedTaskItem, list: TaskListPage): CardNesting` を別関数にして、次のように決める。
- depth 0 かつ `parent.kind === 'root'` → root（内訳はリスト内で `parent.parentId === task.id` のタスクを `boardStatus` ごとに数える）
- `parent.kind === 'subtask'` で、親 id がリストにある → subtask（`parentTitle` は親の title。空なら `'（無題）'`）
- それ以外 → orphan

ファイル先頭のコメント（"subtasks nested in their parent card"）も書き換える。

- [ ] **Step 4: パスを確認する**

Run: `pnpm --filter ./apps/mcp exec vitest run src/task-board-ui/board`
Expected: PASS（`moves` / `view` の型エラーは Task 2・4 で直す）

---

### Task 2: 兄弟の間だけ並べ替える（`moves`）

**Files:**
- Modify: `apps/mcp/src/task-board-ui/moves/index.ts`
- Test: `apps/mcp/src/task-board-ui/moves/moves.test.ts`

**Interfaces:**
- Consumes: Task 1 の `BoardCard` / `CardNesting`
- Produces:

```ts
export type RejectReason = 'otherList' | 'otherParent' | 'locked';

export type ReorderPlan =
  | { readonly kind: 'move'; readonly taskId: string; readonly taskListId: string; readonly parent: TaskItem['parent']; readonly placement: Placement }
  | { readonly kind: 'noop' }
  | { readonly kind: 'rejected'; readonly reason: RejectReason };

// Same list and same parent: two root cards of a list, or two subtask cards with the same parentId. Orphans have no sibling.
export const isSibling = (a: BoardCard, b: BoardCard): boolean;
```

`planReorder` と `keyboardTargetIndex` はシグネチャを変えない。`Placement` は変えない（兄弟の中での位置を表す）。

- [ ] **Step 1: テストを書き換え・追加する**

`card()` フィクスチャは `subtasks` / `orphan` の代わりに `nesting: { kind: 'root', subtaskCounts: { todo: 0, doing: 0, done: 0 } }` を既定値にする。子のカードは `sub(id, parentId)` ヘルパーで作る（`task.parent = { kind: 'subtask', parentId }`、`nesting = { kind: 'subtask', parentId, parentTitle: parentId }`）。既存の `move` の期待値には `parent: { kind: 'root' }` を足す。

追加するケース（列は `column([card('a'), sub('a1', 'a'), sub('a2', 'a'), sub('b1', 'b'), card('d')])`）:
- `'reorders a subtask among its siblings, keeping its parent'`: `planReorder(col, 'a2', 1)` → `{ kind: 'move', taskId: 'a2', taskListId: 'work', parent: { kind: 'subtask', parentId: 'a' }, placement: { kind: 'first' } }`。`planReorder(col, 'a1', 3)` → `placement: { kind: 'after', previousId: 'a2' }`
- `'rejects a subtask dropped away from its siblings'`: `planReorder(col, 'a1', 5)` → `{ kind: 'rejected', reason: 'otherParent' }`
- `'rejects a top-level card dropped between subtask cards'`: `planReorder(col, 'd', 2)` → `{ kind: 'rejected', reason: 'otherList' }`
- orphan のテスト（61 行目）: `nesting: { kind: 'orphan' }` のカードは `locked`。orphan を隣に持つトップレベルのカードの `previousId` には orphan を選ばない
- keyboard `'skips cards that are not siblings'`: 上の列で `planReorder(col, 'd', keyboardTargetIndex(col, 'd', 'up'))` → `placement: { kind: 'first' }`（a の上）。`planReorder(col, 'a', keyboardTargetIndex(col, 'a', 'down'))` → `placement: { kind: 'after', previousId: 'd' }`。`keyboardTargetIndex(col, 'a1', 'up')` で計画すると `noop`
- 既存の keyboard テスト（兄弟だけの列で up → 0、down → 3、両端では noop）はそのまま通ること

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm --filter ./apps/mcp exec vitest run src/task-board-ui/moves`
Expected: FAIL

- [ ] **Step 3: `moves/index.ts` を実装する**

- `planReorder`: `dragged.nesting.kind === 'orphan'` または done 列なら `locked`。落とした位置の上下（`others[index - 1]` / `others[index]`）のどちらにも `isSibling` なカードがなければ、ドラッグしたカードが subtask なら `otherParent`、root なら `otherList`。`previous` は、位置より上にある兄弟のうち最後のもの。`parent` は `dragged.task.parent`
- `keyboardTargetIndex`: up は上にある直近の兄弟のインデックス（なければ `from`）。down は下にある直近の兄弟のインデックス + 1（なければ `from`）
- ファイル先頭のコメント（"always … at the top level"）を、兄弟の中での並べ替えという説明に直す

- [ ] **Step 4: パスを確認する**

Run: `pnpm --filter ./apps/mcp exec vitest run src/task-board-ui/moves`
Expected: PASS

---

### Task 3: 並べ替えの操作に親を通す（`board-state` と新しい `tool-call`）

**Files:**
- Modify: `apps/mcp/src/task-board-ui/board-state/index.ts`
- Test: `apps/mcp/src/task-board-ui/board-state/board-state.test.ts`
- Create: `apps/mcp/src/task-board-ui/tool-call/index.ts`（`main.ts` の `argsFor` をここへ移す）
- Test: `apps/mcp/src/task-board-ui/tool-call/tool-call.test.ts`
- Modify: `apps/mcp/src/task-board-ui/main.ts`（`argsFor` を削除し、`toolCallFor` を使う。`reorder` で `plan.parent` を op に渡す）

**Interfaces:**
- Consumes: Task 2 の `ReorderPlan`（`parent`）
- Produces:

```ts
// board-state
export type PendingOp = { readonly id: number } & (
  | { readonly kind: 'status'; readonly taskId: string; readonly taskListId: string; readonly to: BoardStatus }
  | { readonly kind: 'reorder'; readonly taskId: string; readonly taskListId: string; readonly parent: TaskItem['parent']; readonly placement: Placement }
);

// tool-call
export type ToolCall = { readonly name: ServerToolName; readonly args: Readonly<Record<string, string>> };
export const toolCallFor = (op: PendingOp): ToolCall;
```

- [ ] **Step 1: テストを書く**

board-state（`reorder` の describe。既存の reorder op には `parent: { kind: 'root' }` を足す）。フィクスチャ `work` に `a2`（a の子）を加えて `[a, a1, a2, b, c]` にする。
- `'moves a subtask first among its siblings, right under its parent'`: `{ kind: 'reorder', taskId: 'a2', taskListId: 'work', parent: { kind: 'subtask', parentId: 'a' }, placement: { kind: 'first' } }` → `order` が `['a', 'a2', 'a1', 'b', 'c']`
- `'moves a subtask after a sibling'`: `a1` を `after a2` へ → `['a', 'a2', 'a1', 'b', 'c']`
- 既存の root の reorder テストの順序の期待値は、`a2` を足した分だけ直す

tool-call:
- `'sets a task’s status'`: status op → `{ name: 'set_task_status', args: { taskId: 'b', list: 'work', status: 'doing' } }`
- `'moves a top-level task without parentId'`: root、`after c` → `{ name: 'move_task', args: { taskId: 'a', list: 'work', previousId: 'c' } }`。`first` のときは `previousId` も付けない
- `'keeps a subtask under its parent'`: subtask（parentId `a`）、`first` → `args: { taskId: 'a2', list: 'work', parentId: 'a' }`。`after a1` → `args: { taskId: 'a2', list: 'work', parentId: 'a', previousId: 'a1' }`

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm --filter ./apps/mcp exec vitest run src/task-board-ui/board-state src/task-board-ui/tool-call`
Expected: FAIL

- [ ] **Step 3: 実装する**

- `board-state`: `insertionIndex(rest, parent, placement)`。`first` のときは、root なら 0、subtask なら `rest` の中の親のインデックス + 1（親が見つからなければ -1 にして何もしない）
- `tool-call`: `parentId` / `previousId` は、それぞれ subtask のとき・`after` のときだけ args に入れる。args を組む処理は小さな関数に分けてよい
- `main.ts`: `run` は `toolCallFor(op)` を使う。`reorder` の `move` 分岐では `parent: plan.parent` を op に渡す

- [ ] **Step 4: パスを確認する**

Run: `pnpm --filter ./apps/mcp exec vitest run src/task-board-ui`
Expected: PASS

---

### Task 4: 表示・説明文・README（`view` / `main` / `styles.css` / `show_task_board` / README）

**Files:**
- Modify: `apps/mcp/src/task-board-ui/view/index.ts`
- Modify: `apps/mcp/src/task-board-ui/main.ts`
- Modify: `apps/mcp/src/task-board-ui/styles.css`
- Modify: `apps/mcp/src/mcp/task-board/index.ts`（`DESCRIPTION`）
- Modify: `README.md`（「タスクボードと状態タグ」の節と、73 行目の `show_task_board` の説明）

**Interfaces:**
- Consumes: Task 1 の `CardNesting` / `SubtaskCounts`、Task 2 の `RejectReason`

- [ ] **Step 1: `view` を書き換える**

- `BoardSubtask` / `subtaskItem` / `subtasks()`、`ViewModel.collapsedCardIds`、`ViewHandlers.toggleSubtasks` を削除する（`main.ts` の `collapsed` と `toggleSubtasks` も削除）
- `cardItem` の `meta` 部分を `nesting` で `switch` する
  - subtask: `el('span', { class: 'parent-label' }, [el('span', { class: 'sr-only' }, ['親タスク ']), `↳ ${parentTitle}`])`
  - orphan: 同じ見た目で `↳ 親タスク（未表示）`。`draggable` は `false`
  - root: 内訳の合計が 0 より大きいときだけ `el('p', { class: 'breakdown' }, ['サブタスク ', `${STATUS_LABELS.todo} ${n} / ${STATUS_LABELS.doing} ${n} / ${STATUS_LABELS.done} ${n}`])`
- `REJECTED_MESSAGES` を `Record<RejectReason, string>` にして、文言を次のとおりにする
  - `otherList: 'トップレベルのタスクは、同じリストのトップレベルのタスクの間だけで並べ替えできます。'`
  - `otherParent: 'サブタスクは、同じ親のサブタスクの間だけで並べ替えできます。'`
  - `locked`: 今のまま
- `rejectedMessage(reason: RejectReason)` にする
- ヘッダーのヒント文を `'カードをドラッグして列を移動・並べ替えできます。並べ替えは同じリストのタスク同士、サブタスクは同じ親のサブタスク同士の間だけ（「完了」列は並べ替え不可）。キーボードでは各カードのボタンを使います。'` にする

- [ ] **Step 2: `styles.css`**

`.subtasks` / `.subtask*` / disclosure まわりの不要なルールを消し、`.parent-label`（バッジより控えめ、1 行で省略表示）と `.breakdown` を足す。既存のトークンと色を使う。

- [ ] **Step 3: 説明文と README**

- `DESCRIPTION` の `"subtasks nested in their parent card"` を `"every subtask is its own card in the column of its own status, labelled with its parent; parent cards show their subtasks per column"` にする。`"reorder them"` は `"reorder them among siblings"` にする
- README のタスクボードの節に 1 項目足す：「サブタスクも 1 枚のカードとして、自分のタグの列に並びます。カードには親タスク名が付き、親カードには列ごとのサブタスクの数が出ます。並べ替えは同じ親のサブタスクの間だけです。」 73 行目の説明も合わせる

- [ ] **Step 4: 全体の検証**

Run（repo root）: `pnpm test && pnpm lint && pnpm typecheck && pnpm --filter ./apps/mcp build`
Expected: すべて成功。`vite/task-board-ui.ts` による UI のバンドルも通る

- [ ] **Step 5: 動作確認とレビュー依頼**

`pnpm --filter ./apps/mcp dev` で、MCP Apps に対応したクライアントから `show_task_board` を開ける場合は、次を目で確認する。
- 親が doing で子が todo / done の 3 列に分かれて出る
- 子のカードを列の間で動かせる
- 兄弟の間で並べ替えられる
- 違う親の間に落とすとお知らせが出る

確認できない場合は、できなかったことをそのまま報告する。そのうえで difit を起動してレビューを依頼する（commit はしない）。
