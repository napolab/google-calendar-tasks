// CLI-only failures (.claude/skills/modeling-errors-as-classes) — part of the CliContext contract: services
// return them, commands render them. Google-side failures stay core's errors (GoogleAuthError, ...).

// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing or empty.
export class ConfigError extends Error {
  override name = 'ConfigError' as const;
}

// The credentials file could not be read, parsed or written.
export class CredentialStoreError extends Error {
  override name = 'CredentialStoreError' as const;
}

// No stored refresh token — the user must run the login command first.
export class NotLoggedInError extends Error {
  override name = 'NotLoggedInError' as const;
}

// The loopback HTTP server could not listen on 127.0.0.1.
export class LoopbackServerError extends Error {
  override name = 'LoopbackServerError' as const;
}

// The browser never came back to the loopback server before the entrypoint's deadline / AbortSignal
// (or the server was closed while a login was waiting).
export class LoginTimeoutError extends Error {
  override name = 'LoginTimeoutError' as const;
}

// Google redirected back with an OAuth error (e.g. the user declined consent).
export class AuthorizationDeniedError extends Error {
  override name = 'AuthorizationDeniedError' as const;
  readonly error: string;

  constructor(error: string) {
    super(`Google did not grant access (${error}). Run the login again and approve the requested scopes.`);
    this.error = error;
  }
}

// The redirect did not match the login in progress (state mismatch → possible CSRF) or carried no code.
export class InvalidCallbackError extends Error {
  override name = 'InvalidCallbackError' as const;
}
