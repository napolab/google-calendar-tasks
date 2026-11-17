import type { Child } from 'hono/jsx';

// Shared page chrome. hono/jsx escapes every interpolated value.

type LayoutProps = { readonly title: string; readonly children: Child };

export const Layout = ({ title, children }: LayoutProps) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>{`${title} · gct`}</title>
    </head>
    <body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.6">
      <h1>{title}</h1>
      {children}
    </body>
  </html>
);
