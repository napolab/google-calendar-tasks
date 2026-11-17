import { BOARD_STATUSES } from '../board';
import { adjacentStatus, keyboardTargetIndex, planReorder } from '../moves';

import type { Board, BoardCard, BoardColumn, BoardSubtask } from '../board';
import type { Notice } from '../board-state';
import type { ReorderPlan } from '../moves';
import type { BoardSelection, BoardStatus, TaskItem } from '../wire';

// Thin DOM rendering of the board model. All user text goes through textContent (never innerHTML). Every state change
// re-renders the whole board; the focused control is found again by its data-focus-key afterwards.

export type ViewModel = {
  readonly board: Board;
  readonly pendingTaskIds: ReadonlySet<string>;
  readonly collapsedCardIds: ReadonlySet<string>;
  readonly notice: Notice;
  readonly loading: boolean;
  readonly fullscreen: { readonly kind: 'unavailable' } | { readonly kind: 'available'; readonly active: boolean };
};

export type ViewHandlers = {
  readonly select: (selection: BoardSelection) => void;
  readonly refresh: () => void;
  readonly toggleFullscreen: () => void;
  readonly changeStatus: (task: TaskItem, to: BoardStatus) => void;
  readonly reorder: (plan: ReorderPlan) => void;
  readonly toggleSubtasks: (cardId: string) => void;
  readonly dismissNotice: () => void;
};

export const STATUS_LABELS: Readonly<Record<BoardStatus, string>> = { todo: '未着手', doing: '進行中', done: '完了' };

type Attributes = Readonly<Record<string, string>>;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, children: readonly (Node | string)[] = []): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

const button = (label: string, attributes: Attributes, onClick: () => void, children: readonly (Node | string)[] = [label]): HTMLButtonElement => {
  const node = el('button', { type: 'button', ...attributes }, children);
  node.addEventListener('click', onClick);
  return node;
};

const disable = (node: HTMLButtonElement, disabled: boolean): HTMLButtonElement => {
  node.disabled = disabled;
  return node;
};

// ---- header ----

const isSelected = (current: BoardSelection, candidate: BoardSelection): boolean =>
  current.kind === candidate.kind && (current.kind === 'all' || (candidate.kind === 'list' && current.taskListId === candidate.taskListId));

const selectionKey = (selection: BoardSelection): string => (selection.kind === 'all' ? 'select:all' : `select:${selection.taskListId}`);

const chip = (label: string, selection: BoardSelection, model: ViewModel, handlers: ViewHandlers): HTMLButtonElement =>
  button(label, { class: 'chip', 'aria-pressed': `${isSelected(model.board.selection, selection)}`, 'data-focus-key': selectionKey(selection) }, () => handlers.select(selection));

const fullscreenButton = (model: ViewModel, handlers: ViewHandlers): readonly Node[] => {
  switch (model.fullscreen.kind) {
    case 'unavailable':
      return [];
    case 'available': {
      const label = model.fullscreen.active ? '縮小' : '全画面';
      return [button(label, { class: 'tool', 'data-focus-key': 'fullscreen' }, handlers.toggleFullscreen)];
    }
    default: {
      const _exhaustive: never = model.fullscreen;
      throw new Error(`unhandled fullscreen: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const header = (model: ViewModel, handlers: ViewHandlers): HTMLElement => {
  const refresh = button(model.loading ? '更新中…' : '更新', { class: 'tool', 'data-focus-key': 'refresh', 'aria-busy': `${model.loading}` }, handlers.refresh);
  const lists = el('div', { class: 'chips', role: 'group', 'aria-label': '表示するリスト' }, [
    chip('すべて', { kind: 'all' }, model, handlers),
    ...model.board.lists.map((list) => chip(list.title, { kind: 'list', taskListId: list.taskListId }, model, handlers)),
  ]);
  return el('header', { class: 'bar' }, [
    el('div', { class: 'bar-row' }, [el('h1', { class: 'title' }, ['タスクボード']), el('div', { class: 'tools' }, [refresh, ...fullscreenButton(model, handlers)])]),
    lists,
    el('p', { class: 'hint', id: 'board-hint' }, [
      'カードをドラッグして列を移動・並べ替えできます。並べ替えは同じリストのカードの間だけ（「完了」列は並べ替え不可）。キーボードでは各カードのボタンを使います。',
    ]),
    ...model.board.truncatedLists.map((title) => el('p', { class: 'hint warn' }, [`「${title}」は先頭 100 件だけを表示しています。`])),
  ]);
};

// ---- cards ----

const dueLabel = (task: TaskItem, overdue: boolean): readonly Node[] => {
  switch (task.due.kind) {
    case 'none':
      return [];
    case 'date':
      return [
        el('span', { class: overdue ? 'due overdue' : 'due' }, [
          el('span', { class: 'sr-only' }, ['期限 ']),
          el('time', { datetime: task.due.date }, [task.due.date]),
          ...(overdue ? [el('span', { class: 'overdue-label' }, ['期限切れ'])] : []),
        ]),
      ];
    default: {
      const _exhaustive: never = task.due;
      throw new Error(`unhandled due: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const unknownTagWarning = (task: TaskItem): readonly Node[] => {
  switch (task.unknownStatusTag.kind) {
    case 'none':
      return [];
    case 'unknown':
      return [el('p', { class: 'tag-warning' }, [`不明なステータス「${task.unknownStatusTag.value}」（未着手として表示）`])];
    default: {
      const _exhaustive: never = task.unknownStatusTag;
      throw new Error(`unhandled tag: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const checkbox = (task: TaskItem, handlers: ViewHandlers): HTMLInputElement => {
  const done = task.boardStatus === 'done';
  const input = el('input', {
    type: 'checkbox',
    class: 'check',
    'aria-label': done ? `「${task.title}」を未完了に戻す` : `「${task.title}」を完了にする`,
    'data-focus-key': `check:${task.id}`,
  });
  input.checked = done;
  input.addEventListener('change', () => handlers.changeStatus(task, done ? 'todo' : 'done'));
  return input;
};

const subtaskItem = (subtask: BoardSubtask, handlers: ViewHandlers, pending: ReadonlySet<string>): HTMLLIElement =>
  el('li', { class: `subtask${subtask.task.boardStatus === 'done' ? ' is-done' : ''}`, 'aria-busy': `${pending.has(subtask.task.id)}` }, [
    el('label', { class: 'check-row' }, [checkbox(subtask.task, handlers), el('span', { class: 'subtask-title' }, [subtask.task.title === '' ? '（無題）' : subtask.task.title])]),
    ...dueLabel(subtask.task, subtask.overdue),
  ]);

const subtasks = (card: BoardCard, model: ViewModel, handlers: ViewHandlers): readonly Node[] => {
  if (card.subtasks.length === 0) return [];
  const doneCount = card.subtasks.filter((subtask) => subtask.task.boardStatus === 'done').length;
  const expanded = !model.collapsedCardIds.has(card.task.id);
  const listId = `subtasks-${card.task.id}`;
  return [
    button('', { class: 'disclosure', 'aria-expanded': `${expanded}`, 'aria-controls': listId, 'data-focus-key': `subtasks:${card.task.id}` }, () => handlers.toggleSubtasks(card.task.id), [
      el('span', { class: 'arrow', 'aria-hidden': 'true' }),
      `サブタスク ${doneCount}/${card.subtasks.length}`,
    ]),
    el(
      'ul',
      { class: 'subtasks', id: listId, ...(expanded ? {} : { hidden: '' }) },
      card.subtasks.map((subtask) => subtaskItem(subtask, handlers, model.pendingTaskIds)),
    ),
  ];
};

type Direction = 'up' | 'down' | 'left' | 'right';

const ROTATION: Readonly<Record<Direction, number>> = { up: 0, right: 90, down: 180, left: 270 };

// An outlined arrow (monochrome, currentColor), pointing up and rotated per direction.
const arrowIcon = (direction: Direction): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.transform = `rotate(${ROTATION[direction]}deg)`;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M8 13V3M3.5 7.5 8 3l4.5 4.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'square');
  svg.append(path);
  return svg;
};

const moveButton = (direction: Direction, label: string, focusKey: string, enabled: boolean, onClick: () => void): HTMLButtonElement =>
  disable(button(label, { class: 'icon', 'aria-label': label, title: label, 'data-focus-key': focusKey }, onClick, [arrowIcon(direction)]), !enabled);

const statusButton = (card: BoardCard, side: 'left' | 'right', handlers: ViewHandlers): readonly Node[] => {
  const target = adjacentStatus(card.task.boardStatus, side);
  switch (target.kind) {
    case 'none':
      return [];
    case 'some':
      return [moveButton(side, `「${STATUS_LABELS[target.status]}」へ移動`, `${side}:${card.task.id}`, true, () => handlers.changeStatus(card.task, target.status))];
    default: {
      const _exhaustive: never = target;
      throw new Error(`unhandled target: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const cardActions = (card: BoardCard, column: BoardColumn, handlers: ViewHandlers): HTMLElement => {
  const plan = (direction: 'up' | 'down') => planReorder(column, card.task.id, keyboardTargetIndex(column, card.task.id, direction));
  const [up, down] = [plan('up'), plan('down')];
  return el('div', { class: 'actions', role: 'group', 'aria-label': 'カードの移動' }, [
    moveButton('up', '上へ移動', `up:${card.task.id}`, up.kind === 'move', () => handlers.reorder(up)),
    moveButton('down', '下へ移動', `down:${card.task.id}`, down.kind === 'move', () => handlers.reorder(down)),
    ...statusButton(card, 'left', handlers),
    ...statusButton(card, 'right', handlers),
  ]);
};

const cardItem = (card: BoardCard, column: BoardColumn, model: ViewModel, handlers: ViewHandlers): HTMLLIElement => {
  const titleId = `title-${card.task.id}`;
  const item = el(
    'li',
    {
      class: `card${card.task.boardStatus === 'done' ? ' is-done' : ''}`,
      draggable: `${!card.orphan}`,
      tabindex: '-1',
      'aria-labelledby': titleId,
      'aria-busy': `${model.pendingTaskIds.has(card.task.id)}`,
      'data-task-id': card.task.id,
      'data-focus-key': `card:${card.task.id}`,
    },
    [
      el('div', { class: 'card-head' }, [
        el('label', { class: 'check-row' }, [checkbox(card.task, handlers), el('span', { class: 'card-title', id: titleId }, [card.task.title === '' ? '（無題）' : card.task.title])]),
      ]),
      el('div', { class: 'meta' }, [
        ...dueLabel(card.task, card.overdue),
        ...(model.board.showListBadge ? [el('span', { class: 'badge' }, [el('span', { class: 'sr-only' }, ['リスト ']), card.listTitle])] : []),
        ...(card.orphan ? [el('span', { class: 'badge muted' }, ['サブタスク'])] : []),
      ]),
      ...(card.task.body === '' ? [] : [el('p', { class: 'body' }, [card.task.body])]),
      ...unknownTagWarning(card.task),
      ...subtasks(card, model, handlers),
      cardActions(card, column, handlers),
    ],
  );
  return item;
};

// ---- columns & drag and drop ----

type Drag = { readonly kind: 'idle' } | { readonly kind: 'dragging'; readonly taskId: string; readonly from: BoardStatus };

// The drop point among a column's cards from the pointer's vertical position (card midpoints).
const dropIndex = (list: HTMLElement, clientY: number): number => {
  const cards = [...list.querySelectorAll<HTMLElement>(':scope > .card')];
  const below = cards.findIndex((card) => {
    const rect = card.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  return below === -1 ? cards.length : below;
};

const clearIndicators = (root: HTMLElement): void => {
  for (const node of root.querySelectorAll('[data-drop]')) node.removeAttribute('data-drop');
};

const showIndicator = (list: HTMLElement, index: number): void => {
  const cards = [...list.querySelectorAll<HTMLElement>(':scope > .card')];
  const target = cards[index];
  if (target !== undefined) target.setAttribute('data-drop', 'before');
  else cards.at(-1)?.setAttribute('data-drop', 'after');
};

type DropTarget = { readonly kind: 'status'; readonly to: BoardStatus } | { readonly kind: 'reorder'; readonly plan: ReorderPlan };

const dropTargetFor = (column: BoardColumn, drag: { readonly taskId: string; readonly from: BoardStatus }, list: HTMLElement, clientY: number): DropTarget =>
  drag.from === column.status ? { kind: 'reorder', plan: planReorder(column, drag.taskId, dropIndex(list, clientY)) } : { kind: 'status', to: column.status };

const REJECTED_MESSAGES: Readonly<Record<'otherList' | 'locked', string>> = {
  otherList: '並べ替えは同じリストのカードの間だけでできます。',
  locked: '「完了」列のカードと、親が表示されていないサブタスクは並べ替えできません。',
};

export const rejectedMessage = (reason: 'otherList' | 'locked'): string => REJECTED_MESSAGES[reason];

const columnSection = (column: BoardColumn, model: ViewModel, handlers: ViewHandlers & { readonly drag: () => Drag; readonly setDrag: (drag: Drag) => void }): HTMLElement => {
  const headingId = `column-${column.status}`;
  const list = el(
    'ol',
    { class: 'cards', 'aria-labelledby': headingId },
    column.cards.map((card) => cardItem(card, column, model, handlers)),
  );
  const section = el('section', { class: 'column', 'data-status': column.status }, [
    el('h2', { class: 'column-head', id: headingId }, [STATUS_LABELS[column.status], el('span', { class: 'count', 'aria-label': `${column.cards.length} 件` }, [`${column.cards.length}`])]),
    column.cards.length === 0 ? el('p', { class: 'empty' }, [model.loading ? '読み込み中…' : 'タスクなし']) : '',
    list,
  ]);

  section.addEventListener('dragover', (event) => {
    const drag = handlers.drag();
    if (drag.kind !== 'dragging') return;
    const target = dropTargetFor(column, drag, list, event.clientY);
    clearIndicators(section.ownerDocument.body);
    if (target.kind === 'reorder' && target.plan.kind !== 'move') return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
    section.setAttribute('data-drop', 'column');
    if (target.kind === 'reorder') showIndicator(list, dropIndex(list, event.clientY));
  });
  section.addEventListener('dragleave', (event) => {
    if (event.relatedTarget instanceof Node && section.contains(event.relatedTarget)) return;
    section.removeAttribute('data-drop');
  });
  section.addEventListener('drop', (event) => {
    const drag = handlers.drag();
    event.preventDefault();
    clearIndicators(section.ownerDocument.body);
    if (drag.kind !== 'dragging') return;
    const card = model.board.columns.flatMap((candidate) => candidate.cards).find((candidate) => candidate.task.id === drag.taskId);
    const target = dropTargetFor(column, drag, list, event.clientY);
    handlers.setDrag({ kind: 'idle' });
    if (target.kind === 'status' && card !== undefined) handlers.changeStatus(card.task, target.to);
    if (target.kind === 'reorder') handlers.reorder(target.plan);
  });
  return section;
};

const noticeBar = (notice: Notice, handlers: ViewHandlers): readonly Node[] => {
  switch (notice.kind) {
    case 'none':
      return [];
    case 'info':
    case 'error':
      return [
        el('div', { class: `toast ${notice.kind}`, role: notice.kind === 'error' ? 'alert' : 'status' }, [
          el('span', {}, [notice.kind === 'error' ? `変更を元に戻しました: ${notice.message}` : notice.message]),
          button('閉じる', { class: 'tool', 'data-focus-key': 'dismiss' }, handlers.dismissNotice),
        ]),
      ];
    default: {
      const _exhaustive: never = notice;
      throw new Error(`unhandled notice: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Mounts the board into `root`; returns render(model). Drag state lives here (the view's own lifetime).
export const createBoardView = (root: HTMLElement, handlers: ViewHandlers): ((model: ViewModel) => void) => {
  let drag: Drag = { kind: 'idle' };
  const withDrag = { ...handlers, drag: () => drag, setDrag: (next: Drag) => (drag = next) };

  root.addEventListener('dragstart', (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const card = event.target.closest<HTMLElement>('.card');
    const column = card?.closest<HTMLElement>('.column');
    const taskId = card?.dataset['taskId'];
    const from = column?.dataset['status'];
    const status = BOARD_STATUSES.find((candidate) => candidate === from);
    if (taskId === undefined || status === undefined) return;
    drag = { kind: 'dragging', taskId, from: status };
    event.dataTransfer?.setData('text/plain', taskId);
    card?.setAttribute('data-dragging', '');
  });
  root.addEventListener('dragend', () => {
    drag = { kind: 'idle' };
    clearIndicators(root);
    for (const node of root.querySelectorAll('[data-dragging]')) node.removeAttribute('data-dragging');
  });

  return (model) => {
    const focusKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset['focusKey'] : undefined;
    const taskId = focusKey?.split(':')[1];
    root.replaceChildren(
      header(model, handlers),
      el(
        'div',
        { class: 'board', 'aria-describedby': 'board-hint' },
        model.board.columns.map((column) => columnSection(column, model, withDrag)),
      ),
      ...noticeBar(model.notice, handlers),
    );
    if (focusKey === undefined) return;
    const next =
      [...root.querySelectorAll<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)].find((node) => !(node instanceof HTMLButtonElement) || !node.disabled) ??
      (taskId === undefined ? undefined : root.querySelector<HTMLElement>(`[data-focus-key="card:${CSS.escape(taskId)}"]`));
    next?.focus();
  };
};
