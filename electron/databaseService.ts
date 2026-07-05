import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { sanitizeDocumentText } from '../src/shared/textSanitization';
import { ensureHelpNote } from './help/helpNote';
import type { TextureCacheHit, TextureCachePurgeRequest, TextureCacheRequest } from '../src/shared/textures';
import type {
  UiLayoutLoadout,
  UiLoadoutEntry,
  UiLoadoutListResult,
  UiLoadoutMode,
} from '../src/shared/loadouts';
import {
  idKind,
  idMode,
  modeSign,
  LOADOUT_DEFAULT_CUSTOM_ID_ABS,
  LOADOUT_PENDING_ID_ABS,
  LOADOUT_FIRST_CUSTOM_ID_ABS,
  LOADOUT_MAX_CUSTOM_SLOTS,
} from '../src/shared/loadouts';
import {
  LIGHT_FACTORY_PRESETS,
  DARK_FACTORY_PRESETS,
  NEUTRAL_BASE,
  DEFAULT_CUSTOM_LIGHT,
  DEFAULT_CUSTOM_DARK,
} from '../src/shared/presets';
import { DEFAULT_GLAZE_SETTINGS, sanitizeGlazeSettings } from '../src/shared/glaze';
import { DEFAULT_TEXTURE_MATERIALS, TEXTURE_SURFACES, type TextureMaterialSettings, type TextureMaterialsBySurface } from '../src/textures/types';
import type { MusicSongEntry, PlaylistSlot, PlaylistCountsResult } from '../src/shared/audioPlayer';
import { AUDIO_EXTENSIONS } from '../src/shared/audioPlayer';

const require = createRequire(import.meta.url);
const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');

const DB_FILE_NAME = 'measly-notes.db';
const EXTERNAL_TAG = 'EXTERNAL';
const PROTECTED_TAGS = ['deleted', 'archived', EXTERNAL_TAG] as const;
const META_PREFIX = '<!-- measly-meta:';
const META_SUFFIX = '-->';
const TEXTURE_CACHE_DEFAULT_MAX_ENTRIES = 96;
const TEXTURE_CACHE_DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

const DEFAULT_UI_LAYOUT_LOADOUT: UiLayoutLoadout = {
  editorGlyphPaddingPx: 1,
  borderRadiusRegularPx: 6,
  audioKeyVolume: 1,
  audioBassVolume: 0,
  audioTrebleVolume: 0,
  audioReverbStrength: 0,
  audioReverbSpace: 0,
  typingSoundEnabled: false,
  typingSoundSet: 'A',
  renderScrollDynamic: 1.5,
  renderScrollResponsiveness: 0.6,
  renderScrollTotalTimeSec: 0.4,
  renderScrollMaxSpeedPxPerSec: 6000,
  renderScrollSkew: 0.5,
  glaze: DEFAULT_GLAZE_SETTINGS,
  darkMode: 'none',
  filterInvert: 0,
  filterSepia: 0,
  filterHueRotate: 0,
  filterBrightness: 1,
  filterContrast: 1,
  filterSaturate: 0.5,
  filterColorize: 0,
  highlightColors: {
    caret: 'rgba(120, 115, 112, 0.8)',
    search: 'rgba(255, 221, 105, 0.55)',
    selectionEdit: 'rgba(199, 94, 0, 0.49)',
    selectionRender: 'rgba(199, 94, 0, 0.49)',
    textBase: '#000000DD',
    textEmbossEdit: '#ffffff',
    textEmbossRender: '#ffffff',
    textEmbossUi: '#ffffff',
    background: '#e9e6e3',
    topBackground: 'rgba(196, 187, 182, 0.49)',
    bottomBackground: 'rgba(196, 187, 182, 0.49)',
    gridOutline: '#00000022',
    grid: '#f9f6f3',
    base: '#f9f6f4',
    inputFields: '#ffffff',
    appButtons: '#FFFFFFBB',
    markdownHeadline: 'rgba(255, 0, 255, 1)',
    markdownList: 'rgba(0, 255, 255, 1)',
    markdownBlockquote: 'rgba(255, 255, 0, 1)',
    markdownCode: 'rgba(255, 0, 127, 1)',
    markdownChecked: 'rgba(0, 255, 0, 1)',
    markdownUnchecked: 'rgba(255, 0, 0, 1)',
  },
  textureMaterials: DEFAULT_TEXTURE_MATERIALS,
  editorTextColors: {
    editorEditText: '#000000DD',
    editorRenderText: '#000000DD',
  },
};

type SqliteDatabase = import('better-sqlite3').Database;

type NoteSyncRow = {
  id: string;
  title: string;
  filePath: string;
  text: string;
  tags: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

type NoteRecordRow = {
  id: string;
  title: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  contentChecksum: string | null;
  isTemp: number;
  externalPath: string | null;
  hasUnsavedChanges: number;
  syncMode: number;
};

export type NoteRecord = {
  id: string;
  title: string;
  filePath: string;
  createdAtMs: number;
  updatedAtMs: number;
  contentChecksum: string | null;
  isTemp: boolean;
  externalPath: string | null;
  hasUnsavedChanges: boolean;
  syncMode: boolean;
};

export type ExternalSyncState = {
  isExternal: boolean;
  hasUnsavedChanges: boolean;
  isInSync: boolean;
};

type ParsedLegacyNote = {
  tags: string[];
  bodyText: string;
  hasLegacyHeader: boolean;
};

function normalizeTagName(rawTag: string): string {
  const normalized = rawTag.trim().toLowerCase().replace(/\s+/g, '-');
  if (normalized === 'external') {
    return EXTERNAL_TAG;
  }
  return normalized;
}

function uniqueNormalizedTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map(normalizeTagName).filter((tag) => tag.length > 0)));
}

function ensureProtectedTagConstraints(tags: string[]): string[] {
  const normalized = uniqueNormalizedTags(tags);
  const archived = normalized.includes('archived');
  const deleted = normalized.includes('deleted');

  if (archived && deleted) {
    return normalized.filter((tag) => tag !== 'archived');
  }

  return normalized;
}

function withProtectedTagsFirst(tags: string[]): string[] {
  const normalized = ensureProtectedTagConstraints(tags);
  const protectedTags = normalized.filter((tag) => PROTECTED_TAGS.includes(tag as typeof PROTECTED_TAGS[number]));
  const regularTags = normalized.filter((tag) => !PROTECTED_TAGS.includes(tag as typeof PROTECTED_TAGS[number]));
  return [...protectedTags, ...regularTags];
}

function hasExternalTag(tags: string[]): boolean {
  return tags.includes(EXTERNAL_TAG);
}

function normalizeText(text: string): string {
  return sanitizeDocumentText(text);
}

function checksumText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function titleFromText(text: string): string {
  const lines = normalizeText(text).split('\n');
  const heading = lines.find((line) => line.startsWith('# ') && line.trim().length > 2);
  if (heading) return heading.slice(2).trim();

  const firstContent = lines.find((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && trimmed !== '#';
  });

  return firstContent?.trim() ?? 'Untitled';
}

function parseIsoToMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function parseLegacyMetadata(rawText: string): ParsedLegacyNote {
  const normalized = normalizeText(rawText);
  const lines = normalized.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  if (!firstLine.startsWith(META_PREFIX) || !firstLine.endsWith(META_SUFFIX)) {
    return { tags: [], bodyText: normalized, hasLegacyHeader: false };
  }

  const jsonPayload = firstLine.slice(META_PREFIX.length, firstLine.length - META_SUFFIX.length).trim();

  try {
    const parsed = JSON.parse(jsonPayload) as { tags?: unknown };
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
        .filter((value): value is string => typeof value === 'string')
        .map(normalizeTagName)
        .filter((value) => value.length > 0)
      : [];

    return {
      tags,
      bodyText: lines.slice(1).join('\n'),
      hasLegacyHeader: true,
    };
  } catch {
    return { tags: [], bodyText: normalized, hasLegacyHeader: false };
  }
}

type NormalizedTextureCacheRequest = {
  surface: TextureCacheRequest['surface'];
  width: number;
  height: number;
  seed: number;
  granularity: number;
  vSteps: number;
  algorithmVersion: number;
};

type UiLoadoutEntryRow = {
  id: number;
  isActive: number;
  signature: string;
  payloadJson: string;
  updatedAt: number;
};

function normalizeTextureCacheRequest(request: TextureCacheRequest): NormalizedTextureCacheRequest {
  return {
    surface: request.surface,
    width: Math.max(1, Math.round(request.width)),
    height: Math.max(1, Math.round(request.height)),
    seed: Math.max(0, Math.round(request.seed)),
    granularity: Number(request.granularity.toFixed(4)),
    vSteps: Math.max(1, Math.round(request.vSteps)),
    algorithmVersion: Math.max(1, Math.round(request.algorithmVersion)),
  };
}

function textureCacheCompositeKey(request: NormalizedTextureCacheRequest): string {
  return [
    request.surface,
    request.width,
    request.height,
    request.seed,
    request.granularity,
    request.vSteps,
    request.algorithmVersion,
  ].join('|');
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function roundForSignature(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sanitizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeTextureMaterialSettings(
  input: unknown,
  fallback: TextureMaterialSettings,
): TextureMaterialSettings {
  const source = input && typeof input === 'object' ? input as Partial<TextureMaterialSettings> : {};
  const color = source.color && typeof source.color === 'object'
    ? source.color as Partial<TextureMaterialSettings['color']>
    : {};

  return {
    enabled: source.enabled !== false,
    seed: clampInteger(source.seed, 0, 0x7fffffff, fallback.seed),
    granularity: clampInteger(source.granularity, 1, 20, fallback.granularity),
    vSteps: clampInteger(source.vSteps, 1, 20, fallback.vSteps),
    color: {
      h: clampInteger(color.h, 0, 360, fallback.color.h),
      s: roundForSignature(clampNumber(color.s, 0, 1, fallback.color.s)),
      v: roundForSignature(clampNumber(color.v, 0, 1, fallback.color.v)),
      a: roundForSignature(clampNumber(color.a, 0, 1, fallback.color.a)),
    },
  };
}

function normalizeTextureMaterials(input: unknown): TextureMaterialsBySurface {
  const source = input && typeof input === 'object' ? input as Partial<TextureMaterialsBySurface> : {};
  const next = { ...DEFAULT_TEXTURE_MATERIALS } as TextureMaterialsBySurface;

  for (const surface of TEXTURE_SURFACES) {
    next[surface] = normalizeTextureMaterialSettings(source[surface], DEFAULT_TEXTURE_MATERIALS[surface]);
  }

  return next;
}

function normalizeUiLayoutLoadout(input: unknown): UiLayoutLoadout | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const source = input as Partial<UiLayoutLoadout>;
  const highlights = source.highlightColors && typeof source.highlightColors === 'object'
    ? source.highlightColors as Partial<UiLayoutLoadout['highlightColors']>
    : {};

  const darkMode = source.darkMode === 'none' || source.darkMode === 'mono' || source.darkMode === 'red' || source.darkMode === 'dusk' || source.darkMode === 'neon' || source.darkMode === 'matrix'
    ? source.darkMode
    : DEFAULT_UI_LAYOUT_LOADOUT.darkMode;

  const legacySelection = sanitizeString((highlights as Record<string, unknown>).selection, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.selectionEdit);
  const legacyTextEmboss = sanitizeString((highlights as Record<string, unknown>).textEmboss, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.textEmbossUi);

  return {
    editorGlyphPaddingPx: clampInteger(source.editorGlyphPaddingPx, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.editorGlyphPaddingPx),
    borderRadiusRegularPx: clampInteger(source.borderRadiusRegularPx, 0, 20, DEFAULT_UI_LAYOUT_LOADOUT.borderRadiusRegularPx),
    audioKeyVolume: clampNumber(source.audioKeyVolume, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.audioKeyVolume),
    audioBassVolume: clampNumber(source.audioBassVolume, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.audioBassVolume),
    audioTrebleVolume: clampNumber(source.audioTrebleVolume, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.audioTrebleVolume),
    audioReverbStrength: clampNumber(source.audioReverbStrength, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.audioReverbStrength),
    audioReverbSpace: clampNumber(source.audioReverbSpace, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.audioReverbSpace),
    typingSoundEnabled: typeof source.typingSoundEnabled === 'boolean' ? source.typingSoundEnabled : DEFAULT_UI_LAYOUT_LOADOUT.typingSoundEnabled,
    renderScrollDynamic: roundForSignature(clampNumber(source.renderScrollDynamic, 0.1, 5, DEFAULT_UI_LAYOUT_LOADOUT.renderScrollDynamic)),
    renderScrollResponsiveness: roundForSignature(clampNumber(source.renderScrollResponsiveness, 0.1, 5, DEFAULT_UI_LAYOUT_LOADOUT.renderScrollResponsiveness)),
    renderScrollTotalTimeSec: roundForSignature(clampNumber(source.renderScrollTotalTimeSec, 0, 2, DEFAULT_UI_LAYOUT_LOADOUT.renderScrollTotalTimeSec)),
    renderScrollMaxSpeedPxPerSec: Math.round(clampNumber(source.renderScrollMaxSpeedPxPerSec, 1000, 100000, DEFAULT_UI_LAYOUT_LOADOUT.renderScrollMaxSpeedPxPerSec)),
    renderScrollSkew: roundForSignature(clampNumber(source.renderScrollSkew, 0.1, 0.9, DEFAULT_UI_LAYOUT_LOADOUT.renderScrollSkew)),
    typingSoundSet: source.typingSoundSet === 'A' || source.typingSoundSet === 'B' || source.typingSoundSet === 'C'
      ? source.typingSoundSet
      : DEFAULT_UI_LAYOUT_LOADOUT.typingSoundSet,
    glaze: sanitizeGlazeSettings(source.glaze, DEFAULT_UI_LAYOUT_LOADOUT.glaze),
    darkMode,
    filterInvert: Math.max(0, Math.min(1, source.filterInvert ?? 0)),
    filterSepia: Math.max(0, Math.min(1, source.filterSepia ?? 0)),
    filterHueRotate: Math.max(0, Math.min(360, source.filterHueRotate ?? 0)),
    filterBrightness: Math.max(0, Math.min(2, source.filterBrightness ?? 1)),
    filterContrast: Math.max(0, Math.min(2, source.filterContrast ?? 1)),
    filterSaturate: Math.max(0, Math.min(1, source.filterSaturate ?? 0.5)),
    filterColorize: Math.max(0, Math.min(1, source.filterColorize ?? 0)),
    highlightColors: {
      caret: sanitizeString(highlights.caret, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.caret),
      search: sanitizeString(highlights.search, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.search),
      selectionEdit: sanitizeString(highlights.selectionEdit, legacySelection),
      selectionRender: sanitizeString(highlights.selectionRender, legacySelection),
      textBase: sanitizeString(highlights.textBase, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.textBase),
      textEmbossEdit: sanitizeString(highlights.textEmbossEdit, legacyTextEmboss),
      textEmbossRender: sanitizeString(highlights.textEmbossRender, legacyTextEmboss),
      textEmbossUi: sanitizeString(highlights.textEmbossUi, legacyTextEmboss),
      background: sanitizeString(highlights.background, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.background),
      topBackground: sanitizeString(highlights.topBackground, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.topBackground),
      bottomBackground: sanitizeString(highlights.bottomBackground, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.bottomBackground),
      gridOutline: sanitizeString(highlights.gridOutline, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.gridOutline),
      grid: sanitizeString(highlights.grid, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.grid),
      base: sanitizeString(highlights.base, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.base),
      inputFields: sanitizeString(highlights.inputFields, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.inputFields),
      appButtons: sanitizeString(highlights.appButtons, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.appButtons),
      markdownHeadline: sanitizeString(highlights.markdownHeadline, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.markdownHeadline),
      markdownList: sanitizeString(highlights.markdownList, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.markdownList),
      markdownBlockquote: sanitizeString(highlights.markdownBlockquote, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.markdownBlockquote),
      markdownCode: sanitizeString(highlights.markdownCode, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.markdownCode),
      markdownChecked: sanitizeString(highlights.markdownChecked, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.markdownChecked),
      markdownUnchecked: sanitizeString(highlights.markdownUnchecked, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.markdownUnchecked),
    },
    textureMaterials: normalizeTextureMaterials(source.textureMaterials),
    editorTextColors: {
      editorEditText: typeof source.editorTextColors === 'object' && source.editorTextColors !== null && typeof (source.editorTextColors as Record<string, unknown>).editorEditText === 'string'
        ? String((source.editorTextColors as Record<string, unknown>).editorEditText)
        : DEFAULT_UI_LAYOUT_LOADOUT.editorTextColors.editorEditText,
      editorRenderText: typeof source.editorTextColors === 'object' && source.editorTextColors !== null && typeof (source.editorTextColors as Record<string, unknown>).editorRenderText === 'string'
        ? String((source.editorTextColors as Record<string, unknown>).editorRenderText)
        : DEFAULT_UI_LAYOUT_LOADOUT.editorTextColors.editorRenderText,
    },
  };
}

// ---------------------------------------------------------------------------
// TDL (Thockdown Layout) import/export helpers
// ---------------------------------------------------------------------------

// Ordered list of scalar UiLayoutLoadout keys used for diff lines.
const TDL_SCALAR_KEYS: ReadonlyArray<keyof UiLayoutLoadout> = [
  'editorGlyphPaddingPx',
  'borderRadiusRegularPx',
  'audioKeyVolume', 'audioBassVolume', 'audioTrebleVolume', 'audioReverbStrength', 'audioReverbSpace',
  'typingSoundEnabled', 'typingSoundSet',
  'renderScrollDynamic', 'renderScrollResponsiveness', 'renderScrollTotalTimeSec',
  'renderScrollMaxSpeedPxPerSec', 'renderScrollSkew',
  'darkMode',
  'filterInvert', 'filterSepia', 'filterHueRotate', 'filterBrightness',
  'filterContrast', 'filterSaturate', 'filterColorize',
];

// Keys whose values are nested objects; they're emitted as inline JSON when
// they differ from NEUTRAL_BASE (DEFAULT_CUSTOM_LIGHT).
const TDL_OBJECT_KEYS: ReadonlyArray<keyof UiLayoutLoadout> = [
  'glaze', 'highlightColors', 'editorTextColors', 'textureMaterials',
];

function formatTdlScalar(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  return String(value); // number or boolean
}

function buildNeutralBaseObjectDiff(value: unknown, baseValue: unknown): unknown | undefined {
  if (value === null || typeof value !== 'object') {
    return stableStringify(value) !== stableStringify(baseValue) ? value : undefined;
  }

  if (Array.isArray(value)) {
    return stableStringify(value) !== stableStringify(baseValue) ? value : undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  const result: Record<string, unknown> = {};
  const baseObject = typeof baseValue === 'object' && baseValue !== null && !Array.isArray(baseValue)
    ? (baseValue as Record<string, unknown>)
    : {};

  for (const [key, nestedValue] of entries) {
    const nestedBaseValue = baseObject[key];
    const diff = buildNeutralBaseObjectDiff(nestedValue, nestedBaseValue);
    if (diff !== undefined) {
      result[key] = diff;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/** Build the override fragment of one .tdl line against NEUTRAL_BASE. */
function buildNeutralBaseDiff(payload: Record<string, unknown>): string[] {
  const base = NEUTRAL_BASE as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of TDL_SCALAR_KEYS) {
    const val = payload[key];
    const baseVal = base[key];
    if (val !== undefined && val !== baseVal) {
      parts.push(`${key}: ${formatTdlScalar(val)}`);
    }
  }

  for (const key of TDL_OBJECT_KEYS) {
    const val = payload[key];
    const baseVal = base[key];
    if (val === undefined) continue;

    const diff = buildNeutralBaseObjectDiff(val, baseVal);
    if (diff !== undefined) {
      parts.push(`${key}: ${JSON.stringify(diff)}`);
    }
  }

  return parts;
}

/** Parse unquoted-key override string from a .tdl line. */
function parseTdlOverrides(overrideStr: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let pos = 0;
  const str = overrideStr.trim();

  while (pos < str.length) {
    // skip commas and whitespace between fields
    while (pos < str.length && /[,\s]/.test(str[pos])) pos++;
    if (pos >= str.length) break;

    // unquoted identifier key
    const keyMatch = /^([a-zA-Z_]\w*)/.exec(str.slice(pos));
    if (!keyMatch) break;
    const key = keyMatch[1];
    pos += key.length;

    // skip colon and surrounding whitespace
    while (pos < str.length && (str[pos] === ':' || str[pos] === ' ')) pos++;
    if (pos >= str.length) break;

    const rest = str.slice(pos);

    if (rest[0] === '{') {
      // inline JSON object — balance braces
      let depth = 0;
      let endIdx = -1;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '{') depth++;
        else if (rest[i] === '}') {
          depth--;
          if (depth === 0) { endIdx = i; break; }
        }
      }
      if (endIdx < 0) break;
      try {
        result[key] = JSON.parse(rest.slice(0, endIdx + 1));
      } catch {
        // malformed — skip this field
      }
      pos += endIdx + 1;
    } else if (rest[0] === "'") {
      // single-quoted string
      let end = 1;
      while (end < rest.length && rest[end] !== "'") end++;
      result[key] = rest.slice(1, end);
      pos += end + 1;
    } else if (rest[0] === '"') {
      // double-quoted string
      let end = 1;
      while (end < rest.length && rest[end] !== '"') end++;
      result[key] = rest.slice(1, end);
      pos += end + 1;
    } else if (rest.startsWith('true')) {
      result[key] = true; pos += 4;
    } else if (rest.startsWith('false')) {
      result[key] = false; pos += 5;
    } else {
      const numMatch = /^-?\d+(?:\.\d+)?/.exec(rest);
      if (numMatch) {
        result[key] = parseFloat(numMatch[0]);
        pos += numMatch[0].length;
      } else {
        break; // can't parse — bail
      }
    }
  }

  return result;
}

/** Parse an entire .tdl file into (original-id, overrides) pairs. */
function parseTdlContent(content: string): Array<{ id: number; overrides: Record<string, unknown> }> {
  const result: Array<{ id: number; overrides: Record<string, unknown> }> = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    // e.g.  8: { ...NEUTRAL_BASE, filterInvert: 1 },
    const m = /^(-?\d+):\s*\{\s*\.\.\.\s*NEUTRAL_BASE\s*(?:,\s*([\s\S]*?))?\s*\},?\s*$/.exec(line);
    if (!m) continue;

    const id = parseInt(m[1], 10);
    if (!Number.isFinite(id) || id === 0) continue;

    const overrides = m[2] ? parseTdlOverrides(m[2]) : {};
    result.push({ id, overrides });
  }

  return result;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
  return `{${entries.join(',')}}`;
}

export class DatabaseService {
  private readonly dataRoot: string;
  private readonly notesDir: string;
  private readonly dbPath: string;
  private db: SqliteDatabase | null = null;

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot;
    this.notesDir = path.join(dataRoot, 'notes');
    this.dbPath = path.join(dataRoot, DB_FILE_NAME);
  }

  /** The on-disk directory note content files live in (see upsertNoteContent). */
  getNotesDir(): string {
    return this.notesDir;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataRoot, { recursive: true });

    const db = new BetterSqlite3(this.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');

    this.db = db;
    this.ensureSchema();
    this.ensureProtectedTags();
    await ensureHelpNote(this);
    this.ensureLoadoutsSeeded();
  }

  close(): void {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  async bootstrapFromFilesystem(): Promise<void> {
    await fs.mkdir(this.notesDir, { recursive: true });
    const db = this.requireDb();

    const entries = await fs.readdir(this.notesDir, { withFileTypes: true });
    const fileNames = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name);

    const syncedRows: NoteSyncRow[] = [];
    const existingRows = db.prepare(`
      SELECT nt.noteId AS noteId, t.name AS tagName
      FROM note_tags nt
      JOIN tags t ON nt.tagId = t.id
      ORDER BY nt.noteId ASC, nt.position ASC
    `).all() as Array<{ noteId: string; tagName: string }>;
    const existingTagsByNoteId = new Map<string, string[]>();
    for (const row of existingRows) {
      if (!existingTagsByNoteId.has(row.noteId)) {
        existingTagsByNoteId.set(row.noteId, []);
      }
      existingTagsByNoteId.get(row.noteId)!.push(row.tagName);
    }

    for (const fileName of fileNames) {
      const filePath = path.join(this.notesDir, fileName);
      const [stat, rawText] = await Promise.all([
        fs.stat(filePath),
        fs.readFile(filePath, 'utf8'),
      ]);
      const parsed = parseLegacyMetadata(rawText);
      const id = fileName.replace(/\.md$/i, '');
      syncedRows.push({
        id,
        title: titleFromText(parsed.bodyText),
        filePath,
        text: parsed.bodyText,
        tags: parsed.hasLegacyHeader
          ? withProtectedTagsFirst(parsed.tags)
          : withProtectedTagsFirst(existingTagsByNoteId.get(id) ?? []),
        createdAtMs: stat.birthtimeMs || stat.mtimeMs,
        updatedAtMs: stat.mtimeMs,
      });
    }

    const upsertNoteStmt = db.prepare(`
      INSERT INTO notes (
        id,
        title,
        filePath,
        createdAt,
        updatedAt,
        lastEdited,
        contentChecksum,
        isTemp,
        hasUnsavedChanges,
        syncMode
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        filePath = excluded.filePath,
        createdAt = excluded.createdAt,
        updatedAt = excluded.updatedAt,
        lastEdited = excluded.lastEdited,
        contentChecksum = excluded.contentChecksum
    `);

    const deleteMissingNotesStmt = db.prepare('DELETE FROM notes WHERE id = ?');
    const deleteNoteTagsStmt = db.prepare('DELETE FROM note_tags WHERE noteId = ?');
    const insertNoteTagStmt = db.prepare('INSERT OR REPLACE INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)');
    const selectAllNoteIdsStmt = db.prepare('SELECT id FROM notes');

    const findTagStmt = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertTagStmt = db.prepare('INSERT INTO tags (name) VALUES (?)');

    const upsertFtsStmt = db.prepare('INSERT OR REPLACE INTO notes_fts (noteId, title, content) VALUES (?, ?, ?)');
    const deleteMissingFtsStmt = db.prepare('DELETE FROM notes_fts WHERE noteId = ?');

    const toIso = (timestampMs: number): string => new Date(timestampMs).toISOString();

    const getOrCreateTagId = (tagNameRaw: string): number => {
      const tagName = normalizeTagName(tagNameRaw);
      if (!tagName) {
        throw new Error('Cannot create empty tag');
      }
      const existing = findTagStmt.get(tagName) as { id: number } | undefined;
      if (existing) return existing.id;
      const created = insertTagStmt.run(tagName);
      return Number(created.lastInsertRowid);
    };

    const seenIds = new Set<string>();

    const tx = db.transaction((rows: NoteSyncRow[]) => {
      for (const row of rows) {
        const createdAtIso = toIso(row.createdAtMs);
        const updatedAtIso = toIso(row.updatedAtMs);

        upsertNoteStmt.run(
          row.id,
          row.title,
          row.filePath,
          createdAtIso,
          updatedAtIso,
          updatedAtIso,
          checksumText(row.text),
        );

        deleteNoteTagsStmt.run(row.id);
        row.tags.forEach((tagName, position) => {
          const tagId = getOrCreateTagId(tagName);
          insertNoteTagStmt.run(row.id, tagId, position);
        });

        seenIds.add(row.id);
      }

      const existingIds = selectAllNoteIdsStmt.all() as Array<{ id: string }>;
      for (const { id } of existingIds) {
        if (seenIds.has(id)) continue;
        deleteMissingNotesStmt.run(id);
        deleteMissingFtsStmt.run(id);
      }
    });

    tx(syncedRows);

    for (const row of syncedRows) {
      upsertFtsStmt.run(row.id, row.title, row.text);
    }

    this.normalizeAllTagPositions();
  }

  runSanityChecks(): {
    normalizedTagOrderCount: number;
    missingNoteFiles: string[];
    orphanedTagRows: number;
  } {
    const db = this.requireDb();

    const missingNoteFiles: string[] = [];

    const orphanedTagRows = Number((db.prepare(`
      SELECT COUNT(*) AS c
      FROM note_tags nt
      LEFT JOIN notes n ON n.id = nt.noteId
      LEFT JOIN tags t ON t.id = nt.tagId
      WHERE n.id IS NULL OR t.id IS NULL
    `).get() as { c: number }).c);

    const normalizedTagOrderCount = this.normalizeAllTagPositions();

    const fsRows = db.prepare('SELECT id, filePath FROM notes').all() as Array<{ id: string; filePath: string }>;
    for (const row of fsRows) {
      try {
        // Synchronous exists-check keeps startup cheap and deterministic.
        const exists = existsSync(row.filePath);
        if (!exists) {
          missingNoteFiles.push(row.id);
        }
      } catch {
        missingNoteFiles.push(row.id);
      }
    }

    return {
      normalizedTagOrderCount,
      missingNoteFiles,
      orphanedTagRows,
    };
  }

  upsertNoteContent(input: {
    id: string;
    title: string;
    filePath: string;
    text: string;
    createdAtMs: number;
    updatedAtMs: number;
    isTemp?: boolean;
    externalPath?: string | null;
    hasUnsavedChanges?: boolean;
    syncMode?: boolean;
  }): void {
    const db = this.requireDb();
    const createdAtIso = new Date(input.createdAtMs).toISOString();
    const updatedAtIso = new Date(input.updatedAtMs).toISOString();
    const normalizedText = normalizeText(input.text);
    const contentChecksum = checksumText(normalizedText);
    const isTemp = input.isTemp ? 1 : 0;
    const hasUnsavedChanges = input.hasUnsavedChanges ? 1 : 0;
    const syncMode = input.syncMode ? 1 : 0;

    db.prepare(`
      INSERT INTO notes (
        id,
        title,
        filePath,
        createdAt,
        updatedAt,
        lastEdited,
        contentChecksum,
        isTemp,
        externalPath,
        hasUnsavedChanges,
        syncMode
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        filePath = excluded.filePath,
        createdAt = excluded.createdAt,
        updatedAt = excluded.updatedAt,
        lastEdited = excluded.lastEdited,
        contentChecksum = excluded.contentChecksum,
        isTemp = excluded.isTemp,
        externalPath = excluded.externalPath,
        hasUnsavedChanges = excluded.hasUnsavedChanges,
        syncMode = excluded.syncMode
    `).run(
      input.id,
      input.title,
      input.filePath,
      createdAtIso,
      updatedAtIso,
      updatedAtIso,
      contentChecksum,
      isTemp,
      input.externalPath ?? null,
      hasUnsavedChanges,
      syncMode,
    );

    db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(input.id);
    db.prepare('INSERT INTO notes_fts (noteId, title, content) VALUES (?, ?, ?)')
      .run(input.id, input.title, normalizedText);
  }

  listNoteRecords(): NoteRecord[] {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT id, title, filePath, createdAt, updatedAt, contentChecksum, isTemp, externalPath, hasUnsavedChanges, syncMode
      FROM notes
      ORDER BY datetime(updatedAt) DESC
    `).all() as NoteRecordRow[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      filePath: row.filePath,
      createdAtMs: parseIsoToMs(row.createdAt),
      updatedAtMs: parseIsoToMs(row.updatedAt),
      contentChecksum: row.contentChecksum,
      isTemp: Boolean(row.isTemp),
      externalPath: row.externalPath,
      hasUnsavedChanges: Boolean(row.hasUnsavedChanges),
      syncMode: Boolean(row.syncMode),
    }));
  }

  getNoteRecord(noteId: string): NoteRecord | null {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT id, title, filePath, createdAt, updatedAt, contentChecksum, isTemp, externalPath, hasUnsavedChanges, syncMode
      FROM notes
      WHERE id = ?
      LIMIT 1
    `).get(noteId) as NoteRecordRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      filePath: row.filePath,
      createdAtMs: parseIsoToMs(row.createdAt),
      updatedAtMs: parseIsoToMs(row.updatedAt),
      contentChecksum: row.contentChecksum,
      isTemp: Boolean(row.isTemp),
      externalPath: row.externalPath,
      hasUnsavedChanges: Boolean(row.hasUnsavedChanges),
      syncMode: Boolean(row.syncMode),
    };
  }

  getNoteContentSnapshot(noteId: string): string | null {
    const db = this.requireDb();

    const snapshotRow = db.prepare(`
      SELECT content
      FROM note_snapshots
      WHERE noteId = ?
      ORDER BY datetime(timestamp) DESC
      LIMIT 1
    `).get(noteId) as { content: string } | undefined;

    if (snapshotRow?.content) {
      return snapshotRow.content;
    }

    const ftsRow = db.prepare('SELECT content FROM notes_fts WHERE noteId = ?').get(noteId) as { content: string } | undefined;
    return ftsRow?.content ?? null;
  }

  getExternalSyncState(noteId: string): ExternalSyncState {
    const record = this.getNoteRecord(noteId);
    if (!record?.isTemp) {
      return {
        isExternal: false,
        hasUnsavedChanges: false,
        isInSync: true,
      };
    }

    return {
      isExternal: true,
      hasUnsavedChanges: record.hasUnsavedChanges,
      isInSync: record.syncMode && !record.hasUnsavedChanges,
    };
  }

  deleteNote(id: string): void {
    const db = this.requireDb();
    db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(id);
  }

  getNoteTags(noteId: string): string[] {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT t.name
      FROM note_tags nt
      JOIN tags t ON nt.tagId = t.id
      WHERE nt.noteId = ?
      ORDER BY nt.position ASC
    `).all(noteId) as Array<{ name: string }>;

    return rows.map((row) => row.name);
  }

  addTagToNote(noteId: string, rawTagName: string, position: number): string[] {
    const normalizedTag = normalizeTagName(rawTagName);
    if (!normalizedTag) {
      return this.getNoteTags(noteId);
    }

    const current = this.getNoteTags(noteId);
    if (hasExternalTag(current) && normalizedTag !== EXTERNAL_TAG) {
      return current;
    }
    const withoutDup = current.filter((tag) => tag !== normalizedTag);
    const insertionIndex = Math.max(0, Math.min(Math.floor(position), withoutDup.length));
    withoutDup.splice(insertionIndex, 0, normalizedTag);

    let next = withoutDup;
    if (PROTECTED_TAGS.includes(normalizedTag as typeof PROTECTED_TAGS[number])) {
      next = [
        normalizedTag,
        ...withoutDup.filter((tag) => !PROTECTED_TAGS.includes(tag as typeof PROTECTED_TAGS[number])),
      ];
    }

    const finalTags = withProtectedTagsFirst(next);
    this.writeNoteTags(noteId, finalTags);
    return finalTags;
  }

  removeTagFromNote(noteId: string, rawTagName: string): string[] {
    const normalizedTag = normalizeTagName(rawTagName);
    const current = this.getNoteTags(noteId);
    if (hasExternalTag(current) && normalizedTag !== EXTERNAL_TAG) {
      return current;
    }
    const finalTags = withProtectedTagsFirst(current.filter((tag) => tag !== normalizedTag));
    this.writeNoteTags(noteId, finalTags);
    return finalTags;
  }

  reorderNoteTags(noteId: string, requestedTagNames: string[]): string[] {
    const current = this.getNoteTags(noteId);
    if (hasExternalTag(current)) {
      return current;
    }
    const requested = uniqueNormalizedTags(requestedTagNames);

    const merged: string[] = [];
    for (const tag of requested) {
      if (current.includes(tag)) {
        merged.push(tag);
      }
    }
    for (const tag of current) {
      if (!merged.includes(tag)) {
        merged.push(tag);
      }
    }

    const finalTags = withProtectedTagsFirst(merged);
    this.writeNoteTags(noteId, finalTags);
    return finalTags;
  }

  renameTag(input: { fromName: string; toName: string }): { updatedNoteIds: string[] } {
    const db = this.requireDb();
    const fromName = normalizeTagName(input.fromName);
    const toName = normalizeTagName(input.toName);

    if (!fromName || !toName || fromName === toName) {
      return { updatedNoteIds: [] };
    }

    if (PROTECTED_TAGS.includes(fromName as typeof PROTECTED_TAGS[number])) {
      throw new Error('This tag is protected and cannot be renamed');
    }

    const existingTag = db.prepare('SELECT id FROM tags WHERE name = ?').get(fromName) as { id: number } | undefined;
    if (!existingTag) {
      return { updatedNoteIds: [] };
    }

    const updatedNoteIds = db.prepare('SELECT noteId FROM note_tags WHERE tagId = ?').all(existingTag.id) as Array<{ noteId: string }>;
    const conflict = db.prepare('SELECT id FROM tags WHERE name = ?').get(toName) as { id: number } | undefined;

    const tx = db.transaction(() => {
      if (conflict && conflict.id !== existingTag.id) {
        db.prepare(`
          UPDATE note_tags
          SET tagId = ?
          WHERE tagId = ?
            AND NOT EXISTS (
              SELECT 1
              FROM note_tags nt2
              WHERE nt2.noteId = note_tags.noteId
                AND nt2.tagId = ?
            )
        `).run(conflict.id, existingTag.id, conflict.id);

        db.prepare('DELETE FROM note_tags WHERE tagId = ?').run(existingTag.id);
        db.prepare('DELETE FROM tags WHERE id = ?').run(existingTag.id);
      } else {
        db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(toName, existingTag.id);
      }
    });

    tx();

    return { updatedNoteIds: updatedNoteIds.map((row) => row.noteId) };
  }

  listTags(): Array<{ name: string; usageCount: number }> {
    const db = this.requireDb();

    return db.prepare(`
      SELECT t.name AS name, COUNT(nt.noteId) AS usageCount
      FROM tags t
      LEFT JOIN note_tags nt ON t.id = nt.tagId
      GROUP BY t.id, t.name
      HAVING usageCount > 0 OR t.name IN ('deleted', 'archived', 'EXTERNAL')
      ORDER BY usageCount DESC, t.name ASC
    `).all() as Array<{ name: string; usageCount: number }>;
  }

  getLastEditedNoteId(): string | null {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT id
      FROM notes
      WHERE lastEdited IS NOT NULL
      ORDER BY datetime(lastEdited) DESC
      LIMIT 1
    `).get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  getTrashNoteIds(): string[] {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT n.id AS id
      FROM notes n
      JOIN note_tags nt ON n.id = nt.noteId
      JOIN tags t ON nt.tagId = t.id
      WHERE LOWER(t.name) = 'deleted'
      ORDER BY datetime(n.lastEdited) DESC, datetime(n.updatedAt) DESC
    `).all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  searchNoteIdsByTag(tagQuery: string): string[] {
    const db = this.requireDb();
    const normalized = normalizeTagName(tagQuery);
    if (!normalized) return [];

    const rows = db.prepare(`
      SELECT DISTINCT n.id AS id
      FROM notes n
      JOIN note_tags nt ON n.id = nt.noteId
      JOIN tags t ON nt.tagId = t.id
      WHERE LOWER(t.name) LIKE ?
      ORDER BY datetime(n.updatedAt) DESC
    `).all(`%${normalized}%`) as Array<{ id: string }>;

    return rows.map((row) => row.id);
  }

  saveNoteUiState(noteId: string, payload: {
    progressPreview?: number | null;
    progressEdit?: number | null;
    cursorPos?: number | null;
    scrollTop?: number | null;
    sourceAnchorLine?: number | null;
    sourceAnchorText?: string | null;
  }): void {
    const db = this.requireDb();
    const hasProgressPreview = Object.prototype.hasOwnProperty.call(payload, 'progressPreview');
    const hasProgressEdit = Object.prototype.hasOwnProperty.call(payload, 'progressEdit');
    const hasCursorPos = Object.prototype.hasOwnProperty.call(payload, 'cursorPos');
    const hasScrollTop = Object.prototype.hasOwnProperty.call(payload, 'scrollTop');
    const hasSourceAnchorLine = Object.prototype.hasOwnProperty.call(payload, 'sourceAnchorLine');
    const hasSourceAnchorText = Object.prototype.hasOwnProperty.call(payload, 'sourceAnchorText');

    db.prepare(`
      UPDATE notes
      SET
        progressPreview = CASE WHEN ? THEN ? ELSE progressPreview END,
        progressEdit = CASE WHEN ? THEN ? ELSE progressEdit END,
        cursorPos = CASE WHEN ? THEN ? ELSE cursorPos END,
        scrollTop = CASE WHEN ? THEN ? ELSE scrollTop END,
        sourceAnchorLine = CASE WHEN ? THEN ? ELSE sourceAnchorLine END,
        sourceAnchorText = CASE WHEN ? THEN ? ELSE sourceAnchorText END
      WHERE id = ?
    `).run(
      hasProgressPreview ? 1 : 0,
      payload.progressPreview ?? null,
      hasProgressEdit ? 1 : 0,
      payload.progressEdit ?? null,
      hasCursorPos ? 1 : 0,
      payload.cursorPos ?? null,
      hasScrollTop ? 1 : 0,
      payload.scrollTop ?? null,
      hasSourceAnchorLine ? 1 : 0,
      payload.sourceAnchorLine ?? null,
      hasSourceAnchorText ? 1 : 0,
      payload.sourceAnchorText ?? null,
      noteId,
    );
  }

  getNoteUiState(noteId: string): {
    progressPreview: number | null;
    progressEdit: number | null;
    cursorPos: number | null;
    scrollTop: number | null;
    sourceAnchorLine: number | null;
    sourceAnchorText: string | null;
  } {
    const db = this.requireDb();

    const row = db.prepare(`
      SELECT progressPreview, progressEdit, cursorPos, scrollTop, sourceAnchorLine, sourceAnchorText
      FROM notes
      WHERE id = ?
    `).get(noteId) as {
      progressPreview?: number | null;
      progressEdit?: number | null;
      cursorPos?: number | null;
      scrollTop?: number | null;
      sourceAnchorLine?: number | null;
      sourceAnchorText?: string | null;
    } | undefined;

    return {
      progressPreview: row?.progressPreview ?? null,
      progressEdit: row?.progressEdit ?? null,
      cursorPos: row?.cursorPos ?? null,
      scrollTop: row?.scrollTop ?? null,
      sourceAnchorLine: row?.sourceAnchorLine ?? null,
      sourceAnchorText: row?.sourceAnchorText ?? null,
    };
  }

  saveNoteSnapshot(noteId: string, content: string, isManual = false): void {
    const db = this.requireDb();
    const timestamp = new Date().toISOString();

    const tx = db.transaction(() => {
      if (!isManual) {
        db.prepare('DELETE FROM note_snapshots WHERE noteId = ? AND isManual = 0').run(noteId);
      }
      db.prepare(`
        INSERT INTO note_snapshots (noteId, content, timestamp, isManual)
        VALUES (?, ?, ?, ?)
      `).run(noteId, content, timestamp, isManual ? 1 : 0);
    });

    tx();
  }

  getNoteSnapshots(noteId: string): Array<{
    id: number;
    noteId: string;
    content: string;
    timestamp: string;
    isManual: boolean;
  }> {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT id, noteId, content, timestamp, isManual
      FROM note_snapshots
      WHERE noteId = ?
      ORDER BY datetime(timestamp) DESC
    `).all(noteId) as Array<{
      id: number;
      noteId: string;
      content: string;
      timestamp: string;
      isManual: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      noteId: row.noteId,
      content: row.content,
      timestamp: row.timestamp,
      isManual: Boolean(row.isManual),
    }));
  }

  deleteNoteSnapshot(snapshotId: number): void {
    const db = this.requireDb();
    db.prepare('DELETE FROM note_snapshots WHERE id = ?').run(snapshotId);
  }

  createTempNote(input: { title: string; externalPath: string; originalEncoding?: string }): string {
    const db = this.requireDb();
    const id = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO notes (
        id,
        title,
        filePath,
        createdAt,
        updatedAt,
        lastEdited,
        contentChecksum,
        isTemp,
        externalPath,
        hasUnsavedChanges,
        syncMode,
        originalEncoding
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0, ?)
    `).run(
      id,
      input.title,
      input.externalPath,
      now,
      now,
      now,
      null,
      input.externalPath,
      input.originalEncoding ?? null,
    );

    const tempTagId = this.getOrCreateTagId(EXTERNAL_TAG);
    this.writeTagRelations(id, [tempTagId]);

    return id;
  }

  updateTempNoteState(noteId: string, hasUnsavedChanges: boolean, syncMode: boolean): void {
    const db = this.requireDb();
    db.prepare(`
      UPDATE notes
      SET hasUnsavedChanges = ?, syncMode = ?, updatedAt = ?
      WHERE id = ? AND isTemp = 1
    `).run(hasUnsavedChanges ? 1 : 0, syncMode ? 1 : 0, new Date().toISOString(), noteId);
  }

  convertTempNoteToRegular(noteId: string, newFilePath: string): void {
    const db = this.requireDb();
    db.prepare(`
      UPDATE notes
      SET
        isTemp = 0,
        filePath = ?,
        externalPath = NULL,
        hasUnsavedChanges = 0,
        syncMode = 0,
        originalEncoding = NULL,
        updatedAt = ?
      WHERE id = ? AND isTemp = 1
    `).run(newFilePath, new Date().toISOString(), noteId);

    const tempTagId = this.findTagIdByName(EXTERNAL_TAG);
    if (tempTagId !== null) {
      const dbRows = db.prepare('SELECT tagId FROM note_tags WHERE noteId = ? ORDER BY position ASC').all(noteId) as Array<{ tagId: number }>;
      const filtered = dbRows.map((row) => row.tagId).filter((tagId) => tagId !== tempTagId);
      this.writeTagRelations(noteId, filtered);
    }
  }

  markExternalNoteSynced(noteId: string): void {
    const db = this.requireDb();
    db.prepare(`
      UPDATE notes
      SET hasUnsavedChanges = 0, syncMode = 1, updatedAt = ?
      WHERE id = ? AND isTemp = 1
    `).run(new Date().toISOString(), noteId);
  }

  getTempNoteIds(): string[] {
    const db = this.requireDb();
    const rows = db.prepare('SELECT id FROM notes WHERE isTemp = 1 ORDER BY datetime(lastEdited) DESC').all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  getTempNoteIdByExternalPath(externalPath: string): string | null {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT id
      FROM notes
      WHERE isTemp = 1 AND externalPath = ?
      ORDER BY datetime(updatedAt) DESC
      LIMIT 1
    `).get(externalPath) as { id: string } | undefined;

    return row?.id ?? null;
  }

  deleteTempNote(noteId: string): void {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM note_snapshots WHERE noteId = ?').run(noteId);
      db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
      db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(noteId);
    });
    tx();
  }

  getTextureCache(request: TextureCacheRequest): TextureCacheHit | null {
    const db = this.requireDb();
    const normalized = normalizeTextureCacheRequest(request);

    const row = db.prepare(`
      SELECT data, mimeType
      FROM texture_pattern_cache
      WHERE surface = ?
        AND width = ?
        AND height = ?
        AND seed = ?
        AND granularity = ?
        AND vSteps = ?
        AND algorithmVersion = ?
      LIMIT 1
    `).get(
      normalized.surface,
      normalized.width,
      normalized.height,
      normalized.seed,
      normalized.granularity,
      normalized.vSteps,
      normalized.algorithmVersion,
    ) as { data: Buffer; mimeType: string } | undefined;

    if (!row) {
      return null;
    }

    db.prepare(`
      UPDATE texture_pattern_cache
      SET createdAt = ?
      WHERE surface = ?
        AND width = ?
        AND height = ?
        AND seed = ?
        AND granularity = ?
        AND vSteps = ?
        AND algorithmVersion = ?
    `).run(
      Date.now(),
      normalized.surface,
      normalized.width,
      normalized.height,
      normalized.seed,
      normalized.granularity,
      normalized.vSteps,
      normalized.algorithmVersion,
    );

    return {
      data: new Uint8Array(row.data),
      mimeType: row.mimeType,
    };
  }

  saveTextureCache(request: TextureCacheRequest, payload: TextureCacheHit): void {
    const db = this.requireDb();
    const normalized = normalizeTextureCacheRequest(request);

    db.prepare(`
      INSERT OR REPLACE INTO texture_pattern_cache (
        surface,
        width,
        height,
        seed,
        granularity,
        vSteps,
        algorithmVersion,
        data,
        mimeType,
        createdAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalized.surface,
      normalized.width,
      normalized.height,
      normalized.seed,
      normalized.granularity,
      normalized.vSteps,
      normalized.algorithmVersion,
      Buffer.from(payload.data),
      payload.mimeType || 'image/webp',
      Date.now(),
    );

    this.purgeTextureCache();
  }

  purgeTextureCache(request?: TextureCachePurgeRequest): number {
    const db = this.requireDb();
    const maxEntries = Math.max(0, Math.floor(request?.maxEntries ?? TEXTURE_CACHE_DEFAULT_MAX_ENTRIES));
    const maxAgeMs = Math.max(0, Math.floor(request?.maxAgeMs ?? TEXTURE_CACHE_DEFAULT_MAX_AGE_MS));
    const keep = Array.isArray(request?.keep) ? request.keep : [];
    const keepKeys = new Set(keep.map((item) => textureCacheCompositeKey(normalizeTextureCacheRequest(item))));
    const cutoffMs = Date.now() - maxAgeMs;

    const rows = db.prepare(`
      SELECT rowid, surface, width, height, seed, granularity, vSteps, algorithmVersion, createdAt
      FROM texture_pattern_cache
      ORDER BY createdAt DESC
    `).all() as Array<{
      rowid: number;
      surface: TextureCacheRequest['surface'];
      width: number;
      height: number;
      seed: number;
      granularity: number;
      vSteps: number;
      algorithmVersion: number;
      createdAt: number;
    }>;

    const deleteStmt = db.prepare('DELETE FROM texture_pattern_cache WHERE rowid = ?');
    let retainedCount = 0;
    let deletedCount = 0;

    const tx = db.transaction(() => {
      for (const row of rows) {
        const key = textureCacheCompositeKey({
          surface: row.surface,
          width: row.width,
          height: row.height,
          seed: row.seed,
          granularity: row.granularity,
          vSteps: row.vSteps,
          algorithmVersion: row.algorithmVersion,
        });

        const isProtected = keepKeys.has(key);
        const isExpired = row.createdAt < cutoffMs;
        const exceedsCap = maxEntries > 0 && retainedCount >= maxEntries;

        if (!isProtected && (isExpired || exceedsCap)) {
          deleteStmt.run(row.rowid);
          deletedCount += 1;
          continue;
        }

        retainedCount += 1;
      }
    });

    tx();
    return deletedCount;
  }

  // -------------------------------------------------------------------------
  // UI Loadouts — see src/shared/loadouts.ts for the id/mode/kind scheme.
  // -------------------------------------------------------------------------

  private ensureLoadoutsSeeded(): void {
    const db = this.requireDb();
    const countRow = db.prepare('SELECT COUNT(*) as n FROM ui_loadout_entries').get() as { n: number };
    if (countRow.n > 0) {
      this.refreshHardcodedLoadoutRows();
      this.normalizeStoredLoadoutRows();
      return;
    }

    const timestamp = Date.now();
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO ui_loadout_entries (id, isActive, signature, payloadJson, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      const seedRow = (id: number, payload: UiLayoutLoadout, isActive: boolean) => {
        const normalized = normalizeUiLayoutLoadout(payload) ?? DEFAULT_UI_LAYOUT_LOADOUT;
        insertStmt.run(id, isActive ? 1 : 0, stableStringify(normalized), JSON.stringify(normalized), timestamp);
      };

      LIGHT_FACTORY_PRESETS.forEach((preset, index) => seedRow(index + 1, preset, false));
      DARK_FACTORY_PRESETS.forEach((preset, index) => seedRow(-(index + 1), preset, false));

      seedRow(LOADOUT_DEFAULT_CUSTOM_ID_ABS, DEFAULT_CUSTOM_LIGHT, true);
      seedRow(-LOADOUT_DEFAULT_CUSTOM_ID_ABS, DEFAULT_CUSTOM_DARK, true);

      // Pending rows start as inert copies of the default-custom rows.
      seedRow(LOADOUT_PENDING_ID_ABS, DEFAULT_CUSTOM_LIGHT, false);
      seedRow(-LOADOUT_PENDING_ID_ABS, DEFAULT_CUSTOM_DARK, false);

      const metaStmt = db.prepare(`INSERT OR REPLACE INTO ui_loadout_meta (key, value) VALUES (?, ?)`);
      metaStmt.run('lastCustomId:light', String(LOADOUT_DEFAULT_CUSTOM_ID_ABS));
      metaStmt.run('lastCustomId:dark', String(-LOADOUT_DEFAULT_CUSTOM_ID_ABS));
    });

    tx();
    this.normalizeStoredLoadoutRows();
  }

  private refreshHardcodedLoadoutRows(): void {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT id, signature, payloadJson
      FROM ui_loadout_entries
      WHERE ABS(id) < ?
    `).all(LOADOUT_DEFAULT_CUSTOM_ID_ABS) as Array<{ id: number; signature: string; payloadJson: string }>;

    const existing = new Map<number, { signature: string; payloadJson: string }>();
    for (const row of rows) {
      existing.set(row.id, { signature: row.signature, payloadJson: row.payloadJson });
    }

    const updateStmt = db.prepare(`
      UPDATE ui_loadout_entries
      SET signature = ?, payloadJson = ?, updatedAt = ?
      WHERE id = ?
    `);
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO ui_loadout_entries (id, isActive, signature, payloadJson, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `);

    const timestamp = Date.now();
    const seedRows: Array<{ id: number; payload: UiLayoutLoadout }> = [];

    LIGHT_FACTORY_PRESETS.forEach((preset, index) => seedRows.push({ id: index + 1, payload: preset }));
    DARK_FACTORY_PRESETS.forEach((preset, index) => seedRows.push({ id: -(index + 1), payload: preset }));
    seedRows.push({ id: LOADOUT_DEFAULT_CUSTOM_ID_ABS, payload: DEFAULT_CUSTOM_LIGHT });
    seedRows.push({ id: -LOADOUT_DEFAULT_CUSTOM_ID_ABS, payload: DEFAULT_CUSTOM_DARK });

    const upsert = db.transaction(() => {
      for (const { id, payload } of seedRows) {
        const normalized = normalizeUiLayoutLoadout(payload) ?? DEFAULT_UI_LAYOUT_LOADOUT;
        const signature = stableStringify(normalized);
        const payloadJson = JSON.stringify(normalized);

        const row = existing.get(id);
        if (row) {
          if (row.signature !== signature || row.payloadJson !== payloadJson) {
            updateStmt.run(signature, payloadJson, timestamp, id);
          }
          continue;
        }

        insertStmt.run(id, 0, signature, payloadJson, timestamp);
      }
    });

    upsert();
  }

  private normalizeStoredLoadoutRows(): void {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT id, signature, payloadJson
      FROM ui_loadout_entries
    `).all() as Array<{ id: number; signature: string; payloadJson: string }>;

    if (rows.length === 0) return;

    const updateStmt = db.prepare(`
      UPDATE ui_loadout_entries
      SET signature = ?, payloadJson = ?
      WHERE id = ?
    `);

    const tx = db.transaction(() => {
      for (const row of rows) {
        let normalized: UiLayoutLoadout;
        try {
          normalized = normalizeUiLayoutLoadout(JSON.parse(row.payloadJson)) ?? DEFAULT_UI_LAYOUT_LOADOUT;
        } catch {
          normalized = DEFAULT_UI_LAYOUT_LOADOUT;
        }

        const nextSignature = stableStringify(normalized);
        const nextPayloadJson = JSON.stringify(normalized);
        if (row.signature === nextSignature && row.payloadJson === nextPayloadJson) {
          continue;
        }

        updateStmt.run(nextSignature, nextPayloadJson, row.id);
      }
    });

    tx();
  }

  private readLoadoutMeta(key: string, fallback: number): number {
    const db = this.requireDb();
    const row = db.prepare('SELECT value FROM ui_loadout_meta WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return fallback;
    const parsed = Number.parseInt(row.value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private writeLoadoutMeta(key: string, value: number): void {
    const db = this.requireDb();
    db.prepare(`INSERT OR REPLACE INTO ui_loadout_meta (key, value) VALUES (?, ?)`).run(key, String(value));
  }

  private readLoadoutRow(id: number): UiLoadoutEntry | null {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT id, isActive, signature, payloadJson, updatedAt
      FROM ui_loadout_entries WHERE id = ?
    `).get(id) as UiLoadoutEntryRow | undefined;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  private rowToEntry(row: UiLoadoutEntryRow): UiLoadoutEntry {
    let payload: UiLayoutLoadout;
    try {
      payload = normalizeUiLayoutLoadout(JSON.parse(row.payloadJson)) ?? DEFAULT_UI_LAYOUT_LOADOUT;
    } catch {
      payload = DEFAULT_UI_LAYOUT_LOADOUT;
    }
    return {
      id: row.id,
      isActive: row.isActive === 1,
      signature: stableStringify(payload),
      payload,
      updatedAt: row.updatedAt,
    };
  }

  private buildListResult(): UiLoadoutListResult {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT id, isActive, signature, payloadJson, updatedAt
      FROM ui_loadout_entries
      ORDER BY id ASC
    `).all() as UiLoadoutEntryRow[];

    return {
      entries: rows.map((row) => this.rowToEntry(row)),
      lastCustomIdByMode: {
        light: this.readLoadoutMeta('lastCustomId:light', LOADOUT_DEFAULT_CUSTOM_ID_ABS),
        dark: this.readLoadoutMeta('lastCustomId:dark', -LOADOUT_DEFAULT_CUSTOM_ID_ABS),
      },
    };
  }

  listUiLoadouts(): UiLoadoutListResult {
    this.ensureLoadoutsSeeded();
    return this.buildListResult();
  }

  setActiveUiLoadout(id: unknown): UiLoadoutListResult {
    this.ensureLoadoutsSeeded();
    const db = this.requireDb();
    const targetId = typeof id === 'number' && Number.isInteger(id) ? id : null;
    if (targetId === null) return this.buildListResult();

    const existing = this.readLoadoutRow(targetId);
    if (!existing) return this.buildListResult();

    const mode: UiLoadoutMode = idMode(targetId);
    const sign = modeSign(mode);
    const timestamp = Date.now();

    const tx = db.transaction(() => {
      db.prepare(`UPDATE ui_loadout_entries SET isActive = 0 WHERE id * ? > 0`).run(sign);
      db.prepare(`UPDATE ui_loadout_entries SET isActive = 1, updatedAt = ? WHERE id = ?`).run(timestamp, targetId);

      const kind = idKind(targetId);
      if (kind === 'default-custom' || kind === 'custom') {
        this.writeLoadoutMeta(`lastCustomId:${mode}`, targetId);
      }
    });

    tx();
    return this.buildListResult();
  }

  updatePendingUiLoadout(mode: unknown, loadout: unknown): UiLoadoutListResult {
    this.ensureLoadoutsSeeded();
    const db = this.requireDb();
    const normalizedMode: UiLoadoutMode = mode === 'dark' ? 'dark' : 'light';
    const normalized = normalizeUiLayoutLoadout(loadout);
    if (!normalized) return this.buildListResult();

    const sign = modeSign(normalizedMode);
    const pendingId = LOADOUT_PENDING_ID_ABS * sign;
    const signature = stableStringify(normalized);
    const payloadJson = JSON.stringify(normalized);
    const timestamp = Date.now();

    const tx = db.transaction(() => {
      // Does this payload match an existing row for this mode? If so,
      // collapse into that match instead of treating it as new pending data.
      const match = db.prepare(`
        SELECT id FROM ui_loadout_entries
        WHERE signature = ? AND id * ? > 0
        ORDER BY ABS(id) ASC
        LIMIT 1
      `).get(signature, sign) as { id: number } | undefined;

      db.prepare(`UPDATE ui_loadout_entries SET isActive = 0 WHERE id * ? > 0`).run(sign);

      if (match) {
        db.prepare(`UPDATE ui_loadout_entries SET isActive = 1, updatedAt = ? WHERE id = ?`).run(timestamp, match.id);
        const kind = idKind(match.id);
        if (kind === 'default-custom' || kind === 'custom') {
          this.writeLoadoutMeta(`lastCustomId:${normalizedMode}`, match.id);
        }
        return;
      }

      db.prepare(`
        UPDATE ui_loadout_entries
        SET isActive = 1, signature = ?, payloadJson = ?, updatedAt = ?
        WHERE id = ?
      `).run(signature, payloadJson, timestamp, pendingId);
    });

    tx();
    return this.buildListResult();
  }

  saveCustomUiLoadout(mode: unknown): UiLoadoutListResult {
    this.ensureLoadoutsSeeded();
    const db = this.requireDb();
    const normalizedMode: UiLoadoutMode = mode === 'dark' ? 'dark' : 'light';
    const sign = modeSign(normalizedMode);
    const pendingId = LOADOUT_PENDING_ID_ABS * sign;

    const pendingRow = this.readLoadoutRow(pendingId);
    if (!pendingRow || !pendingRow.isActive) {
      // Nothing pending to save for this mode.
      return this.buildListResult();
    }

    const timestamp = Date.now();
    const tx = db.transaction(() => {
      const existingCustomIds = (db.prepare(`
        SELECT id FROM ui_loadout_entries WHERE id * ? > 0 AND ABS(id) >= ?
      `).all(sign, LOADOUT_FIRST_CUSTOM_ID_ABS) as { id: number }[]).map((r) => Math.abs(r.id));

      let nextAbs = LOADOUT_FIRST_CUSTOM_ID_ABS;
      while (existingCustomIds.includes(nextAbs) && nextAbs < LOADOUT_FIRST_CUSTOM_ID_ABS + LOADOUT_MAX_CUSTOM_SLOTS + 16) {
        nextAbs += 1;
      }
      const newId = nextAbs * sign;

      db.prepare(`UPDATE ui_loadout_entries SET isActive = 0 WHERE id * ? > 0`).run(sign);

      db.prepare(`
        INSERT INTO ui_loadout_entries (id, isActive, signature, payloadJson, updatedAt)
        VALUES (?, 1, ?, ?, ?)
      `).run(newId, pendingRow.signature, JSON.stringify(pendingRow.payload), timestamp);

      this.writeLoadoutMeta(`lastCustomId:${normalizedMode}`, newId);

      // Reset the pending row back to an inert copy of default-custom.
      const defaultCustomId = LOADOUT_DEFAULT_CUSTOM_ID_ABS * sign;
      const defaultCustomRow = this.readLoadoutRow(defaultCustomId);
      if (defaultCustomRow) {
        db.prepare(`
          UPDATE ui_loadout_entries
          SET isActive = 0, signature = ?, payloadJson = ?, updatedAt = ?
          WHERE id = ?
        `).run(defaultCustomRow.signature, JSON.stringify(defaultCustomRow.payload), timestamp, pendingId);
      }
    });

    tx();
    return this.buildListResult();
  }

  deleteCustomUiLoadout(id: unknown): UiLoadoutListResult {
    this.ensureLoadoutsSeeded();
    const db = this.requireDb();
    const targetId = typeof id === 'number' && Number.isInteger(id) ? id : null;
    if (targetId === null || idKind(targetId) !== 'custom') return this.buildListResult();

    const existing = this.readLoadoutRow(targetId);
    if (!existing) return this.buildListResult();

    const mode: UiLoadoutMode = idMode(targetId);
    const sign = modeSign(mode);
    const defaultCustomId = LOADOUT_DEFAULT_CUSTOM_ID_ABS * sign;
    const timestamp = Date.now();

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM ui_loadout_entries WHERE id = ?`).run(targetId);

      if (existing.isActive) {
        db.prepare(`UPDATE ui_loadout_entries SET isActive = 0 WHERE id * ? > 0`).run(sign);
        db.prepare(`UPDATE ui_loadout_entries SET isActive = 1, updatedAt = ? WHERE id = ?`).run(timestamp, defaultCustomId);
      }

      const lastCustomId = this.readLoadoutMeta(`lastCustomId:${mode}`, defaultCustomId);
      if (lastCustomId === targetId) {
        this.writeLoadoutMeta(`lastCustomId:${mode}`, defaultCustomId);
      }
    });

    tx();
    return this.buildListResult();
  }

  resetCustomUiLoadout(mode: unknown): UiLoadoutListResult {
    this.ensureLoadoutsSeeded();
    const db = this.requireDb();
    const normalizedMode: UiLoadoutMode = mode === 'dark' ? 'dark' : 'light';
    const sign = modeSign(normalizedMode);
    const defaultCustomId = LOADOUT_DEFAULT_CUSTOM_ID_ABS * sign;
    const timestamp = Date.now();

    const tx = db.transaction(() => {
      db.prepare(`UPDATE ui_loadout_entries SET isActive = 0 WHERE id * ? > 0`).run(sign);
      db.prepare(`UPDATE ui_loadout_entries SET isActive = 1, updatedAt = ? WHERE id = ?`).run(timestamp, defaultCustomId);
      this.writeLoadoutMeta(`lastCustomId:${normalizedMode}`, defaultCustomId);
    });

    tx();
    return this.buildListResult();
  }

  /**
   * Build the string content of a .tdl file containing all user custom and
   * active pending loadouts (abs id >= 7), expressed as NEUTRAL_BASE diffs.
   */
  buildTdlContent(): string {
    this.ensureLoadoutsSeeded();
    const db = this.requireDb();

    const rows = db.prepare(`
      SELECT id, payloadJson FROM ui_loadout_entries
      WHERE ABS(id) >= ? ORDER BY id ASC
    `).all(LOADOUT_PENDING_ID_ABS) as Array<{ id: number; payloadJson: string }>;

    const lines: string[] = [
      '// Thockdown Layout file',
      '// Generated by Thockdown Notes',
      '//',
      '// Each line: <id>: { ...NEUTRAL_BASE, <overrides> },',
      '// Positive IDs = light mode, negative IDs = dark mode',
      '',
    ];

    for (const row of rows) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
      } catch {
        continue;
      }
      const diff = buildNeutralBaseDiff(payload);
      const diffStr = diff.length > 0 ? ', ' + diff.join(', ') : '';
      lines.push(`  ${row.id}: { ...NEUTRAL_BASE${diffStr} },`);
    }

    return lines.join('\n');
  }

  buildTdlContentForEntry(id: number): string {
    this.ensureLoadoutsSeeded();
    const db = this.requireDb();

    const row = db.prepare(`
      SELECT id, payloadJson FROM ui_loadout_entries
      WHERE id = ? AND ABS(id) >= ?
      LIMIT 1
    `).get(id, LOADOUT_PENDING_ID_ABS) as { id: number; payloadJson: string } | undefined;

    if (!row) {
      throw new Error(`Loadout entry ${id} cannot be exported because it does not exist or is not a saved custom slot.`);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    } catch {
      throw new Error(`Failed to parse payload for loadout entry ${id}.`);
    }

    const lines: string[] = [
      '// Thockdown Layout file',
      '// Generated by Thockdown Notes',
      '//',
      '// Each line: <id>: { ...NEUTRAL_BASE, <overrides> },',
      '// Positive IDs = light mode, negative IDs = dark mode',
      '',
    ];

    const diff = buildNeutralBaseDiff(payload);
    const diffStr = diff.length > 0 ? ', ' + diff.join(', ') : '';
    lines.push(`  ${row.id}: { ...NEUTRAL_BASE${diffStr} },`);

    return lines.join('\n');
  }

  /**
   * Parse a .tdl file and insert any entries that don't already exist
   * (by signature) into the database as new custom slots.
   * Returns the updated list result.
   */
  importTdlLoadouts(fileContent: string): UiLoadoutListResult {
    this.ensureLoadoutsSeeded();
    const db = this.requireDb();

    const parsed = parseTdlContent(fileContent);
    if (parsed.length === 0) return this.buildListResult();

    const timestamp = Date.now();

    const tx = db.transaction(() => {
      for (const { id: originalId, overrides } of parsed) {
        const mode: UiLoadoutMode = originalId > 0 ? 'light' : 'dark';
        const sign = modeSign(mode);

        // Merge overrides onto NEUTRAL_BASE and normalize
        const fullPayload = { ...DEFAULT_CUSTOM_LIGHT, ...overrides };
        const normalized = normalizeUiLayoutLoadout(fullPayload);
        if (!normalized) continue;

        const signature = stableStringify(normalized);

        // Skip if this exact signature already exists for this mode
        const existing = db.prepare(`
          SELECT id FROM ui_loadout_entries WHERE signature = ? AND id * ? > 0 LIMIT 1
        `).get(signature, sign) as { id: number } | undefined;
        if (existing) continue;

        // Find the next free custom slot ID for this mode
        const usedAbs = (db.prepare(`
          SELECT id FROM ui_loadout_entries WHERE id * ? > 0 AND ABS(id) >= ?
        `).all(sign, LOADOUT_FIRST_CUSTOM_ID_ABS) as { id: number }[]).map((r) => Math.abs(r.id));

        let nextAbs = LOADOUT_FIRST_CUSTOM_ID_ABS;
        while (usedAbs.includes(nextAbs)) nextAbs++;
        usedAbs.push(nextAbs); // prevent duplicate alloc within the same transaction

        const newId = nextAbs * sign;

        db.prepare(`
          INSERT INTO ui_loadout_entries (id, isActive, signature, payloadJson, updatedAt)
          VALUES (?, 0, ?, ?, ?)
        `).run(newId, signature, JSON.stringify(normalized), timestamp);
      }
    });

    tx();
    return this.buildListResult();
  }

  // ---------------------------------------------------------------------------
  // Music player
  // ---------------------------------------------------------------------------

  private rowToSongEntry(row: Record<string, unknown>): MusicSongEntry {
    return {
      id:           row['id'] as number,
      filePath:     row['filePath'] as string,
      playlistSlot: row['playlistSlot'] as PlaylistSlot,
      priority:     row['priority'] as number,
      favorability: row['favorability'] as number,
      title:        row['title'] as string,
      artist:       row['artist'] as string,
      durationSec:  row['durationSec'] as number,
    };
  }

  getMusicPlaylist(slot: PlaylistSlot): MusicSongEntry[] {
    const db = this.requireDb();
    const rows = db.prepare(
      'SELECT * FROM music_songs WHERE playlistSlot = ? ORDER BY priority ASC, id ASC'
    ).all(slot) as Record<string, unknown>[];
    return rows.map((r) => this.rowToSongEntry(r));
  }

  addMusicSongs(slot: PlaylistSlot, filePaths: string[]): MusicSongEntry[] {
    const db = this.requireDb();
    const insert = db.prepare(`
      INSERT INTO music_songs (filePath, playlistSlot, title, artist)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(filePath) DO NOTHING
    `);

    const tx = db.transaction(() => {
      for (const fp of filePaths) {
        const ext = path.extname(fp).toLowerCase();
        if (!AUDIO_EXTENSIONS.has(ext)) continue;
        const baseName = path.basename(fp, ext);
        // Simple heuristic: "Artist - Title" or just use the full basename as title.
        const dashIndex = baseName.indexOf(' - ');
        const title  = dashIndex >= 0 ? baseName.slice(dashIndex + 3).trim() : baseName;
        const artist = dashIndex >= 0 ? baseName.slice(0, dashIndex).trim()  : '';
        insert.run(fp, slot, title, artist);
      }
    });
    tx();
    return this.getMusicPlaylist(slot);
  }

  clearMusicPlaylist(slot: PlaylistSlot): void {
    const db = this.requireDb();
    db.prepare('DELETE FROM music_songs WHERE playlistSlot = ?').run(slot);
  }

  removeMusicSong(id: number): void {
    const db = this.requireDb();
    db.prepare('DELETE FROM music_songs WHERE id = ?').run(id);
  }

  purgeMusicSong(id: number): void {
    this.removeMusicSong(id);
  }

  pickNextMusicSong(activeSlots: PlaylistSlot[]): MusicSongEntry | null {
    if (activeSlots.length === 0) return null;
    const db = this.requireDb();

    const placeholders = activeSlots.map(() => '?').join(',');
    const minRow = db.prepare(
      `SELECT MIN(priority) AS minPriority FROM music_songs WHERE playlistSlot IN (${placeholders})`
    ).get(...activeSlots) as { minPriority: number | null } | undefined;

    if (!minRow || minRow.minPriority == null) return null;

    const candidates = db.prepare(
      `SELECT * FROM music_songs WHERE playlistSlot IN (${placeholders}) AND priority = ?`
    ).all(...activeSlots, minRow.minPriority) as Record<string, unknown>[];

    if (candidates.length === 0) return null;

    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    return this.rowToSongEntry(picked);
  }

  afterMusicPlay(id: number): void {
    const db = this.requireDb();

    const tx = db.transaction(() => {
      // Count total songs in the database (for max priority).
      const { total } = db.prepare('SELECT COUNT(*) AS total FROM music_songs').get() as { total: number };
      if (total === 0) return;

      // Set the played song to the lowest priority.
      db.prepare('UPDATE music_songs SET priority = ? WHERE id = ?').run(total, id);

      // Decrease priority value (increase priority) for all others by their favorability, clamped to 1.
      db.prepare(`
        UPDATE music_songs
        SET priority = MAX(1, priority - favorability)
        WHERE id != ?
      `).run(id);
    });

    tx();
  }

  favoriteMusicSong(id: number): MusicSongEntry | null {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE music_songs
        SET priority = 0,
            favorability = MIN(10, favorability + 1)
        WHERE id = ?
      `).run(id);
    });
    tx();
    const row = db.prepare('SELECT * FROM music_songs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSongEntry(row) : null;
  }

  skipMusicSong(id: number): void {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      const { total } = db.prepare('SELECT COUNT(*) AS total FROM music_songs').get() as { total: number };
      db.prepare('UPDATE music_songs SET priority = ?, favorability = 1 WHERE id = ?').run(total, id);
    });
    tx();
  }

  getMusicPlaylistCounts(): PlaylistCountsResult {
    const db = this.requireDb();
    const rows = db.prepare(
      'SELECT playlistSlot, COUNT(*) AS cnt FROM music_songs GROUP BY playlistSlot'
    ).all() as Array<{ playlistSlot: number; cnt: number }>;

    const result: PlaylistCountsResult = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of rows) {
      if (row.playlistSlot >= 1 && row.playlistSlot <= 5) {
        result[row.playlistSlot as PlaylistSlot] = row.cnt;
      }
    }
    return result;
  }

  private ensureSchema(): void {
    const db = this.requireDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        filePath TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastEdited TEXT,
        progressPreview REAL,
        progressEdit REAL,
        cursorPos INTEGER,
        scrollTop INTEGER,
        sourceAnchorLine INTEGER,
        sourceAnchorText TEXT,
        contentChecksum TEXT,
        isTemp INTEGER DEFAULT 0,
        externalPath TEXT,
        hasUnsavedChanges INTEGER DEFAULT 0,
        syncMode INTEGER DEFAULT 0,
        originalEncoding TEXT,
        fileToken TEXT UNIQUE
      );

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS note_tags (
        noteId TEXT NOT NULL,
        tagId INTEGER NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (noteId, tagId),
        FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(noteId);
      CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tagId);

      CREATE TABLE IF NOT EXISTS note_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        noteId TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        isManual INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_note_snapshots_note_timestamp
      ON note_snapshots(noteId, timestamp DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        noteId UNINDEXED,
        title,
        content
      );

      CREATE TABLE IF NOT EXISTS texture_pattern_cache (
        surface TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        seed INTEGER NOT NULL,
        granularity REAL NOT NULL,
        vSteps INTEGER NOT NULL,
        algorithmVersion INTEGER NOT NULL,
        data BLOB NOT NULL,
        mimeType TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        PRIMARY KEY (surface, width, height, seed, granularity, vSteps, algorithmVersion)
      );

      CREATE INDEX IF NOT EXISTS idx_texture_pattern_cache_created_at ON texture_pattern_cache(createdAt DESC);

      CREATE TABLE IF NOT EXISTS ui_loadout_entries (
        id INTEGER PRIMARY KEY,
        isActive INTEGER NOT NULL DEFAULT 0,
        signature TEXT NOT NULL,
        payloadJson TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ui_loadout_entries_signature ON ui_loadout_entries(signature);

      CREATE TABLE IF NOT EXISTS ui_loadout_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS music_songs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        filePath    TEXT    NOT NULL UNIQUE,
        playlistSlot INTEGER NOT NULL CHECK(playlistSlot BETWEEN 1 AND 5),
        priority    INTEGER NOT NULL DEFAULT 1,
        favorability INTEGER NOT NULL DEFAULT 1,
        title       TEXT    NOT NULL DEFAULT '',
        artist      TEXT    NOT NULL DEFAULT '',
        durationSec REAL    NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_music_songs_slot     ON music_songs(playlistSlot);
      CREATE INDEX IF NOT EXISTS idx_music_songs_priority ON music_songs(priority);
    `);

    this.ensureNotesColumn('sourceAnchorLine', 'INTEGER');
    this.ensureNotesColumn('sourceAnchorText', 'TEXT');
    this.ensureNotesColumn('contentChecksum', 'TEXT');
  }

  private ensureNotesColumn(columnName: string, columnDefinition: string): void {
    const db = this.requireDb();
    const columns = db.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    db.exec(`ALTER TABLE notes ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  private ensureProtectedTags(): void {
    const db = this.requireDb();
    const findTagStmt = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertTagStmt = db.prepare('INSERT INTO tags (name) VALUES (?)');

    const tx = db.transaction(() => {
      for (const tagName of PROTECTED_TAGS) {
        const existing = findTagStmt.get(tagName) as { id: number } | undefined;
        if (existing) continue;
        insertTagStmt.run(tagName);
      }
    });

    tx();
  }

  private normalizeAllTagPositions(): number {
    const db = this.requireDb();
    const noteIds = db.prepare('SELECT id FROM notes').all() as Array<{ id: string }>;
    const selectTagsForNoteStmt = db.prepare('SELECT tagId FROM note_tags WHERE noteId = ? ORDER BY position ASC, tagId ASC');
    const updatePosStmt = db.prepare('UPDATE note_tags SET position = ? WHERE noteId = ? AND tagId = ?');

    let touchedCount = 0;
    const tx = db.transaction(() => {
      for (const { id } of noteIds) {
        const rows = selectTagsForNoteStmt.all(id) as Array<{ tagId: number }>;
        rows.forEach((row, index) => {
          const info = updatePosStmt.run(index, id, row.tagId);
          if (info.changes > 0) {
            touchedCount += 1;
          }
        });
      }
    });

    tx();
    return touchedCount;
  }

  private writeNoteTags(noteId: string, orderedTags: string[]): void {
    const db = this.requireDb();
    const findTagStmt = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertTagStmt = db.prepare('INSERT INTO tags (name) VALUES (?)');
    const deleteNoteTagsStmt = db.prepare('DELETE FROM note_tags WHERE noteId = ?');
    const insertNoteTagStmt = db.prepare('INSERT OR REPLACE INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)');

    const getOrCreateTagId = (tagNameRaw: string): number => {
      const tagName = normalizeTagName(tagNameRaw);
      const existing = findTagStmt.get(tagName) as { id: number } | undefined;
      if (existing) return existing.id;
      const created = insertTagStmt.run(tagName);
      return Number(created.lastInsertRowid);
    };

    const tx = db.transaction(() => {
      deleteNoteTagsStmt.run(noteId);
      orderedTags.forEach((tagName, position) => {
        const tagId = getOrCreateTagId(tagName);
        insertNoteTagStmt.run(noteId, tagId, position);
      });
    });

    tx();
  }

  private findTagIdByName(tagNameRaw: string): number | null {
    const db = this.requireDb();
    const tagName = normalizeTagName(tagNameRaw);
    const row = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: number } | undefined;
    return row?.id ?? null;
  }

  private getOrCreateTagId(tagNameRaw: string): number {
    const db = this.requireDb();
    const tagName = normalizeTagName(tagNameRaw);
    const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: number } | undefined;
    if (existing) return existing.id;
    const created = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
    return Number(created.lastInsertRowid);
  }

  private writeTagRelations(noteId: string, orderedTagIds: number[]): void {
    const db = this.requireDb();
    const deleteStmt = db.prepare('DELETE FROM note_tags WHERE noteId = ?');
    const insertStmt = db.prepare('INSERT OR REPLACE INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)');

    const tx = db.transaction(() => {
      deleteStmt.run(noteId);
      orderedTagIds.forEach((tagId, position) => {
        insertStmt.run(noteId, tagId, position);
      });
    });

    tx();
  }

  private requireDb(): SqliteDatabase {
    if (!this.db) {
      throw new Error('DatabaseService is not initialized');
    }
    return this.db;
  }
}
