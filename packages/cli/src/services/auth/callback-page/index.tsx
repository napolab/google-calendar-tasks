import type { CallbackResult } from '../callback-app';
import type { Child } from 'hono/jsx';

// The page the browser shows after Google redirects to the loopback server. Rendered with hono/jsx, which
// escapes every interpolated value; only what a variant explicitly carries (the OAuth error code) is shown.

type LayoutProps = { readonly title: string; readonly children: Child };

const Layout = ({ title, children }: LayoutProps) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
    </head>
    <body style="font-family: system-ui, sans-serif; margin: 3rem; line-height: 1.5">
      <h1>{title}</h1>
      {children}
    </body>
  </html>
);

type InvalidReason = Extract<CallbackResult, { readonly kind: 'invalid' }>['reason'];

const INVALID_EXPLANATION = {
  'state-mismatch': 'This request did not match the login in progress, so it was rejected.',
  'missing-code': 'This request did not include an authorization code.',
} satisfies Record<InvalidReason, string>;

export type CallbackPageProps = { readonly result: CallbackResult };

export const CallbackPage = ({ result }: CallbackPageProps) => {
  switch (result.kind) {
    case 'code':
      return (
        <Layout title="Logged in to gct">
          <p>You can close this tab and return to the terminal.</p>
        </Layout>
      );
    case 'error':
      return (
        <Layout title="Login was not completed">
          <p>
            Google did not grant access (<code>{result.error}</code>). You can close this tab and check the terminal.
          </p>
        </Layout>
      );
    case 'invalid':
      return (
        <Layout title="Invalid login callback">
          <p>{INVALID_EXPLANATION[result.reason]} Check the terminal and run the login again.</p>
        </Layout>
      );
    case 'ignored':
      return (
        <Layout title="Not found">
          <p>Nothing here.</p>
        </Layout>
      );
    default: {
      const _exhaustive: never = result;
      throw new Error(`unhandled callback result: ${JSON.stringify(_exhaustive)}`);
    }
  }
};
