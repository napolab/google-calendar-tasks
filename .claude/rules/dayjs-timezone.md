---
description: Use dayjs (utc + timezone plugins) for every date/time operation — no raw Date arithmetic; never assume the host timezone
paths:
  - "packages/*/src/**/*.ts"
  - "apps/*/src/**/*.ts"
---

Always use `dayjs` for date/time operations. Never use raw `Date` arithmetic or other date libraries.

Import the configured instance from core (plugins `utc` + `timezone` already extended) — never import `dayjs` directly in feature code:

```ts
// Good
import { dayjs } from '@napolab/gct-core/dayjs';

// Bad
import dayjs from 'dayjs';
```

Calendar data is timezone-sensitive and the code runs in several runtimes (local CLI, Cloudflare Workers = UTC). Always make the timezone explicit:

- The default timezone is `Asia/Tokyo` (`DEFAULT_TIME_ZONE`). A calendar's own `timeZone` wins when Google returns one.
- Send Google RFC 3339 timestamps **with an offset** (`dayjs.tz(input, tz).format()`), never a naive local string.
- All-day events use `{ date: 'YYYY-MM-DD' }`, timed events use `{ dateTime, timeZone }` — model them as separate variants, not optional fields.
- Google Tasks `due` is date-only (the time part is discarded by Google); format it as `YYYY-MM-DDT00:00:00.000Z`.

```ts
// Bad — host timezone leaks in
dayjs().format();
new Date();
```
