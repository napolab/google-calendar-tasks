import { dayjs } from '@napolab/gct-core/dayjs';

import { CLI_TIME_ZONE } from '../flags/date';

// Human-readable times for CLI output, always in Asia/Tokyo — never the host zone.

const inZone = (instant: string) => dayjs(instant).tz(CLI_TIME_ZONE);

// `YYYY-MM-DD HH:mm`
export const formatInstant = (instant: string): string => inZone(instant).format('YYYY-MM-DD HH:mm');

// `YYYY-MM-DD`
export const formatDay = (instant: string): string => inZone(instant).format('YYYY-MM-DD');

// `HH:mm`
export const formatClock = (instant: string): string => inZone(instant).format('HH:mm');

// `YYYY-MM-DD HH:mm–HH:mm` within one day, `YYYY-MM-DD HH:mm – YYYY-MM-DD HH:mm` across days.
export const formatInstantRange = (start: string, end: string): string =>
  formatDay(start) === formatDay(end) ? `${formatInstant(start)}–${formatClock(end)}` : `${formatInstant(start)} – ${formatInstant(end)}`;
