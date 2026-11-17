// Google OAuth scopes this project needs. Calendar (events read/write) and Tasks (read/write).
export const GOOGLE_SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar',
  tasks: 'https://www.googleapis.com/auth/tasks',
} as const;

export type GoogleScope = (typeof GOOGLE_SCOPES)[keyof typeof GOOGLE_SCOPES];

export const ALL_SCOPES: readonly GoogleScope[] = [GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.tasks];
