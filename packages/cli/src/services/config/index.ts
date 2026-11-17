import { err, ok } from 'neverthrow';
import { z } from 'zod';

import { ConfigError } from '../../context/errors';

import type { Result } from 'neverthrow';

// The Desktop-app OAuth client the CLI logs in with. Loaded from `packages/cli/.env` by the start script.
export type Config = {
  readonly clientId: string;
  readonly clientSecret: string;
};

const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
});

export type Env = Readonly<Partial<Record<keyof z.input<typeof envSchema>, string>>>;

// Only issue paths (variable names) reach the message — never the values.
const describeMissing = (error: z.ZodError): string => [...new Set(error.issues.map((issue) => issue.path.join('.')))].join(', ');

export const loadConfig = (env: Env): Result<Config, ConfigError> => {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success)
    return err(
      new ConfigError(
        `Missing Google OAuth client settings: ${describeMissing(parsed.error)}. Copy packages/cli/.env.example to packages/cli/.env and fill in the Desktop app client ID and secret from Google Cloud Console.`,
      ),
    );
  return ok({ clientId: parsed.data.GOOGLE_CLIENT_ID, clientSecret: parsed.data.GOOGLE_CLIENT_SECRET });
};
