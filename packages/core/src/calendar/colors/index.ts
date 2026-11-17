import { z } from 'zod';

import { BASE_URL } from '../request';

import type { GoogleError } from '../../errors';
import type { GoogleClient } from '../../google-client';
import type { ColorDefinition, ColorPalettes } from '../index';
import type { ResultAsync } from 'neverthrow';

// colors.get: the fixed palettes calendar list entries (`calendar`) and events (`event`) pick their colorId from.

const paletteSchema = z.record(z.string(), z.object({ background: z.string(), foreground: z.string() }));

// Ids are numeric strings; order them numerically so "11" follows "10", not "1".
const byId = (a: ColorDefinition, b: ColorDefinition): number => parseInt(a.id, 10) - parseInt(b.id, 10) || a.id.localeCompare(b.id);

const toDefinitions = (palette: z.output<typeof paletteSchema>): readonly ColorDefinition[] =>
  Object.entries(palette)
    .map(([id, color]) => ({ id, background: color.background, foreground: color.foreground }))
    .toSorted(byId);

const colorsSchema: z.ZodType<ColorPalettes> = z
  .object({ calendar: paletteSchema.nullish(), event: paletteSchema.nullish() })
  .transform((colors) => ({ calendar: toDefinitions(colors.calendar ?? {}), event: toDefinitions(colors.event ?? {}) }));

export const getColors = (client: GoogleClient): ResultAsync<ColorPalettes, GoogleError> => client.request({ method: 'GET', url: `${BASE_URL}/colors`, schema: colorsSchema });
