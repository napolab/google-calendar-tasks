import { GoogleNotFoundError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { depsWith, errorTextOf, jsonOf, recorder } from '../test-support';
import { createColorsSettingsToolHandlers } from './index';

import type { ICalendarService, SettingRef } from '@napolab/gct-core/calendar';

const handlersWith = (overrides: Partial<ICalendarService>) => createColorsSettingsToolHandlers(depsWith(overrides));

describe('colors and settings tools', () => {
  it('get_colors returns both palettes', async () => {
    const palettes = { calendar: [{ id: '1', background: '#ac725e', foreground: '#1d1d1d' }], event: [{ id: '1', background: '#a4bdfc', foreground: '#1d1d1d' }] };
    const handlers = handlersWith({ getColors: () => okAsync(palettes) });

    expect(jsonOf(await handlers.getColors())).toEqual(palettes);
  });

  it('list_settings wraps the settings', async () => {
    const handlers = handlersWith({ listSettings: () => okAsync([{ id: 'timezone', value: 'Asia/Tokyo' }]) });

    expect(jsonOf(await handlers.listSettings())).toEqual({ settings: [{ id: 'timezone', value: 'Asia/Tokyo' }] });
  });

  it('get_setting passes the id', async () => {
    const get = recorder((input: SettingRef) => okAsync({ id: input.settingId, value: '1' }));
    const handlers = handlersWith({ getSetting: get.fn });

    expect(jsonOf(await handlers.getSetting({ settingId: 'weekStart' }))).toEqual({ id: 'weekStart', value: '1' });
  });

  it('get_setting points an unknown id at list_settings', async () => {
    const handlers = handlersWith({ getSetting: () => errAsync(new GoogleNotFoundError('Google API 404: Not Found')) });

    const text = errorTextOf(await handlers.getSetting({ settingId: 'nope' }));
    expect(text).toContain('list_settings');
    expect(text).not.toContain('list_tasks');
  });
});
