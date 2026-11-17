import { dayjs } from '@napolab/gct-core/dayjs';

import { describeScope } from '../../google-scopes';
import { TOOL_TIME_ZONE } from '../../mcp/time-input';
import { Layout } from '../layout';

import type { ConnectionStatus } from '../../token-store/vault';

// GET /: whether this Access user's Google account is connected, and the buttons to (re)connect / disconnect.

export type StatusPageProps = { readonly email: string; readonly status: ConnectionStatus; readonly mcpURL: string };

const ConnectedBody = ({ status }: { readonly status: Extract<ConnectionStatus, { kind: 'connected' }> }) => (
  <>
    <p>
      Google is <strong>connected</strong> since {dayjs(status.connectedAt).tz(TOOL_TIME_ZONE).format('YYYY-MM-DD HH:mm')} ({TOOL_TIME_ZONE}).
    </p>
    <p>Granted access:</p>
    <ul>
      {status.scopes.map((scope) => (
        <li>{describeScope(scope)}</li>
      ))}
    </ul>
    <p>
      <a href="/google/connect">Reconnect Google</a>
    </p>
    <form method="post" action="/google/disconnect">
      <button type="submit">Disconnect Google</button>
    </form>
  </>
);

const DisconnectedBody = () => (
  <>
    <p>
      Google is <strong>not connected</strong>. The MCP tools need access to Google Calendar and Google Tasks.
    </p>
    <p>
      <a href="/google/connect">Connect Google</a> — on the consent screen, tick <strong>both</strong> the Calendar and the Tasks checkboxes.
    </p>
  </>
);

const StatusBody = ({ status }: { readonly status: ConnectionStatus }) => {
  switch (status.kind) {
    case 'connected':
      return <ConnectedBody status={status} />;
    case 'disconnected':
      return <DisconnectedBody />;
    default: {
      const _exhaustive: never = status;
      throw new Error(`unhandled status: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const StatusPage = ({ email, status, mcpURL }: StatusPageProps) => (
  <Layout title="Google Calendar & Tasks MCP">
    <p>
      Signed in through Cloudflare Access as <strong>{email}</strong>.
    </p>
    <StatusBody status={status} />
    <p>
      MCP endpoint: <code>{mcpURL}</code>
    </p>
  </Layout>
);
