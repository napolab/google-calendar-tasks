import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { dayjs } from '@napolab/gct-core/dayjs';

import { buildBoard, tokyoToday } from './board';
import { INITIAL_BOARD_STATE, reduceBoard, visibleLists } from './board-state';
import { planStatusChange } from './moves';
import { serverToolName } from './tool-name';
import { toolCallFor } from './tool-call';
import { createBoardView, rejectedMessage } from './view';
import { parseBoardPayload, parseListing, parseTask } from './wire';
import './styles.css';

import type { BoardEvent, BoardState, PendingOp } from './board-state';
import type { ReorderPlan } from './moves';
import type { ServerToolName } from './tool-name';
import type { ViewModel } from './view';
import type { BoardSelection, BoardStatus, Parsed, TaskItem } from './wire';
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';

// Entrypoint of the board UI (bundled into one HTML file, served as ui://gct/task-board.html). It owns the App bridge,
// the timers and the mutable UI state; everything else is pure (board, board-state, moves, wire) or thin DOM (view).

const NOTICE_MS = 6000;

const root = document.getElementById('app');
if (root === null) throw new Error('#app is missing');

const app = new App({ name: 'gct-task-board', version: '0.1.0' }, { availableDisplayModes: ['inline', 'fullscreen'] });

let state: BoardState = INITIAL_BOARD_STATE;
let selection: BoardSelection = { kind: 'all' };
let loading = true;
let nextOpId = 1;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let hostContext: McpUiHostContext = {};

const fullscreenOf = (context: McpUiHostContext): ViewModel['fullscreen'] =>
  context.availableDisplayModes?.includes('fullscreen') === true ? { kind: 'available', active: context.displayMode === 'fullscreen' } : { kind: 'unavailable' };

const render = (): void => {
  const board = buildBoard(visibleLists(state), selection, tokyoToday(dayjs().valueOf()));
  view({
    board,
    pendingTaskIds: new Set(state.pending.map((op) => op.taskId)),
    notice: state.notice,
    loading,
    fullscreen: fullscreenOf(hostContext),
  });
  document.documentElement.dataset['displayMode'] = hostContext.displayMode ?? 'inline';
};

const dispatch = (event: BoardEvent): void => {
  state = reduceBoard(state, event);
  if (event.type === 'failed' || event.type === 'noticed') {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => dispatch({ type: 'dismissed' }), NOTICE_MS);
  }
  render();
};

const callTool = async (name: ServerToolName, args: Record<string, string>): Promise<unknown> => {
  try {
    return await app.callServerTool({ name: serverToolName(hostContext.toolInfo?.tool.name, name), arguments: args });
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'ツールを呼び出せませんでした。' }] };
  }
};

const settle = (opId: number, parsed: Parsed<TaskItem>): void => {
  switch (parsed.kind) {
    case 'ok':
      dispatch({ type: 'succeeded', opId, task: parsed.value });
      return;
    case 'error':
      dispatch({ type: 'failed', opId, message: parsed.message });
      return;
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`unhandled result: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Optimistic: the change shows at once and is rolled back if the tool call fails.
const run = async (op: PendingOp): Promise<void> => {
  dispatch({ type: 'started', op });
  const { name, args } = toolCallFor(op);
  settle(op.id, parseTask(await callTool(name, args)));
};

const changeStatus = (task: TaskItem, to: BoardStatus): void => {
  const plan = planStatusChange(task, to);
  if (plan.kind === 'noop') return;
  void run({ id: nextOpId++, kind: 'status', taskId: plan.taskId, taskListId: plan.taskListId, to: plan.to });
};

const reorder = (plan: ReorderPlan): void => {
  switch (plan.kind) {
    case 'noop':
      return;
    case 'rejected':
      dispatch({ type: 'noticed', message: rejectedMessage(plan.reason) });
      return;
    case 'move':
      void run({ id: nextOpId++, kind: 'reorder', taskId: plan.taskId, taskListId: plan.taskListId, parent: plan.parent, placement: plan.placement });
      return;
    default: {
      const _exhaustive: never = plan;
      throw new Error(`unhandled plan: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const refresh = async (): Promise<void> => {
  loading = true;
  render();
  const parsed = parseListing(await callTool('list_tasks', {}));
  loading = false;
  switch (parsed.kind) {
    case 'ok':
      dispatch({ type: 'loaded', lists: parsed.value });
      return;
    case 'error':
      dispatch({ type: 'noticed', message: `読み込めませんでした: ${parsed.message}` });
      return;
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`unhandled listing: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toggleFullscreen = async (): Promise<void> => {
  const mode = hostContext.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  try {
    const result = await app.requestDisplayMode({ mode });
    hostContext = { ...hostContext, displayMode: result.mode };
    render();
  } catch (error) {
    console.error('[task-board] display mode change failed', error);
  }
};

const view = createBoardView(root, {
  select: (next) => {
    selection = next;
    render();
  },
  refresh: () => void refresh(),
  toggleFullscreen: () => void toggleFullscreen(),
  changeStatus,
  reorder,
  dismissNotice: () => dispatch({ type: 'dismissed' }),
});

const applyHostContext = (context: McpUiHostContext): void => {
  hostContext = { ...hostContext, ...context };
  if (context.theme !== undefined) applyDocumentTheme(context.theme);
  if (context.styles?.variables !== undefined) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts !== undefined) applyHostFonts(context.styles.css.fonts);
  if (context.safeAreaInsets !== undefined) {
    const { top, right, bottom, left } = context.safeAreaInsets;
    root.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
  render();
};

// Every handler is registered before connect().
app.ontoolresult = (result) => {
  const parsed = parseBoardPayload(result);
  loading = false;
  switch (parsed.kind) {
    case 'ok':
      selection = parsed.value.selection;
      dispatch({ type: 'loaded', lists: parsed.value.lists });
      return;
    case 'error':
      dispatch({ type: 'noticed', message: `読み込めませんでした: ${parsed.message}` });
      return;
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`unhandled payload: ${JSON.stringify(_exhaustive)}`);
    }
  }
};
app.onhostcontextchanged = applyHostContext;
app.onteardown = async () => {
  clearTimeout(noticeTimer);
  return {};
};
app.onerror = (error) => console.error('[task-board]', error);

render();
void app.connect().then(
  () => applyHostContext(app.getHostContext() ?? {}),
  (error: unknown) => console.error('[task-board] connect failed', error),
);
