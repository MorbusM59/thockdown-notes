import { createHash, randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { sanitizeDocumentText, truncateTitle } from '../src/shared/textSanitization';
import { deriveDefaultAssignedIdBase, normalizeAssignedIdInput } from '../src/shared/assignedIds';
import { ensureHelpNote } from './help/helpNote';
import { shouldVacuumForBloat } from './databaseSanitationPolicy';
import type { TextureCacheHit, TextureCachePurgeRequest, TextureCacheRequest } from '../src/shared/textures';
import type { AudioBounceCacheHit, AudioBounceCacheRequest } from '../src/shared/audioBounceCache';
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
import {
  DEFAULT_CUSTOM_CURSOR_SETTINGS,
  CURSOR_DOT_COUNT_MIN, CURSOR_DOT_COUNT_MAX,
  CURSOR_RADIUS_MIN_PX, CURSOR_RADIUS_MAX_PX,
  CURSOR_SPIN_HZ_MIN, CURSOR_SPIN_HZ_MAX,
  CURSOR_TRAIL_THICKNESS_MIN_PX, CURSOR_TRAIL_THICKNESS_MAX_PX,
  CURSOR_TRAIL_FADE_MIN_MS, CURSOR_TRAIL_FADE_MAX_MS,
  CURSOR_DOT_SIZE_MIN_PX, CURSOR_DOT_SIZE_MAX_PX,
  CURSOR_CENTER_SIZE_MIN_PX, CURSOR_CENTER_SIZE_MAX_PX,
  CURSOR_HALO_RADIUS_MIN_PX, CURSOR_HALO_RADIUS_MAX_PX,
  CURSOR_HALO_FALLOFF_MIN, CURSOR_HALO_FALLOFF_MAX,
  CURSOR_PULSE_MAGNITUDE_MIN, CURSOR_PULSE_MAGNITUDE_MAX,
  CURSOR_PULSE_HZ_MIN, CURSOR_PULSE_HZ_MAX,
  CURSOR_CLICK_RAMP_MIN, CURSOR_CLICK_RAMP_MAX,
  CURSOR_CLICK_SKEW_MIN, CURSOR_CLICK_SKEW_MAX,
  CURSOR_CLICK_SPEED_X_MIN, CURSOR_CLICK_SPEED_X_MAX,
  CURSOR_CLICK_MAX_SPEED_MIN, CURSOR_CLICK_MAX_SPEED_MAX,
  CURSOR_CLICK_MIN_HOLD_MIN_MS, CURSOR_CLICK_MIN_HOLD_MAX_MS,
  CURSOR_CLICK_BALANCE_MIN, CURSOR_CLICK_BALANCE_MAX,
} from '../src/shared/cursorSettings';
import { DEFAULT_TEXTURE_MATERIALS, TEXTURE_SURFACES, type TextureMaterialSettings, type TextureMaterialsBySurface } from '../src/textures/types';
import type { MusicSongEntry, PlaylistSlot, PlaylistCountsResult } from '../src/shared/audioPlayer';
import type { ReviewFlagEntry, ReviewFlagWrite, ReviewFlagRemap } from '../src/shared/reviewFlags';
import { AUDIO_EXTENSIONS } from '../src/shared/audioPlayer';

const require = createRequire(import.meta.url);
let BetterSqlite3: typeof import('better-sqlite3');
try {
  BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(
    `Failed to load the better-sqlite3 native module: ${detail}. ` +
    `This usually means the packaged build is missing the native binary for this platform, ` +
    `or it was compiled against a different Electron/Node ABI than the one this app is running.`,
  );
}

const DB_FILE_NAME = 'thockdown-notes.db';
const EXTERNAL_TAG = 'EXTERNAL';
const PROTECTED_TAGS = ['deleted', 'archived', EXTERNAL_TAG] as const;
const META_PREFIX = '<!-- thockdown-meta:';
const META_SUFFIX = '-->';
const TEXTURE_CACHE_DEFAULT_MAX_ENTRIES = 96;
const TEXTURE_CACHE_DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
// A handful of settings signatures' worth of the ~90-key plain-typing
// charset (see PREWARM_CHAR_KEY_IDS) -- bounded so repeatedly tweaking
// reverb/volume sliders doesn't grow this table without limit.
const AUDIO_BOUNCE_CACHE_DEFAULT_MAX_ENTRIES = 400;
const AUDIO_BOUNCE_CACHE_DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

const DEFAULT_UI_LAYOUT_LOADOUT: UiLayoutLoadout = {
  borderRadiusRegularPx: 6,
  spacingRegularPx: 4,
  borderAlphaPercent: 100,
  boxShadowAlphaPercent: 100,
  audioKeyVolume: 1,
  audioKeyVariance: 0,
  audioPitch: 0,
  audioBassVolume: 0,
  audioTrebleVolume: 0,
  audioReverbStrength: 0,
  audioReverbSpace: 0,
  pitchJitterAmount: 0,
  audioSpatial: 0,
  typingSoundEnabled: false,
  typingSoundSet: 'A',
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
    gutterBackground: 'rgba(196, 187, 182, 0.49)',
    reviewLine: 'rgba(255, 221, 105, 0.35)',
    warningLine: 'rgba(199, 60, 0, 0.35)',
    lineNumber: 'rgba(0, 0, 0, 0.6)',
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
  cursorDotColor: DEFAULT_CUSTOM_CURSOR_SETTINGS.dotColor,
  cursorCenterColor: DEFAULT_CUSTOM_CURSOR_SETTINGS.centerColor,
  cursorTrailColor: DEFAULT_CUSTOM_CURSOR_SETTINGS.trailColor,
  cursorDotCount: DEFAULT_CUSTOM_CURSOR_SETTINGS.dotCount,
  cursorRadiusPx: DEFAULT_CUSTOM_CURSOR_SETTINGS.radiusPx,
  cursorSpinHz: DEFAULT_CUSTOM_CURSOR_SETTINGS.spinHz,
  cursorTrailThicknessPx: DEFAULT_CUSTOM_CURSOR_SETTINGS.trailThicknessPx,
  cursorTrailFadeMs: DEFAULT_CUSTOM_CURSOR_SETTINGS.trailFadeMs,
  cursorDotSizePx: DEFAULT_CUSTOM_CURSOR_SETTINGS.dotSizePx,
  cursorCenterSizePx: DEFAULT_CUSTOM_CURSOR_SETTINGS.centerSizePx,
  cursorHaloColor: DEFAULT_CUSTOM_CURSOR_SETTINGS.haloColor,
  cursorHaloRadiusPx: DEFAULT_CUSTOM_CURSOR_SETTINGS.haloRadiusPx,
  cursorHaloFalloff: DEFAULT_CUSTOM_CURSOR_SETTINGS.haloFalloff,
  cursorPulseMagnitude: DEFAULT_CUSTOM_CURSOR_SETTINGS.pulseMagnitude,
  cursorPulseHz: DEFAULT_CUSTOM_CURSOR_SETTINGS.pulseHz,
  cursorClickRamp: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickRamp,
  cursorClickSkew: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickSkew,
  cursorClickSpeedX: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickSpeedX,
  cursorClickMaxSpeed: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickMaxSpeed,
  cursorClickMinHoldMs: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickMinHoldMs,
  cursorClickBalance: DEFAULT_CUSTOM_CURSOR_SETTINGS.clickBalance,
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
  assignedId: string | null;
  previewBlockCache: string | null;
  chapterOnly: number;
  isAutoToc: number;
  isAutoOpenItems: number;
  chapterParentId: string | null;
  chapterId: string | null;
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
  assignedId: string | null;
  previewBlockCache: string | null;
  chapterOnly: boolean;
  /** True for the one chapter (if any) that's the auto-generated table of contents for its parent's whole chapter family -- see the `isAutoToc` column doc comment in ensureSchema(). */
  isAutoToc: boolean;
  /** True for the one chapter (if any) that's the auto-generated Open Items chapter for its parent's whole chapter family -- see the `isAutoOpenItems` column doc comment in ensureSchema(). */
  isAutoOpenItems: boolean;
  /** The single note this note is a chapter of, or null when it isn't (any) chapter. DB-derived (see getChapterParent), not navigation state. */
  chapterParentId: string | null;
  /** This chapter's own user-assignable id (the `chapters.chapterId` column -- distinct from `assignedId`/`notes.assignedId`, which is a different, note-level `$id` field a chapterOnly note's own tag bar never exposes a way to set). Null when unset (or when this note isn't a chapter at all). See tabLabels.ts's resolveIdentityLabel for how this resolves to a display label alongside a derived-from-content fallback. */
  chapterId: string | null;
};

/** One entry pinned to a section's tab bar (quick-access note shortcut). */
export type NoteTabEntry = {
  sectionId: string;
  noteId: string;
  position: number;
  addedAtMs: number;
};

/** One chapter: `chapterNoteId` is itself a full note, ordered (gapless, 0-indexed) among `parentNoteId`'s other chapters. A chapter note belongs to exactly one parent, ever. `chapterId` is a user-assignable label (chapter bar right-click, or `$noteid§chapterid` links), unique per parentNoteId; null until first assigned. */
export type ChapterEntry = {
  parentNoteId: string;
  position: number;
  chapterNoteId: string;
  chapterId: string | null;
};

/**
 * One side-by-side editor pane. `widthFraction` is the pane's share of the
 * split-view width (null = "distribute evenly with its siblings", the
 * everyday case while there's only ever one section). `name` is null until
 * the user names it; a named section is kept forever and can be recalled
 * into any slot later, an unnamed one is disposable and deleted outright
 * when its slot is closed or replaced. `position` is null when the section
 * isn't currently occupying a slot. `lastActiveNoteId` is this section's own
 * "which note was I last showing" memory, independent of pinning.
 */
export type EditorSectionEntry = {
  id: string;
  name: string | null;
  position: number | null;
  widthFraction: number | null;
  /** User-pinned exact pixel width (null = flexible); see the renderer's fixed/flexible split-view sizing. */
  fixedWidthPx: number | null;
  lastActiveNoteId: string | null;
  /** Whether `setEditorSectionActiveNote` has ever been called for this section -- distinguishes "never had a note assigned" (bootstrap should fall back to some note) from "user explicitly cleared it" (bootstrap should respect the empty state), since both look like `lastActiveNoteId: null` otherwise. */
  noteSlotInitialized: boolean;
};

/** The sole section that exists on a fresh install — also where sidebar note clicks always land. */
export const DEFAULT_EDITOR_SECTION_ID = 'default';

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
  const firstLine = normalizeText(text).split('\n', 1)[0] ?? '';
  if (firstLine.startsWith('# ')) {
    return truncateTitle(firstLine.slice(2).trim());
  }

  return 'Missing title';
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
    borderRadiusRegularPx: clampInteger(source.borderRadiusRegularPx, 0, 20, DEFAULT_UI_LAYOUT_LOADOUT.borderRadiusRegularPx),
    spacingRegularPx: clampInteger(source.spacingRegularPx, 1, 8, DEFAULT_UI_LAYOUT_LOADOUT.spacingRegularPx),
    borderAlphaPercent: clampInteger(source.borderAlphaPercent, 0, 200, DEFAULT_UI_LAYOUT_LOADOUT.borderAlphaPercent),
    boxShadowAlphaPercent: clampInteger(source.boxShadowAlphaPercent, 0, 200, DEFAULT_UI_LAYOUT_LOADOUT.boxShadowAlphaPercent),
    audioKeyVolume: clampNumber(source.audioKeyVolume, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.audioKeyVolume),
    audioKeyVariance: clampNumber(source.audioKeyVariance, 0, 0.5, DEFAULT_UI_LAYOUT_LOADOUT.audioKeyVariance),
    audioPitch: clampNumber(source.audioPitch, -100, 100, DEFAULT_UI_LAYOUT_LOADOUT.audioPitch),
    audioBassVolume: clampNumber(source.audioBassVolume, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.audioBassVolume),
    audioTrebleVolume: clampNumber(source.audioTrebleVolume, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.audioTrebleVolume),
    audioReverbStrength: clampNumber(source.audioReverbStrength, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.audioReverbStrength),
    audioReverbSpace: clampNumber(source.audioReverbSpace, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.audioReverbSpace),
    pitchJitterAmount: clampNumber(source.pitchJitterAmount, 0, 0.05, DEFAULT_UI_LAYOUT_LOADOUT.pitchJitterAmount),
    audioSpatial: clampNumber(source.audioSpatial, -100, 100, DEFAULT_UI_LAYOUT_LOADOUT.audioSpatial),
    typingSoundEnabled: typeof source.typingSoundEnabled === 'boolean' ? source.typingSoundEnabled : DEFAULT_UI_LAYOUT_LOADOUT.typingSoundEnabled,
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
      gutterBackground: sanitizeString(highlights.gutterBackground, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.gutterBackground),
      reviewLine: sanitizeString(highlights.reviewLine, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.reviewLine),
      warningLine: sanitizeString(highlights.warningLine, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.warningLine),
      lineNumber: sanitizeString(highlights.lineNumber, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.lineNumber),
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
    cursorDotColor: sanitizeString(source.cursorDotColor, DEFAULT_UI_LAYOUT_LOADOUT.cursorDotColor),
    cursorCenterColor: sanitizeString(source.cursorCenterColor, DEFAULT_UI_LAYOUT_LOADOUT.cursorCenterColor),
    cursorTrailColor: sanitizeString(source.cursorTrailColor, DEFAULT_UI_LAYOUT_LOADOUT.cursorTrailColor),
    cursorDotCount: clampInteger(source.cursorDotCount, CURSOR_DOT_COUNT_MIN, CURSOR_DOT_COUNT_MAX, DEFAULT_UI_LAYOUT_LOADOUT.cursorDotCount),
    cursorRadiusPx: clampNumber(source.cursorRadiusPx, CURSOR_RADIUS_MIN_PX, CURSOR_RADIUS_MAX_PX, DEFAULT_UI_LAYOUT_LOADOUT.cursorRadiusPx),
    cursorSpinHz: clampNumber(source.cursorSpinHz, CURSOR_SPIN_HZ_MIN, CURSOR_SPIN_HZ_MAX, DEFAULT_UI_LAYOUT_LOADOUT.cursorSpinHz),
    cursorTrailThicknessPx: clampNumber(source.cursorTrailThicknessPx, CURSOR_TRAIL_THICKNESS_MIN_PX, CURSOR_TRAIL_THICKNESS_MAX_PX, DEFAULT_UI_LAYOUT_LOADOUT.cursorTrailThicknessPx),
    cursorTrailFadeMs: clampNumber(source.cursorTrailFadeMs, CURSOR_TRAIL_FADE_MIN_MS, CURSOR_TRAIL_FADE_MAX_MS, DEFAULT_UI_LAYOUT_LOADOUT.cursorTrailFadeMs),
    cursorDotSizePx: clampNumber(source.cursorDotSizePx, CURSOR_DOT_SIZE_MIN_PX, CURSOR_DOT_SIZE_MAX_PX, DEFAULT_UI_LAYOUT_LOADOUT.cursorDotSizePx),
    cursorCenterSizePx: clampNumber(source.cursorCenterSizePx, CURSOR_CENTER_SIZE_MIN_PX, CURSOR_CENTER_SIZE_MAX_PX, DEFAULT_UI_LAYOUT_LOADOUT.cursorCenterSizePx),
    cursorHaloColor: sanitizeString(source.cursorHaloColor, DEFAULT_UI_LAYOUT_LOADOUT.cursorHaloColor),
    cursorHaloRadiusPx: clampNumber(source.cursorHaloRadiusPx, CURSOR_HALO_RADIUS_MIN_PX, CURSOR_HALO_RADIUS_MAX_PX, DEFAULT_UI_LAYOUT_LOADOUT.cursorHaloRadiusPx),
    cursorHaloFalloff: clampNumber(source.cursorHaloFalloff, CURSOR_HALO_FALLOFF_MIN, CURSOR_HALO_FALLOFF_MAX, DEFAULT_UI_LAYOUT_LOADOUT.cursorHaloFalloff),
    cursorPulseMagnitude: clampNumber(source.cursorPulseMagnitude, CURSOR_PULSE_MAGNITUDE_MIN, CURSOR_PULSE_MAGNITUDE_MAX, DEFAULT_UI_LAYOUT_LOADOUT.cursorPulseMagnitude),
    cursorPulseHz: clampNumber(source.cursorPulseHz, CURSOR_PULSE_HZ_MIN, CURSOR_PULSE_HZ_MAX, DEFAULT_UI_LAYOUT_LOADOUT.cursorPulseHz),
    cursorClickRamp: clampNumber(source.cursorClickRamp, CURSOR_CLICK_RAMP_MIN, CURSOR_CLICK_RAMP_MAX, DEFAULT_UI_LAYOUT_LOADOUT.cursorClickRamp),
    cursorClickSkew: clampNumber(source.cursorClickSkew, CURSOR_CLICK_SKEW_MIN, CURSOR_CLICK_SKEW_MAX, DEFAULT_UI_LAYOUT_LOADOUT.cursorClickSkew),
    cursorClickSpeedX: clampNumber(source.cursorClickSpeedX, CURSOR_CLICK_SPEED_X_MIN, CURSOR_CLICK_SPEED_X_MAX, DEFAULT_UI_LAYOUT_LOADOUT.cursorClickSpeedX),
    cursorClickMaxSpeed: clampNumber(source.cursorClickMaxSpeed, CURSOR_CLICK_MAX_SPEED_MIN, CURSOR_CLICK_MAX_SPEED_MAX, DEFAULT_UI_LAYOUT_LOADOUT.cursorClickMaxSpeed),
    cursorClickMinHoldMs: clampNumber(source.cursorClickMinHoldMs, CURSOR_CLICK_MIN_HOLD_MIN_MS, CURSOR_CLICK_MIN_HOLD_MAX_MS, DEFAULT_UI_LAYOUT_LOADOUT.cursorClickMinHoldMs),
    cursorClickBalance: clampNumber(source.cursorClickBalance, CURSOR_CLICK_BALANCE_MIN, CURSOR_CLICK_BALANCE_MAX, DEFAULT_UI_LAYOUT_LOADOUT.cursorClickBalance),
  };
}

// ---------------------------------------------------------------------------
// TDL (Thockdown Layout) import/export helpers
// ---------------------------------------------------------------------------

// Ordered list of scalar UiLayoutLoadout keys used for diff lines.
const TDL_SCALAR_KEYS: ReadonlyArray<keyof UiLayoutLoadout> = [
  'borderRadiusRegularPx',
  'spacingRegularPx', 'borderAlphaPercent', 'boxShadowAlphaPercent',
  'audioKeyVolume', 'audioKeyVariance', 'audioPitch', 'audioBassVolume', 'audioTrebleVolume', 'audioReverbStrength', 'audioReverbSpace', 'pitchJitterAmount', 'audioSpatial',
  'typingSoundEnabled', 'typingSoundSet',
  'darkMode',
  'filterInvert', 'filterSepia', 'filterHueRotate', 'filterBrightness',
  'filterContrast', 'filterSaturate', 'filterColorize',
  'cursorDotColor', 'cursorCenterColor', 'cursorTrailColor', 'cursorDotCount',
  'cursorRadiusPx', 'cursorSpinHz', 'cursorTrailThicknessPx', 'cursorTrailFadeMs',
  'cursorDotSizePx', 'cursorCenterSizePx',
  'cursorHaloColor', 'cursorHaloRadiusPx', 'cursorHaloFalloff',
  'cursorPulseMagnitude', 'cursorPulseHz',
  'cursorClickRamp', 'cursorClickSkew', 'cursorClickSpeedX', 'cursorClickMaxSpeed',
  'cursorClickMinHoldMs', 'cursorClickBalance',
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

    const deleteMissingNotesStmt = db.prepare('DELETE FROM notes WHERE id = ? AND isTemp = 0');
    const deleteNoteTagsStmt = db.prepare('DELETE FROM note_tags WHERE noteId = ?');
    const insertNoteTagStmt = db.prepare('INSERT OR REPLACE INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)');
    const selectAllNoteIdsStmt = db.prepare('SELECT id FROM notes');
    const selectIsTempStmt = db.prepare('SELECT isTemp FROM notes WHERE id = ?');

    const findTagStmt = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertTagStmt = db.prepare('INSERT INTO tags (name) VALUES (?)');

    // notes_fts is an FTS5 virtual table with no real unique constraint on
    // noteId, so "INSERT OR REPLACE" can never detect a conflict -- it always
    // inserts a fresh row, leaving the previous one in place. Must delete the
    // old row first, same pattern already used by upsertNoteContent below.
    const deleteFtsForNoteStmt = db.prepare('DELETE FROM notes_fts WHERE noteId = ?');
    const insertFtsStmt = db.prepare('INSERT INTO notes_fts (noteId, title, content) VALUES (?, ?, ?)');
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

        // Preserve temp/external note records across restarts. Only delete
        // regular notes that no longer have a corresponding .md file.
        const tempRow = selectIsTempStmt.get(id) as { isTemp: number } | undefined;
        if (tempRow?.isTemp === 1) {
          continue;
        }

        deleteMissingNotesStmt.run(id);
        deleteMissingFtsStmt.run(id);
      }
    });

    tx(syncedRows);

    for (const row of syncedRows) {
      deleteFtsForNoteStmt.run(row.id);
      insertFtsStmt.run(row.id, row.title, row.text);
    }

    this.normalizeAllTagPositions();
  }

  /**
   * Startup self-healing pass, run once per launch after
   * bootstrapFromFilesystem() (see main.ts). Two independent fixes, each
   * safe by construction and unable to lose real user data:
   *
   * 1. Dedupe notes_fts: keep only the highest-rowid (most recently
   *    written) row per noteId, deleting older copies. This guards against
   *    the "INSERT OR REPLACE never actually replaces on an FTS5 virtual
   *    table" bug bootstrapFromFilesystem used to have (fixed at the
   *    source, but any existing installation upgrading to this version
   *    still carries the accumulated duplicates baked into its own .db
   *    file -- this is the one-time migration that cleans those up) and
   *    self-heals any future regression of the same class before it can
   *    accumulate silently forever. notes_fts is a derived search index,
   *    never the canonical source of a note's content (that's the `notes`
   *    table plus the .md files bootstrapFromFilesystem already re-syncs
   *    from every launch) -- so deleting extra rows here can only ever
   *    discard stale search-index duplicates, never a user's actual note.
   * 2. Conditionally VACUUM (see shouldVacuumForBloat's own doc comment for
   *    the threshold reasoning): SQLite never shrinks its file after
   *    deletes on its own, so a database that once had this same
   *    duplicate-row bug can be carrying a large amount of dead space.
   *    VACUUM doesn't touch any row's content -- it only repacks how the
   *    existing, already-correct rows are laid out on disk.
   */
  sanitizeDatabase(): { dedupedFtsRows: number; vacuumed: boolean; reclaimedBytes: number } {
    const db = this.requireDb();

    const dedupedFtsRows = db.prepare(`
      DELETE FROM notes_fts
      WHERE rowid NOT IN (SELECT MAX(rowid) FROM notes_fts GROUP BY noteId)
    `).run().changes;

    const pageCount = db.pragma('page_count', { simple: true }) as number;
    const freelistCount = db.pragma('freelist_count', { simple: true }) as number;
    const pageSizeBytes = db.pragma('page_size', { simple: true }) as number;

    let vacuumed = false;
    let reclaimedBytes = 0;
    if (shouldVacuumForBloat({ pageCount, freelistCount, pageSizeBytes })) {
      const sizeBeforeBytes = pageCount * pageSizeBytes;
      db.exec('VACUUM');
      const pageCountAfter = db.pragma('page_count', { simple: true }) as number;
      reclaimedBytes = sizeBeforeBytes - pageCountAfter * pageSizeBytes;
      vacuumed = true;
    }

    return { dedupedFtsRows, vacuumed, reclaimedBytes };
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
    // Piggybacked onto this same write (no extra query) whenever the caller
    // already has a fresh cursor/scroll position on hand -- e.g. the
    // debounced note-text save queue, which already fires ~350ms after
    // typing pauses regardless. Optional and left null by every other
    // caller (createNote, external sync, snapshot branching, ...), which
    // must NOT clobber whatever position is already persisted -- the
    // ON CONFLICT clause below COALESCEs against the existing row for
    // exactly that reason. See docs/cm6-parity-hardening-plan.md's
    // "Cursor/scroll persistence redesign" section. Scroll position itself
    // (anchorBlockIndex) is NOT piggybacked here -- per the scroll-sync
    // rewrite's policy, it's written only at explicit leave-editor
    // checkpoints (saveNoteUiState), never on every debounced text save.
    cursorPos?: number | null;
    // Persisted preview-block cache piggybacked onto the same text write.
    // Stored as a JSON blob keyed by the note text's contentChecksum; the
    // renderer validates the checksum/hash before trusting the cache.
    previewBlockCache?: string | null;
  }): void {
    const db = this.requireDb();
    const createdAtIso = new Date(input.createdAtMs).toISOString();
    const updatedAtIso = new Date(input.updatedAtMs).toISOString();
    const normalizedText = normalizeText(input.text);
    const contentChecksum = checksumText(normalizedText);
    const isTemp = input.isTemp ? 1 : 0;
    const hasUnsavedChanges = input.hasUnsavedChanges ? 1 : 0;
    const syncMode = input.syncMode ? 1 : 0;
    const cursorPos = Number.isFinite(input.cursorPos) ? Math.max(0, Math.round(input.cursorPos as number)) : null;

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
        cursorPos,
        previewBlockCache
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        syncMode = excluded.syncMode,
        cursorPos = COALESCE(excluded.cursorPos, notes.cursorPos),
        previewBlockCache = COALESCE(excluded.previewBlockCache, notes.previewBlockCache)
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
      cursorPos,
      input.previewBlockCache ?? null,
    );

    db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(input.id);
    db.prepare('INSERT INTO notes_fts (noteId, title, content) VALUES (?, ?, ?)')
      .run(input.id, input.title, normalizedText);
  }

  listNoteRecords(): NoteRecord[] {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT n.id, n.title, n.filePath, n.createdAt, n.updatedAt, n.contentChecksum, n.isTemp, n.externalPath, n.hasUnsavedChanges, n.syncMode, n.assignedId, n.previewBlockCache, n.chapterOnly, n.isAutoToc, n.isAutoOpenItems, c.parentNoteId AS chapterParentId, c.chapterId AS chapterId
      FROM notes n
      LEFT JOIN chapters c ON c.chapterNoteId = n.id
      ORDER BY datetime(n.updatedAt) DESC
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
      assignedId: row.assignedId,
      previewBlockCache: row.previewBlockCache,
      chapterOnly: Boolean(row.chapterOnly),
      isAutoToc: Boolean(row.isAutoToc),
      isAutoOpenItems: Boolean(row.isAutoOpenItems),
      chapterParentId: row.chapterParentId,
      chapterId: row.chapterId,
    }));
  }

  getNoteRecord(noteId: string): NoteRecord | null {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT n.id, n.title, n.filePath, n.createdAt, n.updatedAt, n.contentChecksum, n.isTemp, n.externalPath, n.hasUnsavedChanges, n.syncMode, n.assignedId, n.previewBlockCache, n.chapterOnly, n.isAutoToc, n.isAutoOpenItems, c.parentNoteId AS chapterParentId, c.chapterId AS chapterId
      FROM notes n
      LEFT JOIN chapters c ON c.chapterNoteId = n.id
      WHERE n.id = ?
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
      assignedId: row.assignedId,
      previewBlockCache: row.previewBlockCache,
      chapterOnly: Boolean(row.chapterOnly),
      isAutoToc: Boolean(row.isAutoToc),
      isAutoOpenItems: Boolean(row.isAutoOpenItems),
      chapterParentId: row.chapterParentId,
      chapterId: row.chapterId,
    };
  }

  /** Marks (or unmarks) a note as existing only to be shown as a chapter -- see the `chapterOnly` column doc comment in ensureSchema(). */
  setNoteChapterOnly(noteId: string, value: boolean): void {
    const db = this.requireDb();
    db.prepare('UPDATE notes SET chapterOnly = ? WHERE id = ?').run(value ? 1 : 0, noteId);
  }

  /** Marks (or unmarks) a note as the auto-generated table-of-contents chapter -- see the `isAutoToc` column doc comment in ensureSchema(). */
  setNoteAutoToc(noteId: string, value: boolean): void {
    const db = this.requireDb();
    db.prepare('UPDATE notes SET isAutoToc = ? WHERE id = ?').run(value ? 1 : 0, noteId);
  }

  /** The parent's current auto-TOC chapter, if it has one, or null. Scans its own chapters rather than a global lookup -- isAutoToc is only ever meaningful in the context of one parent's family. */
  getAutoTocChapterNoteId(parentNoteId: string): string | null {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT c.chapterNoteId AS chapterNoteId
      FROM chapters c
      JOIN notes n ON n.id = c.chapterNoteId
      WHERE c.parentNoteId = ? AND n.isAutoToc = 1
      LIMIT 1
    `).get(parentNoteId) as { chapterNoteId: string } | undefined;
    return row?.chapterNoteId ?? null;
  }

  /** Marks (or unmarks) a note as the auto-generated Open Items chapter -- see the `isAutoOpenItems` column doc comment in ensureSchema(). */
  setNoteAutoOpenItems(noteId: string, value: boolean): void {
    const db = this.requireDb();
    db.prepare('UPDATE notes SET isAutoOpenItems = ? WHERE id = ?').run(value ? 1 : 0, noteId);
  }

  /** The parent's current auto-Open-Items chapter, if it has one, or null. Mirrors getAutoTocChapterNoteId. */
  getAutoOpenItemsChapterNoteId(parentNoteId: string): string | null {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT c.chapterNoteId AS chapterNoteId
      FROM chapters c
      JOIN notes n ON n.id = c.chapterNoteId
      WHERE c.parentNoteId = ? AND n.isAutoOpenItems = 1
      LIMIT 1
    `).get(parentNoteId) as { chapterNoteId: string } | undefined;
    return row?.chapterNoteId ?? null;
  }

  // ── Note internal IDs (tab-bar labels) ──────────────────────────────────

  /**
   * All internal IDs currently in use, optionally excluding one note (so a
   * note can keep its own current ID without colliding with itself when
   * re-resolving uniqueness).
   */
  private listUsedAssignedIds(excludeNoteId?: string): Set<string> {
    const db = this.requireDb();
    const rows = excludeNoteId
      ? db.prepare('SELECT assignedId FROM notes WHERE assignedId IS NOT NULL AND id != ?').all(excludeNoteId) as Array<{ assignedId: string }>
      : db.prepare('SELECT assignedId FROM notes WHERE assignedId IS NOT NULL').all() as Array<{ assignedId: string }>;
    return new Set(rows.map((row) => row.assignedId));
  }

  /**
   * Resolves `requestedBase` to a value that isn't already taken by another
   * note. Collisions get an incremental "-2", "-3", ... suffix appended.
   */
  private resolveUniqueAssignedId(requestedBase: string, excludeNoteId?: string): string {
    const used = this.listUsedAssignedIds(excludeNoteId);
    if (!used.has(requestedBase)) return requestedBase;

    let attempt = 2;
    while (used.has(`${requestedBase}-${attempt}`)) {
      attempt += 1;
    }
    return `${requestedBase}-${attempt}`;
  }

  /**
   * Explicitly assigns an internal ID to a note (the `$id` entry path).
   * Always overwrites any existing value. Returns the final, collision-
   * resolved ID that was actually stored.
   */
  setNoteAssignedId(noteId: string, requestedRaw: string): string {
    const db = this.requireDb();
    const normalized = normalizeAssignedIdInput(requestedRaw);
    const base = normalized.length > 0 ? normalized : deriveDefaultAssignedIdBase(this.getNoteRecord(noteId)?.title ?? 'NOTE');
    const resolved = this.resolveUniqueAssignedId(base, noteId);
    db.prepare('UPDATE notes SET assignedId = ? WHERE id = ?').run(resolved, noteId);
    return resolved;
  }

  // ── Editor sections (side-by-side panes) ────────────────────────────────

  listEditorSections(): EditorSectionEntry[] {
    const db = this.requireDb();
    // Parked (position IS NULL) sections sort after every visible one, rather
    // than SQLite's NULLS-first default scrambling the visible layout's order.
    const rows = db.prepare('SELECT id, name, position, widthFraction, fixedWidthPx, lastActiveNoteId, noteSlotInitialized FROM editor_sections ORDER BY position IS NULL, position ASC')
      .all() as Array<Omit<EditorSectionEntry, 'noteSlotInitialized'> & { noteSlotInitialized: number }>;
    return rows.map((row) => ({ ...row, noteSlotInitialized: row.noteSlotInitialized === 1 }));
  }

  createEditorSection(name: string | null = null, afterPosition?: number): EditorSectionEntry[] {
    const db = this.requireDb();
    const id = randomUUID();
    const tx = db.transaction(() => {
      const { maxPosition } = db.prepare('SELECT MAX(position) AS maxPosition FROM editor_sections').get() as { maxPosition: number | null };
      const insertAt = afterPosition !== undefined ? afterPosition + 1 : (maxPosition ?? -1) + 1;
      // Make room if inserting mid-row rather than appending at the end.
      db.prepare('UPDATE editor_sections SET position = position + 1 WHERE position >= ?').run(insertAt);
      db.prepare('INSERT INTO editor_sections (id, name, position, widthFraction) VALUES (?, ?, ?, NULL)').run(id, name, insertAt);
    });
    tx();
    return this.listEditorSections();
  }

  renameEditorSection(id: string, name: string | null): EditorSectionEntry[] {
    const db = this.requireDb();
    db.prepare('UPDATE editor_sections SET name = ? WHERE id = ?').run(name, id);
    return this.listEditorSections();
  }

  removeEditorSection(id: string): EditorSectionEntry[] {
    const db = this.requireDb();
    if (id === DEFAULT_EDITOR_SECTION_ID) {
      // The default section is where sidebar clicks always land -- it's
      // never closable, only auxiliary sections are.
      return this.listEditorSections();
    }
    db.prepare('DELETE FROM editor_sections WHERE id = ?').run(id);
    return this.listEditorSections();
  }

  reorderEditorSections(orderedSectionIds: string[]): EditorSectionEntry[] {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      orderedSectionIds.forEach((id, index) => {
        db.prepare('UPDATE editor_sections SET position = ? WHERE id = ?').run(index, id);
      });
    });
    tx();
    return this.listEditorSections();
  }

  /** Persists the divider layout (each section's share of the split-view width) after a drag settles. */
  updateEditorSectionWidths(widths: Array<{ id: string; widthFraction: number | null }>): EditorSectionEntry[] {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      widths.forEach(({ id, widthFraction }) => {
        db.prepare('UPDATE editor_sections SET widthFraction = ? WHERE id = ?').run(widthFraction, id);
      });
    });
    tx();
    return this.listEditorSections();
  }

  /** Persists the fixed/flexible pin state (fixedWidthPx; null = flexible) whenever the renderer's pin map changes. */
  updateEditorSectionFixedWidths(entries: Array<{ id: string; fixedWidthPx: number | null }>): EditorSectionEntry[] {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      entries.forEach(({ id, fixedWidthPx }) => {
        db.prepare('UPDATE editor_sections SET fixedWidthPx = ? WHERE id = ?').run(fixedWidthPx, id);
      });
    });
    tx();
    return this.listEditorSections();
  }

  /** Records which note a section last showed -- independent of whether that note is pinned to its tab bar. */
  setEditorSectionActiveNote(sectionId: string, noteId: string | null): EditorSectionEntry[] {
    const db = this.requireDb();
    db.prepare('UPDATE editor_sections SET lastActiveNoteId = ?, noteSlotInitialized = 1 WHERE id = ?').run(noteId, sectionId);
    return this.listEditorSections();
  }

  /** Renumbers position 0..n-1 across every currently-visible (non-parked) section, in existing position order. */
  private renumberVisibleEditorSectionPositions(): void {
    const db = this.requireDb();
    const visible = db.prepare('SELECT id FROM editor_sections WHERE position IS NOT NULL ORDER BY position ASC').all() as Array<{ id: string }>;
    visible.forEach(({ id }, index) => {
      db.prepare('UPDATE editor_sections SET position = ? WHERE id = ?').run(index, id);
    });
  }

  /**
   * Closes a section's slot via its own close button. Unnamed sections are
   * deleted outright (cascading their pinned tabs); named sections are only
   * parked (`position` set to null) so their row and tabs survive, reachable
   * again later via `swapSectionIntoSlot`. Either way, the remaining visible
   * sections' positions are renumbered to stay contiguous.
   */
  closeSectionSlot(sectionId: string): EditorSectionEntry[] {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      const section = db.prepare('SELECT name FROM editor_sections WHERE id = ?').get(sectionId) as { name: string | null } | undefined;
      if (!section) return;

      if (section.name === null) {
        db.prepare('DELETE FROM editor_sections WHERE id = ?').run(sectionId);
      } else {
        db.prepare('UPDATE editor_sections SET position = NULL WHERE id = ?').run(sectionId);
      }
      this.renumberVisibleEditorSectionPositions();
    });
    tx();
    return this.listEditorSections();
  }

  /**
   * Recalls `incomingSectionId` into whatever slot `outgoingSectionId`
   * currently occupies. `outgoingSectionId` is closed the same way
   * `closeSectionSlot` would (deleted if unnamed, parked if named) but
   * in-place -- the slot itself isn't removed, just reassigned, so no
   * renumbering of other rows is needed. Runs as one transaction: a crash
   * mid-swap must never leave two sections at the same position or a
   * position with nothing in it.
   */
  swapSectionIntoSlot(outgoingSectionId: string, incomingSectionId: string): EditorSectionEntry[] {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      const outgoing = db.prepare('SELECT name, position FROM editor_sections WHERE id = ?').get(outgoingSectionId) as { name: string | null; position: number | null } | undefined;
      if (!outgoing || outgoing.position === null) return;

      const slotPosition = outgoing.position;
      if (outgoing.name === null) {
        db.prepare('DELETE FROM editor_sections WHERE id = ?').run(outgoingSectionId);
      } else {
        db.prepare('UPDATE editor_sections SET position = NULL WHERE id = ?').run(outgoingSectionId);
      }
      db.prepare('UPDATE editor_sections SET position = ? WHERE id = ?').run(slotPosition, incomingSectionId);
    });
    tx();
    return this.listEditorSections();
  }

  // ── Tab bar (pinned quick-access notes, scoped per section) ─────────────

  /**
   * Every pinned tab across every section -- callers group by `sectionId`
   * client-side. Excludes any note that's currently `chapterOnly` (a chapter
   * has no tab-bar identity of its own; only its parent's pill is
   * pinnable/tabbable) -- a single, root-cause filter here rather than
   * trusting every write path to keep note_tabs and a note's chapterOnly
   * status in sync.
   */
  listNoteTabs(): NoteTabEntry[] {
    const db = this.requireDb();
    // The LEFT JOIN to `chapters` re-validates lastActiveChapterNoteId on
    // every read, on top of the column's own ON DELETE SET NULL FK -- belt
    // and suspenders against it pointing at a note that still exists but
    // isn't (or is no longer) actually a chapter of this tab's noteId.
    // `c.chapterNoteId` is only non-null when that's still true, so it's
    // used as the emitted value instead of the raw column.
    const rows = db.prepare(`
      SELECT nt.sectionId AS sectionId, nt.noteId AS noteId, nt.position AS position, nt.addedAt AS addedAt,
             c.chapterNoteId AS lastActiveChapterNoteId
      FROM note_tabs nt
      JOIN notes n ON n.id = nt.noteId
      LEFT JOIN chapters c ON c.parentNoteId = nt.noteId AND c.chapterNoteId = nt.lastActiveChapterNoteId
      WHERE n.chapterOnly = 0
      ORDER BY nt.sectionId ASC, nt.position ASC
    `).all() as Array<{ sectionId: string; noteId: string; position: number; addedAt: number; lastActiveChapterNoteId: string | null }>;
    return rows.map((row) => ({
      sectionId: row.sectionId,
      noteId: row.noteId,
      position: row.position,
      addedAtMs: row.addedAt,
      lastActiveChapterNoteId: row.lastActiveChapterNoteId,
    }));
  }

  /** Records which chapter of `noteId` (or null, for the base note) this section's tab last showed -- called on every note activation, not just tab clicks, so switching tabs and back resumes wherever the user actually left off. A no-op if `noteId` isn't currently pinned as a tab in `sectionId` (no matching row to update). */
  setNoteTabLastActiveChapter(sectionId: string, noteId: string, chapterNoteId: string | null): NoteTabEntry[] {
    const db = this.requireDb();
    db.prepare('UPDATE note_tabs SET lastActiveChapterNoteId = ? WHERE sectionId = ? AND noteId = ?').run(chapterNoteId, sectionId, noteId);
    return this.listNoteTabs();
  }

  /** Newly-pinned tabs join at the left edge, ahead of every existing tab -- not appended at the right. */
  addNoteTab(sectionId: string, noteId: string): NoteTabEntry[] {
    const db = this.requireDb();
    const existing = db.prepare('SELECT 1 FROM note_tabs WHERE sectionId = ? AND noteId = ?').get(sectionId, noteId);
    if (!existing) {
      const tx = db.transaction(() => {
        db.prepare('UPDATE note_tabs SET position = position + 1 WHERE sectionId = ?').run(sectionId);
        db.prepare('INSERT INTO note_tabs (sectionId, noteId, position, addedAt) VALUES (?, ?, 0, ?)')
          .run(sectionId, noteId, Date.now());
      });
      tx();
    }
    return this.listNoteTabs();
  }

  removeNoteTab(sectionId: string, noteId: string): NoteTabEntry[] {
    const db = this.requireDb();
    db.prepare('DELETE FROM note_tabs WHERE sectionId = ? AND noteId = ?').run(sectionId, noteId);
    return this.listNoteTabs();
  }

  reorderNoteTabs(sectionId: string, orderedNoteIds: string[]): NoteTabEntry[] {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      orderedNoteIds.forEach((noteId, index) => {
        db.prepare('UPDATE note_tabs SET position = ? WHERE sectionId = ? AND noteId = ?').run(index, sectionId, noteId);
      });
    });
    tx();
    return this.listNoteTabs();
  }

  // ── Chapters (a note's ordered sub-notes) ────────────────────────────────

  /** This parent note's chapters, in order. Deliberately no UNIQUE(parentNoteId, position) constraint -- see reorderChapters's doc comment, same reasoning as note_tabs above. */
  listChaptersForNote(parentNoteId: string): ChapterEntry[] {
    const db = this.requireDb();
    const rows = db.prepare('SELECT parentNoteId, position, chapterNoteId, chapterId FROM chapters WHERE parentNoteId = ? ORDER BY position ASC').all(parentNoteId) as ChapterEntry[];
    return rows;
  }

  /** The single note this chapter belongs to, or null if `chapterNoteId` isn't currently anyone's chapter. */
  getChapterParent(chapterNoteId: string): string | null {
    const db = this.requireDb();
    const row = db.prepare('SELECT parentNoteId FROM chapters WHERE chapterNoteId = ?').get(chapterNoteId) as { parentNoteId: string } | undefined;
    return row?.parentNoteId ?? null;
  }

  /** Appends `chapterNoteId` as the new last chapter of `parentNoteId`. Used both for a brand-new empty chapter note (createChapterNote) and for a note cloned from a dragged-in note (cloneNoteAsChapter) -- either way this is the sole place a `chapters` row is inserted. Throws if `chapterNoteId` already belongs to a (any) parent -- see idx_chapters_chapterNoteId_unique. */
  addChapter(parentNoteId: string, chapterNoteId: string): ChapterEntry[] {
    const db = this.requireDb();
    const { maxPosition } = db.prepare('SELECT MAX(position) AS maxPosition FROM chapters WHERE parentNoteId = ?').get(parentNoteId) as { maxPosition: number | null };
    const nextPosition = maxPosition === null ? 0 : maxPosition + 1;
    db.prepare('INSERT INTO chapters (parentNoteId, position, chapterNoteId) VALUES (?, ?, ?)').run(parentNoteId, nextPosition, chapterNoteId);
    return this.listChaptersForNote(parentNoteId);
  }

  /**
   * All chapterIds currently in use among `parentNoteId`'s own chapters,
   * optionally excluding one chapter (so it can keep its current id without
   * colliding with itself when re-resolving uniqueness). Scoped per parent,
   * unlike notes.assignedId's global uniqueness -- the same chapterId text
   * can be reused across different parents' chapter lists.
   */
  private listUsedChapterIds(parentNoteId: string, excludeChapterNoteId?: string): Set<string> {
    const db = this.requireDb();
    const rows = excludeChapterNoteId
      ? db.prepare('SELECT chapterId FROM chapters WHERE parentNoteId = ? AND chapterId IS NOT NULL AND chapterNoteId != ?').all(parentNoteId, excludeChapterNoteId) as Array<{ chapterId: string }>
      : db.prepare('SELECT chapterId FROM chapters WHERE parentNoteId = ? AND chapterId IS NOT NULL').all(parentNoteId) as Array<{ chapterId: string }>;
    return new Set(rows.map((row) => row.chapterId));
  }

  /** Resolves `requestedBase` to a value not already taken by another of `parentNoteId`'s chapters. Collisions get an incremental "-2", "-3", ... suffix, same as resolveUniqueAssignedId. */
  private resolveUniqueChapterId(parentNoteId: string, requestedBase: string, excludeChapterNoteId?: string): string {
    const used = this.listUsedChapterIds(parentNoteId, excludeChapterNoteId);
    if (!used.has(requestedBase)) return requestedBase;

    let attempt = 2;
    while (used.has(`${requestedBase}-${attempt}`)) {
      attempt += 1;
    }
    return `${requestedBase}-${attempt}`;
  }

  /**
   * Explicitly assigns a chapterId to one of `parentNoteId`'s chapters (the
   * chapter bar's right-click-to-assign path). Same normalization as a note's
   * `$id` (normalizeAssignedIdInput), but uniqueness is resolved only against
   * this parent's own other chapters, not globally. An empty/whitespace-only
   * `requestedRaw` clears it back to unassigned (the chapter bar's "···"
   * placeholder) rather than falling back to a derived default -- unlike
   * notes.assignedId, a chapter has no title-derived default to fall back to
   * (its label is otherwise just "§<position>"). Returns the final,
   * collision-resolved id that was actually stored, or null if cleared.
   */
  setChapterId(parentNoteId: string, chapterNoteId: string, requestedRaw: string): string | null {
    const db = this.requireDb();
    const normalized = normalizeAssignedIdInput(requestedRaw);
    const resolved = normalized.length > 0 ? this.resolveUniqueChapterId(parentNoteId, normalized, chapterNoteId) : null;
    db.prepare('UPDATE chapters SET chapterId = ? WHERE parentNoteId = ? AND chapterNoteId = ?').run(resolved, parentNoteId, chapterNoteId);
    return resolved;
  }

  /** Removes a chapter and closes the gap so every later chapter's position shifts forward by one. */
  removeChapter(parentNoteId: string, chapterNoteId: string): ChapterEntry[] {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      const removed = db.prepare('SELECT position FROM chapters WHERE parentNoteId = ? AND chapterNoteId = ?').get(parentNoteId, chapterNoteId) as { position: number } | undefined;
      if (!removed) return;
      db.prepare('DELETE FROM chapters WHERE parentNoteId = ? AND chapterNoteId = ?').run(parentNoteId, chapterNoteId);
      db.prepare('UPDATE chapters SET position = position - 1 WHERE parentNoteId = ? AND position > ?').run(parentNoteId, removed.position);
    });
    tx();
    return this.listChaptersForNote(parentNoteId);
  }

  /** Rewrites every chapter's position from an explicit final order -- used for drag-reorder. No UNIQUE(parentNoteId, position) constraint (mirroring reorderNoteTabs) since a straight per-row position rewrite can transiently collide mid-transaction otherwise. */
  reorderChapters(parentNoteId: string, orderedChapterNoteIds: string[]): ChapterEntry[] {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      orderedChapterNoteIds.forEach((chapterNoteId, index) => {
        db.prepare('UPDATE chapters SET position = ? WHERE parentNoteId = ? AND chapterNoteId = ?').run(index, parentNoteId, chapterNoteId);
      });
    });
    tx();
    return this.listChaptersForNote(parentNoteId);
  }

  /**
   * Forces `chapterNoteId` to position 0 among `parentNoteId`'s chapters,
   * shifting every other chapter back by one -- used once, right after the
   * auto-TOC chapter is created, to pin it first. Ordinary drag-reorder
   * (useNoteChapters.ts) never moves it again after that: the chapter bar
   * excludes it from the draggable/droppable set entirely, so this method
   * only ever needs to run at creation time, not on every regeneration.
   */
  pinChapterToFront(parentNoteId: string, chapterNoteId: string): ChapterEntry[] {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      db.prepare('UPDATE chapters SET position = position + 1 WHERE parentNoteId = ? AND chapterNoteId != ?').run(parentNoteId, chapterNoteId);
      db.prepare('UPDATE chapters SET position = 0 WHERE parentNoteId = ? AND chapterNoteId = ?').run(parentNoteId, chapterNoteId);
    });
    tx();
    return this.listChaptersForNote(parentNoteId);
  }

  /**
   * Forces `chapterNoteId` to position 1 -- right after the auto-TOC
   * chapter, which is guaranteed to already exist by the time an auto-Open-
   * Items chapter is ever created (Open Items requires at least one real
   * chapter to aggregate across, the exact same precondition regenerateAutoTocChapter
   * already requires, so TOC is always created first). Every other chapter
   * (positions 1+) shifts back by one; the auto-TOC chapter at position 0 is
   * untouched.
   */
  pinChapterAfterAutoToc(parentNoteId: string, chapterNoteId: string): ChapterEntry[] {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      db.prepare('UPDATE chapters SET position = position + 1 WHERE parentNoteId = ? AND chapterNoteId != ? AND position >= 1').run(parentNoteId, chapterNoteId);
      db.prepare('UPDATE chapters SET position = 1 WHERE parentNoteId = ? AND chapterNoteId = ?').run(parentNoteId, chapterNoteId);
    });
    tx();
    return this.listChaptersForNote(parentNoteId);
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

  /** Permanently deletes a note. If it's a parent, its chapters cascade-delete with it -- chapters have no life outside their parent (see `chapters` table doc), so `ON DELETE CASCADE` alone isn't enough: it only removes the `chapters` join row, not the chapter's own `notes` row. One level only -- chapters can't have sub-chapters. */
  deleteNote(id: string): void {
    const db = this.requireDb();
    const chapterNoteIds = (db.prepare('SELECT chapterNoteId FROM chapters WHERE parentNoteId = ?').all(id) as Array<{ chapterNoteId: string }>)
      .map((row) => row.chapterNoteId);

    const tx = db.transaction(() => {
      for (const chapterNoteId of chapterNoteIds) {
        db.prepare('DELETE FROM notes WHERE id = ?').run(chapterNoteId);
        db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(chapterNoteId);
      }
      db.prepare('DELETE FROM notes WHERE id = ?').run(id);
      db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(id);
    });
    tx();
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

  // Per the scroll-sync rewrite's policy, this now persists exactly one
  // mode-agnostic scroll concept -- anchorBlockIndex, the canonical BLOCK
  // (an index into the note's current PreviewMarkdownBlock[] array, see
  // PreviewBlockIndex.ts) -- alongside cursorPos, an unrelated caret-position
  // concern that stays a first-class field. progressPreview/progressEdit/
  // scrollTop/sourceAnchorLine/sourceAnchorText remain as dead columns (see
  // schema init below) rather than being dropped, matching this table's
  // existing precedent for retiring columns without a drop-column migration.
  saveNoteUiState(noteId: string, payload: {
    anchorBlockIndex?: number | null;
    cursorPos?: number | null;
    previewBlockCache?: string | null;
  }): void {
    const db = this.requireDb();
    const hasAnchorBlockIndex = Object.prototype.hasOwnProperty.call(payload, 'anchorBlockIndex');
    const hasCursorPos = Object.prototype.hasOwnProperty.call(payload, 'cursorPos');
    const hasPreviewBlockCache = Object.prototype.hasOwnProperty.call(payload, 'previewBlockCache');

    db.prepare(`
      UPDATE notes
      SET
        anchorBlockIndex = CASE WHEN ? THEN ? ELSE anchorBlockIndex END,
        cursorPos = CASE WHEN ? THEN ? ELSE cursorPos END,
        previewBlockCache = CASE WHEN ? THEN ? ELSE previewBlockCache END
      WHERE id = ?
    `).run(
      hasAnchorBlockIndex ? 1 : 0,
      payload.anchorBlockIndex ?? null,
      hasCursorPos ? 1 : 0,
      payload.cursorPos ?? null,
      hasPreviewBlockCache ? 1 : 0,
      payload.previewBlockCache ?? null,
      noteId,
    );
  }

  getNoteUiState(noteId: string): {
    anchorBlockIndex: number;
    cursorPos: number;
    previewBlockCache: string | null;
  } {
    const db = this.requireDb();

    const row = db.prepare(`
      SELECT anchorBlockIndex, cursorPos, previewBlockCache
      FROM notes
      WHERE id = ?
    `).get(noteId) as {
      anchorBlockIndex?: number | null;
      cursorPos?: number | null;
      previewBlockCache?: string | null;
    } | undefined;

    // A note row can sit with these columns at SQL NULL from creation until
    // the first UI-state save fires (see saveNoteUiState) -- if the app
    // closes or the note is switched away from before that, NULL persists
    // indefinitely. Every caller expects real numbers, so this is the one
    // place that turns "never saved yet" into the same default (start of
    // document, no scroll) a fresh note should have.
    return {
      anchorBlockIndex: row?.anchorBlockIndex ?? 0,
      cursorPos: row?.cursorPos ?? 0,
      previewBlockCache: row?.previewBlockCache ?? null,
    };
  }

  // Records a new snapshot. Automatic snapshots accumulate (retention -- see
  // runSnapshotRetention -- is responsible for thinning them, not this
  // method); the only pruning done here is deduping unchanged content:
  //  - if content is identical to the immediately preceding snapshot, no new
  //    row is written (nothing changed, nothing to record).
  //  - if that preceding snapshot was automatic and this save is manual, the
  //    existing row is promoted to manual in place, rather than leaving a
  //    duplicate automatic snapshot sitting right next to a new manual one
  //    with the same content.
  /** Returns the resulting snapshot's ID -- either newly inserted, or the existing latest one if content is unchanged (see dedup below). */
  saveNoteSnapshot(noteId: string, content: string, isManual = false): number {
    const db = this.requireDb();
    const timestamp = new Date().toISOString();

    return db.transaction(() => {
      const latest = db.prepare(`
        SELECT id, content, isManual FROM note_snapshots
        WHERE noteId = ?
        ORDER BY datetime(timestamp) DESC, id DESC
        LIMIT 1
      `).get(noteId) as { id: number; content: string; isManual: number } | undefined;

      if (latest && latest.content === content) {
        if (isManual && latest.isManual === 0) {
          db.prepare('UPDATE note_snapshots SET isManual = 1, timestamp = ? WHERE id = ?')
            .run(timestamp, latest.id);
        }
        return latest.id;
      }

      const result = db.prepare(`
        INSERT INTO note_snapshots (noteId, content, timestamp, isManual)
        VALUES (?, ?, ?, ?)
      `).run(noteId, content, timestamp, isManual ? 1 : 0);

      return Number(result.lastInsertRowid);
    })();
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

  listReviewFlags(noteId: string): ReviewFlagEntry[] {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT id, noteId, lineNumber, severity, lineHash
      FROM review_flags
      WHERE noteId = ?
      ORDER BY lineNumber ASC
    `).all(noteId) as ReviewFlagEntry[];
    return rows;
  }

  /** Upserts the flag at `flag.lineNumber` -- one flag per line, click-cycle path. */
  setReviewFlag(noteId: string, flag: ReviewFlagWrite): ReviewFlagEntry[] {
    const db = this.requireDb();
    db.transaction(() => {
      const existing = db.prepare('SELECT id FROM review_flags WHERE noteId = ? AND lineNumber = ?')
        .get(noteId, flag.lineNumber) as { id: number } | undefined;
      if (existing) {
        db.prepare('UPDATE review_flags SET severity = ?, lineHash = ? WHERE id = ?')
          .run(flag.severity, flag.lineHash, existing.id);
      } else {
        db.prepare('INSERT INTO review_flags (noteId, lineNumber, severity, lineHash) VALUES (?, ?, ?, ?)')
          .run(noteId, flag.lineNumber, flag.severity, flag.lineHash);
      }
    })();
    return this.listReviewFlags(noteId);
  }

  /** Deletes the flag at `lineNumber`, if any -- the deliberate right-click-to-resolve path. */
  clearReviewFlag(noteId: string, lineNumber: number): ReviewFlagEntry[] {
    const db = this.requireDb();
    db.prepare('DELETE FROM review_flags WHERE noteId = ? AND lineNumber = ?').run(noteId, lineNumber);
    return this.listReviewFlags(noteId);
  }

  /**
   * Applies exact post-edit line-number/hash corrections (computed via CM6
   * ChangeSet.mapPos in the renderer) keyed by each flag's row id. Any
   * existing flag for this note whose id is absent from `remaps` is deleted
   * -- the caller already resolved a remap collision (two flags landing on
   * the same line) by dropping the less severe one before calling this.
   */
  syncReviewFlags(noteId: string, remaps: ReviewFlagRemap[]): ReviewFlagEntry[] {
    const db = this.requireDb();
    db.transaction(() => {
      const keepIds = new Set(remaps.map((remap) => remap.id));
      const existingIds = (db.prepare('SELECT id FROM review_flags WHERE noteId = ?').all(noteId) as Array<{ id: number }>)
        .map((row) => row.id);
      for (const id of existingIds) {
        if (!keepIds.has(id)) {
          db.prepare('DELETE FROM review_flags WHERE id = ?').run(id);
        }
      }
      const update = db.prepare('UPDATE review_flags SET lineNumber = ?, lineHash = ? WHERE id = ? AND noteId = ?');
      for (const remap of remaps) {
        update.run(remap.lineNumber, remap.lineHash, remap.id, noteId);
      }
    })();
    return this.listReviewFlags(noteId);
  }

  // Per-snapshot counterpart to saveNoteUiState/getNoteUiState -- a Timeline
  // snapshot tracks its own canonical BLOCK independently once loaded,
  // written when it's navigated away from (see useNoteSnapshotTimeline.ts's
  // handleNavigateSnapshot) rather than sharing the live note's position.
  saveSnapshotAnchor(snapshotId: number, anchorBlockIndex: number | null): void {
    const db = this.requireDb();
    db.prepare('UPDATE note_snapshots SET anchorBlockIndex = ? WHERE id = ?').run(anchorBlockIndex, snapshotId);
  }

  getSnapshotAnchor(snapshotId: number): number {
    const db = this.requireDb();
    const row = db.prepare('SELECT anchorBlockIndex FROM note_snapshots WHERE id = ?').get(snapshotId) as { anchorBlockIndex?: number | null } | undefined;
    return row?.anchorBlockIndex ?? 0;
  }

  getSnapshotById(snapshotId: number): {
    id: number;
    noteId: string;
    content: string;
    timestamp: string;
    isManual: boolean;
  } | undefined {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT id, noteId, content, timestamp, isManual
      FROM note_snapshots
      WHERE id = ?
    `).get(snapshotId) as {
      id: number;
      noteId: string;
      content: string;
      timestamp: string;
      isManual: number;
    } | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      noteId: row.noteId,
      content: row.content,
      timestamp: row.timestamp,
      isManual: Boolean(row.isManual),
    };
  }

  // Copies every snapshot of `sourceNoteId` at or before `cutoffTimestamp` onto
  // `newNoteId`, preserving original timestamps and manual/automatic flags.
  // Used when branching a new note off an existing note's timeline: the branch
  // should open with the shared history intact up to the point it diverged.
  cloneSnapshotsUpTo(sourceNoteId: string, newNoteId: string, cutoffTimestamp: string): void {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT content, timestamp, isManual
      FROM note_snapshots
      WHERE noteId = ? AND datetime(timestamp) <= datetime(?)
      ORDER BY datetime(timestamp) ASC
    `).all(sourceNoteId, cutoffTimestamp) as Array<{
      content: string;
      timestamp: string;
      isManual: number;
    }>;

    if (rows.length === 0) return;

    const insertStmt = db.prepare(`
      INSERT INTO note_snapshots (noteId, content, timestamp, isManual)
      VALUES (?, ?, ?, ?)
    `);

    const tx = db.transaction((items: typeof rows) => {
      for (const row of items) {
        insertStmt.run(newNoteId, row.content, row.timestamp, row.isManual);
      }
    });

    tx(rows);
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
  // Audio bounce cache — per-key OfflineAudioContext-rendered typing sounds,
  // see TypingSoundManager's E1/E4. Mirrors the texture cache above: render
  // once, cache to disk keyed by (keyId, settingsSignature), skip the render
  // on the next launch.
  // -------------------------------------------------------------------------

  getAudioBounceCache(request: AudioBounceCacheRequest): AudioBounceCacheHit | null {
    const db = this.requireDb();

    const row = db.prepare(`
      SELECT data, sampleRate, numberOfChannels, length
      FROM audio_bounce_cache
      WHERE keyId = ? AND settingsSignature = ?
      LIMIT 1
    `).get(request.keyId, request.settingsSignature) as
      { data: Buffer; sampleRate: number; numberOfChannels: number; length: number } | undefined;

    if (!row) {
      return null;
    }

    db.prepare(`
      UPDATE audio_bounce_cache SET createdAt = ? WHERE keyId = ? AND settingsSignature = ?
    `).run(Date.now(), request.keyId, request.settingsSignature);

    return {
      data: new Uint8Array(row.data),
      sampleRate: row.sampleRate,
      numberOfChannels: row.numberOfChannels,
      length: row.length,
    };
  }

  saveAudioBounceCache(request: AudioBounceCacheRequest, payload: AudioBounceCacheHit): void {
    const db = this.requireDb();

    db.prepare(`
      INSERT OR REPLACE INTO audio_bounce_cache (
        keyId, settingsSignature, sampleRate, numberOfChannels, length, data, createdAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      request.keyId,
      request.settingsSignature,
      payload.sampleRate,
      payload.numberOfChannels,
      payload.length,
      Buffer.from(payload.data),
      Date.now(),
    );

    this.purgeAudioBounceCache();
  }

  private purgeAudioBounceCache(): void {
    const db = this.requireDb();
    const cutoffMs = Date.now() - AUDIO_BOUNCE_CACHE_DEFAULT_MAX_AGE_MS;

    const rows = db.prepare(`
      SELECT rowid, createdAt FROM audio_bounce_cache ORDER BY createdAt DESC
    `).all() as Array<{ rowid: number; createdAt: number }>;

    const deleteStmt = db.prepare('DELETE FROM audio_bounce_cache WHERE rowid = ?');
    let retainedCount = 0;

    const tx = db.transaction(() => {
      for (const row of rows) {
        const isExpired = row.createdAt < cutoffMs;
        const exceedsCap = retainedCount >= AUDIO_BOUNCE_CACHE_DEFAULT_MAX_ENTRIES;
        if (isExpired || exceedsCap) {
          deleteStmt.run(row.rowid);
          continue;
        }
        retainedCount += 1;
      }
    });

    tx();
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

      LIGHT_FACTORY_PRESETS.forEach((preset, index) => seedRow(index + 1, preset, index === 0));
      DARK_FACTORY_PRESETS.forEach((preset, index) => seedRow(-(index + 1), preset, index === 0));

      seedRow(LOADOUT_DEFAULT_CUSTOM_ID_ABS, DEFAULT_CUSTOM_LIGHT, false);
      seedRow(-LOADOUT_DEFAULT_CUSTOM_ID_ABS, DEFAULT_CUSTOM_DARK, false);

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

    const targetAbs = Math.abs(targetId);

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM ui_loadout_entries WHERE id = ?`).run(targetId);

      if (existing.isActive) {
        db.prepare(`UPDATE ui_loadout_entries SET isActive = 0 WHERE id * ? > 0`).run(sign);
        db.prepare(`UPDATE ui_loadout_entries SET isActive = 1, updatedAt = ? WHERE id = ?`).run(timestamp, defaultCustomId);
      }

      // Close the gap: every remaining custom slot with a higher number in
      // this mode shifts down by one so the numbering stays contiguous.
      const shiftRows = (db.prepare(`
        SELECT id FROM ui_loadout_entries
        WHERE id * ? > 0 AND ABS(id) > ? AND ABS(id) >= ?
        ORDER BY ABS(id) ASC
      `).all(sign, targetAbs, LOADOUT_FIRST_CUSTOM_ID_ABS) as { id: number }[]);

      for (const row of shiftRows) {
        db.prepare(`UPDATE ui_loadout_entries SET id = ? WHERE id = ?`).run(row.id - sign, row.id);
      }

      let lastCustomId = this.readLoadoutMeta(`lastCustomId:${mode}`, defaultCustomId);
      if (lastCustomId === targetId) {
        lastCustomId = defaultCustomId;
      } else if (Math.abs(lastCustomId) > targetAbs) {
        lastCustomId -= sign;
      }
      this.writeLoadoutMeta(`lastCustomId:${mode}`, lastCustomId);
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

  getMusicSongById(id: number): MusicSongEntry | null {
    const db = this.requireDb();
    const row = db.prepare('SELECT * FROM music_songs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSongEntry(row) : null;
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
        fileToken TEXT UNIQUE,
        previewBlockCache TEXT
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

      CREATE TABLE IF NOT EXISTS audio_bounce_cache (
        keyId TEXT NOT NULL,
        settingsSignature TEXT NOT NULL,
        sampleRate INTEGER NOT NULL,
        numberOfChannels INTEGER NOT NULL,
        length INTEGER NOT NULL,
        data BLOB NOT NULL,
        createdAt INTEGER NOT NULL,
        PRIMARY KEY (keyId, settingsSignature)
      );

      CREATE INDEX IF NOT EXISTS idx_audio_bounce_cache_created_at ON audio_bounce_cache(createdAt DESC);

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

      CREATE TABLE IF NOT EXISTS editor_sections (
        id               TEXT PRIMARY KEY,
        name             TEXT,
        position         INTEGER,
        widthFraction    REAL,
        fixedWidthPx     REAL,
        lastActiveNoteId TEXT REFERENCES notes(id) ON DELETE SET NULL,
        noteSlotInitialized INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_editor_sections_position ON editor_sections(position);

      CREATE TABLE IF NOT EXISTS note_tabs (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        sectionId TEXT    NOT NULL,
        noteId    TEXT    NOT NULL,
        position  INTEGER NOT NULL,
        addedAt   INTEGER NOT NULL,
        -- Which chapter of noteId this tab last showed, so switching back
        -- to it resumes that chapter instead of always landing on the base
        -- note -- see ensureNoteTabsColumn's call site below for why this is
        -- an ALTER TABLE migration rather than added here directly. Null
        -- means "last showed the base note itself".
        lastActiveChapterNoteId TEXT REFERENCES notes(id) ON DELETE SET NULL,
        UNIQUE (sectionId, noteId),
        FOREIGN KEY (sectionId) REFERENCES editor_sections(id) ON DELETE CASCADE,
        FOREIGN KEY (noteId)    REFERENCES notes(id)            ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_note_tabs_section_position ON note_tabs(sectionId, position);

      -- A note can be a chapter of at most one parent, ever -- enforced by
      -- idx_chapters_chapterNoteId_unique below (added via migration, since
      -- ALTER TABLE can't add a UNIQUE constraint directly on an existing
      -- table). The (parentNoteId, chapterNoteId) pair below is redundant
      -- with that global constraint but harmless to keep.
      CREATE TABLE IF NOT EXISTS chapters (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        parentNoteId  TEXT    NOT NULL,
        position      INTEGER NOT NULL,
        chapterNoteId TEXT    NOT NULL,
        -- User-assignable label ($noteid section chapterId link syntax,
        -- chapter-bar right-click) -- same normalization/dedup rules as
        -- notes.assignedId, but scoped per parentNoteId instead of globally.
        -- Null until first assigned; displayed as the chapter bar's
        -- placeholder ("...") until then.
        chapterId     TEXT,
        UNIQUE (parentNoteId, chapterNoteId),
        CHECK (parentNoteId != chapterNoteId),
        FOREIGN KEY (parentNoteId)  REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (chapterNoteId) REFERENCES notes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chapters_parent_position ON chapters(parentNoteId, position);

      -- One row per flagged line. No UNIQUE(noteId, lineNumber): a live edit
      -- can transiently remap two flags onto the same line before collision
      -- resolution (keep-the-more-severe, done by the caller) runs and
      -- deletes the loser via syncReviewFlags. lineHash is a cold-load
      -- sanity check only -- see src/shared/reviewFlags.ts.
      CREATE TABLE IF NOT EXISTS review_flags (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        noteId     TEXT    NOT NULL,
        lineNumber INTEGER NOT NULL,
        severity   TEXT    NOT NULL CHECK (severity IN ('review', 'warning')),
        lineHash   TEXT    NOT NULL,
        FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_review_flags_note ON review_flags(noteId);
    `);

    // A fresh install always starts with exactly one (default, unnamed)
    // section — the split-view UI grows the rest from there.
    const { sectionCount } = this.requireDb()
      .prepare('SELECT COUNT(*) AS sectionCount FROM editor_sections')
      .get() as { sectionCount: number };
    if (sectionCount === 0) {
      this.requireDb()
        .prepare('INSERT INTO editor_sections (id, name, position, widthFraction, lastActiveNoteId) VALUES (?, NULL, 0, NULL, NULL)')
        .run(DEFAULT_EDITOR_SECTION_ID);
    }

    // sourceAnchorLine/sourceAnchorText retained as dead columns (superseded
    // by anchorBlockIndex below, per the scroll-sync rewrite -- see
    // saveNoteUiState/getNoteUiState) rather than dropped, matching this
    // table's existing precedent (progressPreview/progressEdit/scrollTop)
    // for retiring columns without a drop-column migration.
    this.ensureNotesColumn('sourceAnchorLine', 'INTEGER');
    this.ensureNotesColumn('sourceAnchorText', 'TEXT');
    this.ensureNotesColumn('contentChecksum', 'TEXT');
    this.ensureNotesColumn('assignedId', 'TEXT');
    // The canonical mode-agnostic BLOCK: an index into the note's current
    // PreviewMarkdownBlock[] array (PreviewBlockIndex.ts), not a pixel
    // offset or a raw line number. See docs/editor-contract.md's Viewport
    // Model section.
    this.ensureNotesColumn('anchorBlockIndex', 'INTEGER');
    // Persisted structural preview-block cache, keyed to the note text via
    // its SHA-256 checksum. Lets the first edit->preview toggle after app
    // startup warm-start from the previous session's parse instead of
    // re-parsing the whole document. Safe to discard (falls back to full
    // parse) if the text or parser version changes.
    this.ensureNotesColumn('previewBlockCache', 'TEXT');
    // A note created as a chapter of another note (via the chapter bar's "+"
    // button) -- excluded from every menu view (date/category/archive/trash)
    // since it only exists to be shown through its parent's chapter bar. See
    // the `chapters` table above for the parent/position/chapter linkage.
    this.ensureNotesColumn('chapterOnly', 'INTEGER NOT NULL DEFAULT 0');
    // Marks the one chapter (if any) that's the auto-generated table of
    // contents for its parent's whole chapter family -- see
    // regenerateAutoTocChapter, for what populates it. A dedicated flag
    // rather than reusing chapterId (e.g. a reserved "TOC" label) deliberately:
    // reserved "TOC" label) deliberately: chapterId is user-editable text
    // (right-click any chapter to retype it), so a reserved string could
    // collide with something a user typed themselves, silently reassigning
    // "the auto-TOC chapter" identity or getting quietly renamed out from
    // under it by resolveUniqueChapterId's own dedup suffixing. This flag
    // can't collide with anything.
    this.ensureNotesColumn('isAutoToc', 'INTEGER NOT NULL DEFAULT 0');
    // Marks the one chapter (if any) that's the auto-generated Open Items
    // (unchecked checklist items) chapter for its parent's whole chapter
    // family -- see noteLifecycleService.ts's regenerateOpenItemsGroup and
    // neighbors. Same "dedicated flag, not a reserved chapterId" reasoning
    // as isAutoToc just above.
    this.ensureNotesColumn('isAutoOpenItems', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureChaptersColumn('chapterId', 'TEXT');
    // Deliberately after ensureChaptersColumn, not inside the CREATE TABLE
    // block above: on a database that already had a `chapters` table before
    // chapterId existed, CREATE TABLE IF NOT EXISTS is a no-op, so an index
    // referencing chapterId there would run before the ALTER TABLE that adds
    // it -- "no such column: chapterId", aborting ensureSchema (and startup)
    // entirely. Same reasoning, and same fix, as idx_notes_internal_id below.
    this.requireDb().exec(`
      CREATE INDEX IF NOT EXISTS idx_chapters_parent_chapterid ON chapters(parentNoteId, chapterId);
    `);
    // One-time (but idempotent -- safe to re-run every startup) migration
    // back to "a chapter belongs to at most one parent, ever", reverting the
    // multi-parent experiment. Order matters: dedupe before the unique index,
    // tag merge before the orphan purge (purge would otherwise silently drop
    // tags along with truly-orphaned notes, which is fine, but merge first
    // means only actually-orphaned notes lose anything).
    this.migrateChaptersToSingleParent();
    this.migrateChapterTagsToParent();
    this.purgeParentlessChapters();
    this.ensureNoteSnapshotsColumn('anchorBlockIndex', 'INTEGER');

    // Notes are inserted (both on creation and on filesystem-sync upsert)
    // without ever setting cursorPos/anchorBlockIndex/progress*, so they
    // start at SQL NULL until the first UI-state save. getNoteUiState now
    // defaults NULL to 0 on read, but backfill any rows already sitting on a
    // stale NULL so direct SQL access elsewhere sees the same default.
    db.exec(`
      UPDATE notes SET progressPreview = 0 WHERE progressPreview IS NULL;
      UPDATE notes SET progressEdit = 0 WHERE progressEdit IS NULL;
      UPDATE notes SET cursorPos = 0 WHERE cursorPos IS NULL;
      UPDATE notes SET anchorBlockIndex = 0 WHERE anchorBlockIndex IS NULL;
    `);
    this.ensureEditorSectionsColumn('lastActiveNoteId', 'TEXT REFERENCES notes(id) ON DELETE SET NULL');
    this.ensureEditorSectionsColumn('fixedWidthPx', 'REAL');
    this.ensureEditorSectionsColumn('noteSlotInitialized', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureNoteTabsColumn('lastActiveChapterNoteId', 'TEXT REFERENCES notes(id) ON DELETE SET NULL');

    this.requireDb().exec(`
      CREATE INDEX IF NOT EXISTS idx_notes_internal_id ON notes(assignedId);
    `);
  }

  private ensureNotesColumn(columnName: string, columnDefinition: string): void {
    const db = this.requireDb();
    const columns = db.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    db.exec(`ALTER TABLE notes ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  private ensureEditorSectionsColumn(columnName: string, columnDefinition: string): void {
    const db = this.requireDb();
    const columns = db.prepare('PRAGMA table_info(editor_sections)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    db.exec(`ALTER TABLE editor_sections ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  private ensureNoteTabsColumn(columnName: string, columnDefinition: string): void {
    const db = this.requireDb();
    const columns = db.prepare('PRAGMA table_info(note_tabs)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    db.exec(`ALTER TABLE note_tabs ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  private ensureNoteSnapshotsColumn(columnName: string, columnDefinition: string): void {
    const db = this.requireDb();
    const columns = db.prepare('PRAGMA table_info(note_snapshots)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    db.exec(`ALTER TABLE note_snapshots ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  private ensureChaptersColumn(columnName: string, columnDefinition: string): void {
    const db = this.requireDb();
    const columns = db.prepare('PRAGMA table_info(chapters)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    db.exec(`ALTER TABLE chapters ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  /**
   * Reverts the multi-parent chapter experiment: a chapter note can only
   * ever belong to one parent. For any chapterNoteId still attached to more
   * than one parent (left over from before this migration), keeps the
   * oldest attachment (lowest `chapters.id`) and drops the rest, then adds a
   * unique index enforcing this going forward. ALTER TABLE can't add a
   * UNIQUE constraint to an existing table, hence the index rather than a
   * rewritten CREATE TABLE.
   */
  private migrateChaptersToSingleParent(): void {
    const db = this.requireDb();
    db.exec(`
      DELETE FROM chapters
      WHERE id NOT IN (SELECT MIN(id) FROM chapters GROUP BY chapterNoteId);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_chapters_chapterNoteId_unique ON chapters(chapterNoteId);
    `);
  }

  /**
   * Chapters have no *regular* tag life of their own -- tags always belong
   * to the parent note. Merges any regular tags still sitting on a
   * `chapterOnly` note (leftover from before chapters stopped exposing
   * their own tag bar) up onto that chapter's parent, then clears just
   * those rows.
   *
   * Protected tags ('archived'/'deleted'/the external-file tag) are
   * deliberately left untouched here -- unlike regular tags, a chapter's
   * own archived/deleted state is real per-chapter data (see
   * ChapterBar.tsx's archive/delete split pill), not a stray leftover to
   * fold into the parent. Getting this filter wrong would silently strip
   * that state back off the chapter on every single app boot, since this
   * migration re-runs idempotently on every startup -- exactly the kind of
   * bug this codebase has shipped more than once (see CLAUDE.md's state-
   * persistence contract for the general pattern).
   */
  private migrateChapterTagsToParent(): void {
    const db = this.requireDb();
    const orphanTagRows = db.prepare(`
      SELECT nt.noteId AS chapterNoteId, nt.tagId AS tagId, c.parentNoteId AS parentNoteId, t.name AS tagName
      FROM note_tags nt
      JOIN notes n ON n.id = nt.noteId AND n.chapterOnly = 1
      JOIN chapters c ON c.chapterNoteId = nt.noteId
      JOIN tags t ON t.id = nt.tagId
    `).all() as Array<{ chapterNoteId: string; tagId: number; parentNoteId: string; tagName: string }>;

    const regularTagRows = orphanTagRows.filter((row) => !PROTECTED_TAGS.includes(row.tagName as typeof PROTECTED_TAGS[number]));
    if (regularTagRows.length === 0) return;

    const insertOntoParentStmt = db.prepare(`
      INSERT OR IGNORE INTO note_tags (noteId, tagId, position)
      VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM note_tags WHERE noteId = ?))
    `);
    const clearChapterTagStmt = db.prepare('DELETE FROM note_tags WHERE noteId = ? AND tagId = ?');

    const tx = db.transaction(() => {
      for (const row of regularTagRows) {
        insertOntoParentStmt.run(row.parentNoteId, row.tagId, row.parentNoteId);
        clearChapterTagStmt.run(row.chapterNoteId, row.tagId);
      }
    });
    tx();
  }

  /** A `chapterOnly` note with no `chapters` row at all can't be reached from anywhere -- it isn't shown in any menu view, and it isn't anyone's chapter. Cleans up leftovers from prior states/bugs rather than leaving them permanently invisible. */
  private purgeParentlessChapters(): void {
    const db = this.requireDb();
    db.exec(`
      DELETE FROM notes_fts WHERE noteId IN (
        SELECT id FROM notes WHERE chapterOnly = 1 AND id NOT IN (SELECT chapterNoteId FROM chapters)
      );
      DELETE FROM notes WHERE chapterOnly = 1 AND id NOT IN (SELECT chapterNoteId FROM chapters);
    `);
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
