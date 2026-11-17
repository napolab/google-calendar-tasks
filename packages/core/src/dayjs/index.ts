import dayjsBase from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

// The single dayjs instance for the whole repo (.claude/rules/dayjs-timezone.md).
// Workers run in UTC and the CLI runs in the host zone, so never rely on the local zone —
// always pin a zone with `.tz(...)` or `dayjs.tz(input, zone)`.
dayjsBase.extend(utc);
dayjsBase.extend(timezone);

export const DEFAULT_TIME_ZONE = 'Asia/Tokyo';

export const dayjs: typeof dayjsBase = dayjsBase;
