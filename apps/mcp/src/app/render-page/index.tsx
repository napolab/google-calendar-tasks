import { html } from 'hono/html';

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { JSX } from 'hono/jsx/jsx-runtime';

// Every HTML page: a doctype, never cached (they show per-user state).
export const renderPage = (c: Context, page: JSX.Element, status: ContentfulStatusCode = 200): Response | Promise<Response> => {
  c.header('cache-control', 'no-store');
  return c.html(html`<!doctype html>${page}`, status);
};
