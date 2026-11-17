// Experiment probe: does Cloudflare Access hand any Google OAuth token to the origin?
// Walks arbitrary JSON (Access JWT claims, /cdn-cgi/access/get-identity) and reports where
// token-shaped strings live — path, kind and length only, never the value itself.

export type TokenKind = 'google-access-token' | 'google-refresh-token' | 'jwt';

export type TokenFinding = {
  readonly path: string;
  readonly kind: TokenKind;
  readonly length: number;
};

type Classified = { kind: 'token'; tokenKind: TokenKind } | { kind: 'other' };

const GOOGLE_ACCESS_TOKEN = /^ya29\.[\w.-]+$/;
const GOOGLE_REFRESH_TOKEN = /^1\/\/[\w-]+$/;
const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;

const classify = (value: string): Classified => {
  if (GOOGLE_ACCESS_TOKEN.test(value)) return { kind: 'token', tokenKind: 'google-access-token' };
  if (GOOGLE_REFRESH_TOKEN.test(value)) return { kind: 'token', tokenKind: 'google-refresh-token' };
  if (JWT.test(value)) return { kind: 'token', tokenKind: 'jwt' };
  return { kind: 'other' };
};

const scanString = (value: string, path: string): readonly TokenFinding[] => {
  const classified = classify(value);
  switch (classified.kind) {
    case 'token':
      return [{ path, kind: classified.tokenKind, length: value.length }];
    case 'other':
      return [];
  }
};

const scanAt = (value: unknown, path: string): readonly TokenFinding[] => {
  if (typeof value === 'string') return scanString(value, path);
  if (Array.isArray(value)) return value.flatMap((item: unknown, index) => scanAt(item, `${path}[${index}]`));
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([key, item]) => scanAt(item, `${path}.${key}`));
  return [];
};

export const scanForTokens = (value: unknown): readonly TokenFinding[] => scanAt(value, '$');
