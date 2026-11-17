import { describeScope } from '../../google-scopes';
import { Layout } from '../layout';

import type { OAuthStateProblem } from '../../errors';

// The page /google/callback ends on. Every variant renders fixed text: nothing from the query string is echoed
// (scopes are shown through fixed labels).

export type ConnectResult =
  | { readonly kind: 'connected'; readonly scopes: readonly string[] }
  | { readonly kind: 'declined' }
  | { readonly kind: 'google-error' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'state-rejected'; readonly problem: OAuthStateProblem }
  | { readonly kind: 'missing-scopes'; readonly missing: readonly string[] }
  | { readonly kind: 'exchange-failed' }
  | { readonly kind: 'store-unavailable' };

export type ConnectResultStatus = 200 | 400 | 502 | 503;

export const statusOf = (result: ConnectResult): ConnectResultStatus => {
  switch (result.kind) {
    case 'connected':
    case 'declined':
      return 200;
    case 'google-error':
    case 'malformed':
    case 'state-rejected':
    case 'missing-scopes':
      return 400;
    case 'exchange-failed':
      return 502;
    case 'store-unavailable':
      return 503;
    default: {
      const _exhaustive: never = result;
      throw new Error(`unhandled connect result: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const STATE_EXPLANATION = {
  missing: 'There is no connection in progress for your account (it was already completed, or never started here).',
  mismatch: 'This response does not belong to the connection you started.',
  expired: 'The connection took longer than 10 minutes.',
} satisfies Record<OAuthStateProblem, string>;

const TryAgain = () => (
  <p>
    <a href="/google/connect">Start again</a> · <a href="/">Back to status</a>
  </p>
);

export const ConnectResultPage = ({ result }: { readonly result: ConnectResult }) => {
  switch (result.kind) {
    case 'connected':
      return (
        <Layout title="Google connected">
          <p>The MCP tools can now use:</p>
          <ul>
            {result.scopes.map((scope) => (
              <li>{describeScope(scope)}</li>
            ))}
          </ul>
          <p>
            You can close this tab. <a href="/">Back to status</a>
          </p>
        </Layout>
      );
    case 'declined':
      return (
        <Layout title="Connection cancelled">
          <p>You declined access on the Google consent screen, so nothing was connected.</p>
          <TryAgain />
        </Layout>
      );
    case 'google-error':
      return (
        <Layout title="Google did not complete the connection">
          <p>Google returned an error instead of an authorization.</p>
          <TryAgain />
        </Layout>
      );
    case 'malformed':
      return (
        <Layout title="Invalid callback">
          <p>This request is not a valid response from Google.</p>
          <TryAgain />
        </Layout>
      );
    case 'state-rejected':
      return (
        <Layout title="Connection could not be verified">
          <p>{STATE_EXPLANATION[result.problem]} Nothing was connected.</p>
          <TryAgain />
        </Layout>
      );
    case 'missing-scopes':
      return (
        <Layout title="Both permissions are needed">
          <p>Google did not grant access to: {result.missing.map(describeScope).join(', ')}.</p>
          <p>
            On the Google consent screen, tick <strong>both</strong> checkboxes — Google Calendar and Google Tasks — then continue. The partial grant was revoked.
          </p>
          <TryAgain />
        </Layout>
      );
    case 'exchange-failed':
      return (
        <Layout title="Connection failed">
          <p>Google did not accept the authorization code (it may have expired). Nothing was connected.</p>
          <TryAgain />
        </Layout>
      );
    case 'store-unavailable':
      return (
        <Layout title="Temporarily unavailable">
          <p>The connection could not be saved right now.</p>
          <TryAgain />
        </Layout>
      );
    default: {
      const _exhaustive: never = result;
      throw new Error(`unhandled connect result: ${JSON.stringify(_exhaustive)}`);
    }
  }
};
