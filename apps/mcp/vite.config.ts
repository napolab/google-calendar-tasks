import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

import { taskBoardUI } from './vite/task-board-ui.ts';

export default defineConfig({
  // taskBoardUI builds the MCP App HTML (src/task-board-ui) into `virtual:task-board-ui` for the Worker bundle.
  plugins: [taskBoardUI(), cloudflare()],
});
