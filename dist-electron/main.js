var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promises, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const CONTROL_AND_INVISIBLE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2060\uFEFF]/g;
const VARIATION_SELECTORS = /[\uFE0E\uFE0F]/g;
const EMOJI_PICTOGRAPHICS = new RegExp("\\p{Extended_Pictographic}", "gu");
const HTML_TAGS = /<[^>\n]*>/g;
function normalizeLineSeparators(input) {
  return input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[\u2028\u2029]/g, "\n");
}
function sanitizeTextFragment(input) {
  return normalizeLineSeparators(input).replace(EMOJI_PICTOGRAPHICS, "").replace(VARIATION_SELECTORS, "").replace(CONTROL_AND_INVISIBLE_CHARS, "");
}
function sanitizeDocumentText(input) {
  return sanitizeTextFragment(input).replace(HTML_TAGS, "");
}
const NOTES_DIR_NAME = "notes";
const META_PREFIX$1 = "<!-- measly-meta:";
const META_SUFFIX$1 = "-->";
const EXTERNAL_TAG$1 = "EXTERNAL";
function normalizeText$1(text) {
  return sanitizeDocumentText(text);
}
function normalizeLineEndingsOnly(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[\u2028\u2029]/g, "\n");
}
function checksumText$1(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function titleFromText$1(text) {
  const lines = normalizeText$1(text).split("\n");
  const heading = lines.find((line) => line.startsWith("# ") && line.trim().length > 2);
  if (heading) return heading.slice(2).trim();
  const firstContent = lines.find((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && trimmed !== "#";
  });
  return (firstContent == null ? void 0 : firstContent.trim()) ?? "Untitled";
}
function parseNoteMetadata(rawText, sanitize) {
  var _a;
  const normalized = sanitize ? normalizeText$1(rawText) : normalizeLineEndingsOnly(rawText);
  const lines = normalized.split("\n");
  const firstLine = ((_a = lines[0]) == null ? void 0 : _a.trim()) ?? "";
  if (!firstLine.startsWith(META_PREFIX$1) || !firstLine.endsWith(META_SUFFIX$1)) {
    return { bodyText: normalized };
  }
  const jsonPayload = firstLine.slice(META_PREFIX$1.length, firstLine.length - META_SUFFIX$1.length).trim();
  try {
    JSON.parse(jsonPayload);
    return {
      bodyText: lines.slice(1).join("\n")
    };
  } catch {
    return { bodyText: normalized };
  }
}
function isExternalTag(tagName) {
  return tagName.trim().toLowerCase() === "external";
}
function idToFileName(id) {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safe}.md`;
}
function buildNoteId(now) {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const suffix = randomBytes(5).toString("base64url").toUpperCase();
  return `${yy}-${mm}-${dd}_${hh}-${min}_${suffix}`;
}
class NoteLifecycleService {
  constructor(dataRoot, databaseService2) {
    __publicField(this, "notesDir");
    __publicField(this, "databaseService");
    this.notesDir = path.join(dataRoot, NOTES_DIR_NAME);
    this.databaseService = databaseService2;
  }
  async ensureNotesDir() {
    await promises.mkdir(this.notesDir, { recursive: true });
  }
  notePathFromId(id) {
    const fileName = idToFileName(id);
    return {
      fileName,
      filePath: path.join(this.notesDir, fileName)
    };
  }
  async readSummary(record) {
    try {
      const text = record.isTemp ? this.databaseService.getNoteContentSnapshot(record.id) ?? "" : await promises.readFile(record.filePath, "utf8");
      const stat = record.isTemp ? {
        birthtimeMs: record.createdAtMs,
        mtimeMs: record.updatedAtMs,
        size: Buffer.byteLength(text, "utf8")
      } : await promises.stat(record.filePath);
      const parsed = parseNoteMetadata(text, true);
      const fileName = path.basename(record.filePath);
      return {
        id: record.id,
        fileName,
        title: titleFromText$1(parsed.bodyText),
        tags: this.databaseService.getNoteTags(record.id),
        createdAtMs: stat.birthtimeMs || record.createdAtMs,
        updatedAtMs: stat.mtimeMs,
        sizeBytes: stat.size
      };
    } catch {
      return null;
    }
  }
  async listNotes() {
    const records = this.databaseService.listNoteRecords();
    const summaries = await Promise.all(records.map((record) => this.readSummary(record)));
    return summaries.filter((summary) => summary !== null).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }
  async loadNote(input) {
    const record = this.databaseService.getNoteRecord(input.id);
    const filePath = (record == null ? void 0 : record.filePath) ?? path.join(this.notesDir, idToFileName(input.id));
    const fileName = path.basename(filePath);
    const rawText = (record == null ? void 0 : record.isTemp) ? this.databaseService.getNoteContentSnapshot(input.id) ?? "" : await promises.readFile(filePath, "utf8");
    const stat = (record == null ? void 0 : record.isTemp) ? {
      birthtimeMs: record.createdAtMs,
      mtimeMs: record.updatedAtMs,
      size: Buffer.byteLength(rawText, "utf8")
    } : await promises.stat(filePath);
    let text = rawText;
    let shouldSanitize = true;
    if (!(record == null ? void 0 : record.isTemp)) {
      const storedChecksum = record == null ? void 0 : record.contentChecksum;
      const currentChecksum = checksumText$1(rawText);
      shouldSanitize = !(storedChecksum && storedChecksum === currentChecksum);
    }
    if (shouldSanitize) {
      const sanitizedText = normalizeText$1(rawText);
      text = sanitizedText;
      if (record == null ? void 0 : record.isTemp) {
        this.databaseService.upsertNoteContent({
          id: input.id,
          title: titleFromText$1(sanitizedText),
          filePath,
          text: sanitizedText,
          createdAtMs: record.createdAtMs,
          updatedAtMs: Date.now()
        });
      } else {
        if (sanitizedText !== rawText) {
          await promises.writeFile(filePath, sanitizedText, "utf8");
        }
        this.databaseService.upsertNoteContent({
          id: input.id,
          title: titleFromText$1(sanitizedText),
          filePath,
          text: sanitizedText,
          createdAtMs: stat.birthtimeMs || (record == null ? void 0 : record.createdAtMs) || stat.mtimeMs,
          updatedAtMs: stat.mtimeMs
        });
      }
    }
    const parsed = parseNoteMetadata(text, shouldSanitize);
    return {
      id: input.id,
      fileName,
      title: titleFromText$1(parsed.bodyText),
      tags: this.databaseService.getNoteTags(input.id),
      createdAtMs: stat.birthtimeMs || (record == null ? void 0 : record.createdAtMs) || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
      sizeBytes: Buffer.byteLength(text, "utf8"),
      text: parsed.bodyText
    };
  }
  async createNote(input) {
    await this.ensureNotesDir();
    const id = buildNoteId(/* @__PURE__ */ new Date());
    const fileName = idToFileName(id);
    const filePath = path.join(this.notesDir, fileName);
    const text = normalizeText$1((input == null ? void 0 : input.initialText) ?? "");
    await promises.writeFile(filePath, text, "utf8");
    const stat = await promises.stat(filePath);
    this.databaseService.upsertNoteContent({
      id,
      title: titleFromText$1(text),
      filePath,
      text,
      createdAtMs: stat.birthtimeMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs
    });
    return this.loadNote({ id });
  }
  async saveNote(input) {
    const record = this.databaseService.getNoteRecord(input.id);
    const filePath = (record == null ? void 0 : record.filePath) ?? path.join(this.notesDir, idToFileName(input.id));
    const text = normalizeText$1(input.text);
    if (record == null ? void 0 : record.isTemp) {
      const nowMs = Date.now();
      this.databaseService.upsertNoteContent({
        id: input.id,
        title: titleFromText$1(text),
        filePath,
        text,
        createdAtMs: record.createdAtMs,
        updatedAtMs: nowMs
      });
      this.databaseService.updateTempNoteState(input.id, true, false);
      const summary2 = await this.readSummary(this.databaseService.getNoteRecord(input.id) ?? {
        id: input.id,
        title: titleFromText$1(text),
        filePath,
        createdAtMs: record.createdAtMs,
        updatedAtMs: nowMs,
        contentChecksum: null,
        isTemp: true,
        externalPath: record.externalPath,
        hasUnsavedChanges: true,
        syncMode: false
      });
      if (!summary2) {
        throw new Error(`Failed to read saved temp note summary for id=${input.id}`);
      }
      return summary2;
    }
    await promises.writeFile(filePath, text, "utf8");
    const stat = await promises.stat(filePath);
    this.databaseService.upsertNoteContent({
      id: input.id,
      title: titleFromText$1(text),
      filePath,
      text,
      createdAtMs: stat.birthtimeMs || (record == null ? void 0 : record.createdAtMs) || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs
    });
    const summary = await this.readSummary(this.databaseService.getNoteRecord(input.id) ?? {
      id: input.id,
      title: titleFromText$1(text),
      filePath,
      createdAtMs: stat.birthtimeMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
      contentChecksum: null,
      isTemp: false,
      externalPath: null,
      hasUnsavedChanges: false,
      syncMode: false
    });
    if (!summary) {
      throw new Error(`Failed to read saved note summary for id=${input.id}`);
    }
    return summary;
  }
  async deleteNote(input) {
    const record = this.databaseService.getNoteRecord(input.id);
    if (record == null ? void 0 : record.isTemp) {
      this.databaseService.deleteTempNote(input.id);
      return;
    }
    const filePath = (record == null ? void 0 : record.filePath) ?? path.join(this.notesDir, idToFileName(input.id));
    await promises.unlink(filePath);
    this.databaseService.deleteNote(input.id);
  }
  async getNoteTags(input) {
    return this.databaseService.getNoteTags(input.id);
  }
  async addTagToNote(input) {
    return this.databaseService.addTagToNote(input.id, input.tagName, input.position);
  }
  async removeTagFromNote(input) {
    const record = this.databaseService.getNoteRecord(input.id);
    const removingExternalTag = isExternalTag(input.tagName);
    if ((record == null ? void 0 : record.isTemp) && removingExternalTag) {
      await this.ensureNotesDir();
      const { filePath } = this.notePathFromId(input.id);
      const snapshot = this.databaseService.getNoteContentSnapshot(input.id) ?? "";
      await promises.writeFile(filePath, snapshot, "utf8");
      const stat = await promises.stat(filePath);
      this.databaseService.convertTempNoteToRegular(input.id, filePath);
      this.databaseService.upsertNoteContent({
        id: input.id,
        title: titleFromText$1(snapshot),
        filePath,
        text: snapshot,
        createdAtMs: record.createdAtMs,
        updatedAtMs: stat.mtimeMs
      });
      return this.databaseService.removeTagFromNote(input.id, EXTERNAL_TAG$1);
    }
    return this.databaseService.removeTagFromNote(input.id, input.tagName);
  }
  async reorderNoteTags(input) {
    return this.databaseService.reorderNoteTags(input.id, input.tagNames);
  }
  async renameTag(input) {
    return this.databaseService.renameTag(input);
  }
  async listTags() {
    return this.databaseService.listTags();
  }
}
const NOTE_LIFECYCLE_CHANNELS = {
  list: "notes:list",
  load: "notes:load",
  create: "notes:create",
  save: "notes:save",
  remove: "notes:remove",
  getNoteTags: "tags:get-note-tags",
  addTag: "tags:add",
  removeTag: "tags:remove",
  reorderTags: "tags:reorder",
  renameTag: "tags:rename",
  listTags: "tags:list"
};
const APP_STATE_CHANNELS = {
  loadAppState: "state:app:load",
  saveAppState: "state:app:save",
  loadWindowState: "state:window:load",
  saveWindowState: "state:window:save"
};
const APP_STATE_FILE = "app-state.json";
const WINDOW_STATE_FILE = "window-state.json";
const DEFAULT_APP_STATE = {
  selectedNoteId: null,
  viewport: void 0,
  menu: {
    sidebarMode: "date",
    selectedMonths: [],
    selectedYears: [],
    searchQuery: "",
    isPreviewMode: false,
    viewStyle: "modern",
    viewFontSize: "m",
    viewSpacing: "cozy",
    editorStyle: "syne",
    editorFontSize: "m",
    editorSpacing: "cozy",
    sidebarWidthRatio: 0.306,
    tagSplitRatio: 0.645,
    scrollEaseMultiplier: 1.5,
    scrollDistanceTimeInfluence: 0.1,
    scrollBaseDistanceRows: 20,
    scrollMaxDurationMultiplier: 4,
    sidebarViewState: {
      date: { page: 1, scrollTop: 0 },
      category: { scrollTop: 0, collapsedPrimary: [], collapsedSecondary: [] },
      archive: { scrollTop: 0, collapsedPrimary: [], collapsedSecondary: [] },
      trash: { page: 1, scrollTop: 0 },
      find: { scrollTop: 0 }
    }
  }
};
const DEFAULT_WINDOW_STATE = {
  width: 1200,
  height: 900,
  isMaximized: false
};
function sanitizeViewport(input) {
  if (!input) return void 0;
  const topBoundaryPx = typeof input.topBoundaryPx === "number" ? Math.max(0, Math.round(input.topBoundaryPx)) : 0;
  const bottomBoundaryPx = typeof input.bottomBoundaryPx === "number" ? Math.max(0, Math.round(input.bottomBoundaryPx)) : 0;
  const scrollTopPx = typeof input.scrollTopPx === "number" ? Math.max(0, Math.round(input.scrollTopPx)) : 0;
  return {
    topBoundaryPx,
    bottomBoundaryPx,
    scrollTopPx
  };
}
function sanitizeSidebarMode(input) {
  if (input === "date" || input === "category" || input === "archive" || input === "trash" || input === "find") {
    return input;
  }
  return "date";
}
function sanitizeEditorStyle(input) {
  if (input === "syne" || input === "redhat") {
    return input;
  }
  return DEFAULT_APP_STATE.menu.editorStyle ?? "syne";
}
function sanitizeViewStyle(input) {
  if (input === "modern" || input === "narrow" || input === "cute" || input === "print") {
    return input;
  }
  return DEFAULT_APP_STATE.menu.viewStyle ?? "modern";
}
function sanitizeEditorFontSize(input) {
  if (input === "xs" || input === "s" || input === "m" || input === "l" || input === "xl") {
    return input;
  }
  return DEFAULT_APP_STATE.menu.editorFontSize ?? "m";
}
function sanitizeEditorSpacing(input) {
  if (input === "tight" || input === "compact" || input === "cozy" || input === "wide") {
    return input;
  }
  return DEFAULT_APP_STATE.menu.editorSpacing ?? "cozy";
}
function sanitizeRatio(input, fallback) {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, input));
}
function sanitizePositive(input, fallback) {
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return input;
}
function sanitizeCollapsedList(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return Array.from(
    new Set(input.filter((value) => typeof value === "string" && value.trim().length > 0))
  );
}
function sanitizeSidebarViewStateEntry(input) {
  return {
    scrollTop: typeof (input == null ? void 0 : input.scrollTop) === "number" && Number.isFinite(input.scrollTop) ? Math.max(0, Math.round(input.scrollTop)) : 0,
    page: typeof (input == null ? void 0 : input.page) === "number" && Number.isFinite(input.page) ? Math.max(1, Math.round(input.page)) : 1,
    collapsedPrimary: sanitizeCollapsedList(input == null ? void 0 : input.collapsedPrimary),
    collapsedSecondary: sanitizeCollapsedList(input == null ? void 0 : input.collapsedSecondary)
  };
}
function sanitizeSidebarViewState(input) {
  return {
    date: sanitizeSidebarViewStateEntry(input == null ? void 0 : input.date),
    category: sanitizeSidebarViewStateEntry(input == null ? void 0 : input.category),
    archive: sanitizeSidebarViewStateEntry(input == null ? void 0 : input.archive),
    trash: sanitizeSidebarViewStateEntry(input == null ? void 0 : input.trash),
    find: sanitizeSidebarViewStateEntry(input == null ? void 0 : input.find)
  };
}
function sanitizeMenu(input) {
  const selectedMonths = Array.isArray(input == null ? void 0 : input.selectedMonths) ? input.selectedMonths.filter((value) => Number.isInteger(value) && value >= 1 && value <= 12) : [];
  const selectedYears = Array.isArray(input == null ? void 0 : input.selectedYears) ? input.selectedYears.filter((value) => value === "older" || Number.isInteger(value)) : [];
  return {
    sidebarMode: sanitizeSidebarMode(input == null ? void 0 : input.sidebarMode),
    selectedMonths,
    selectedYears,
    searchQuery: typeof (input == null ? void 0 : input.searchQuery) === "string" ? input.searchQuery : "",
    documentFindCaseSensitive: Boolean(input == null ? void 0 : input.documentFindCaseSensitive),
    isPreviewMode: Boolean(input == null ? void 0 : input.isPreviewMode),
    viewStyle: sanitizeViewStyle(input == null ? void 0 : input.viewStyle),
    viewFontSize: sanitizeEditorFontSize(input == null ? void 0 : input.viewFontSize),
    viewSpacing: sanitizeEditorSpacing(input == null ? void 0 : input.viewSpacing),
    editorStyle: sanitizeEditorStyle(input == null ? void 0 : input.editorStyle),
    editorFontSize: sanitizeEditorFontSize(input == null ? void 0 : input.editorFontSize),
    editorSpacing: sanitizeEditorSpacing(input == null ? void 0 : input.editorSpacing),
    sidebarWidthRatio: sanitizeRatio(input == null ? void 0 : input.sidebarWidthRatio, DEFAULT_APP_STATE.menu.sidebarWidthRatio),
    tagSplitRatio: sanitizeRatio(input == null ? void 0 : input.tagSplitRatio, DEFAULT_APP_STATE.menu.tagSplitRatio),
    scrollEaseMultiplier: sanitizePositive(input == null ? void 0 : input.scrollEaseMultiplier, DEFAULT_APP_STATE.menu.scrollEaseMultiplier ?? 1),
    scrollDistanceTimeInfluence: sanitizeRatio(input == null ? void 0 : input.scrollDistanceTimeInfluence, DEFAULT_APP_STATE.menu.scrollDistanceTimeInfluence ?? 0),
    scrollBaseDistanceRows: sanitizePositive(input == null ? void 0 : input.scrollBaseDistanceRows, DEFAULT_APP_STATE.menu.scrollBaseDistanceRows ?? 1),
    scrollMaxDurationMultiplier: sanitizePositive(input == null ? void 0 : input.scrollMaxDurationMultiplier, DEFAULT_APP_STATE.menu.scrollMaxDurationMultiplier ?? 1),
    sidebarViewState: sanitizeSidebarViewState(input == null ? void 0 : input.sidebarViewState)
  };
}
async function fileExists(filePath) {
  try {
    await promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
class StateService {
  constructor(dataRoot) {
    __publicField(this, "appStatePath");
    __publicField(this, "windowStatePath");
    this.appStatePath = path.join(dataRoot, APP_STATE_FILE);
    this.windowStatePath = path.join(dataRoot, WINDOW_STATE_FILE);
  }
  async ensureDataRoot() {
    await promises.mkdir(path.dirname(this.appStatePath), { recursive: true });
  }
  async loadAppState() {
    await this.ensureDataRoot();
    if (!await fileExists(this.appStatePath)) {
      return DEFAULT_APP_STATE;
    }
    try {
      const raw = await promises.readFile(this.appStatePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        selectedNoteId: typeof parsed.selectedNoteId === "string" ? parsed.selectedNoteId : null,
        viewport: sanitizeViewport(parsed.viewport),
        menu: sanitizeMenu(parsed.menu)
      };
    } catch {
      return DEFAULT_APP_STATE;
    }
  }
  async saveAppState(state) {
    await this.ensureDataRoot();
    const payload = {
      selectedNoteId: typeof state.selectedNoteId === "string" ? state.selectedNoteId : null,
      viewport: sanitizeViewport(state.viewport),
      menu: sanitizeMenu(state.menu)
    };
    await promises.writeFile(this.appStatePath, JSON.stringify(payload, null, 2), "utf8");
  }
  async loadWindowState() {
    await this.ensureDataRoot();
    if (!await fileExists(this.windowStatePath)) {
      return DEFAULT_WINDOW_STATE;
    }
    try {
      const raw = await promises.readFile(this.windowStatePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        x: typeof parsed.x === "number" ? parsed.x : void 0,
        y: typeof parsed.y === "number" ? parsed.y : void 0,
        width: typeof parsed.width === "number" ? parsed.width : DEFAULT_WINDOW_STATE.width,
        height: typeof parsed.height === "number" ? parsed.height : DEFAULT_WINDOW_STATE.height,
        isMaximized: Boolean(parsed.isMaximized)
      };
    } catch {
      return DEFAULT_WINDOW_STATE;
    }
  }
  async saveWindowState(state) {
    await this.ensureDataRoot();
    const payload = {
      x: typeof state.x === "number" ? state.x : void 0,
      y: typeof state.y === "number" ? state.y : void 0,
      width: Math.max(100, Math.round(state.width)),
      height: Math.max(100, Math.round(state.height)),
      isMaximized: Boolean(state.isMaximized)
    };
    await promises.writeFile(this.windowStatePath, JSON.stringify(payload, null, 2), "utf8");
  }
}
const require$1 = createRequire(import.meta.url);
const BetterSqlite3 = require$1("better-sqlite3");
const DB_FILE_NAME = "measly-notes.db";
const EXTERNAL_TAG = "EXTERNAL";
const PROTECTED_TAGS = ["deleted", "archived", EXTERNAL_TAG];
const META_PREFIX = "<!-- measly-meta:";
const META_SUFFIX = "-->";
function normalizeTagName(rawTag) {
  const normalized = rawTag.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized === "external") {
    return EXTERNAL_TAG;
  }
  return normalized;
}
function uniqueNormalizedTags(tags) {
  return Array.from(new Set(tags.map(normalizeTagName).filter((tag) => tag.length > 0)));
}
function ensureProtectedTagConstraints(tags) {
  const normalized = uniqueNormalizedTags(tags);
  const archived = normalized.includes("archived");
  const deleted = normalized.includes("deleted");
  if (archived && deleted) {
    return normalized.filter((tag) => tag !== "archived");
  }
  return normalized;
}
function withProtectedTagsFirst(tags) {
  const normalized = ensureProtectedTagConstraints(tags);
  const protectedTags = normalized.filter((tag) => PROTECTED_TAGS.includes(tag));
  const regularTags = normalized.filter((tag) => !PROTECTED_TAGS.includes(tag));
  return [...protectedTags, ...regularTags];
}
function hasExternalTag(tags) {
  return tags.includes(EXTERNAL_TAG);
}
function normalizeText(text) {
  return sanitizeDocumentText(text);
}
function checksumText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function titleFromText(text) {
  const lines = normalizeText(text).split("\n");
  const heading = lines.find((line) => line.startsWith("# ") && line.trim().length > 2);
  if (heading) return heading.slice(2).trim();
  const firstContent = lines.find((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && trimmed !== "#";
  });
  return (firstContent == null ? void 0 : firstContent.trim()) ?? "Untitled";
}
function parseIsoToMs(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}
function parseLegacyMetadata(rawText) {
  var _a;
  const normalized = normalizeText(rawText);
  const lines = normalized.split("\n");
  const firstLine = ((_a = lines[0]) == null ? void 0 : _a.trim()) ?? "";
  if (!firstLine.startsWith(META_PREFIX) || !firstLine.endsWith(META_SUFFIX)) {
    return { tags: [], bodyText: normalized, hasLegacyHeader: false };
  }
  const jsonPayload = firstLine.slice(META_PREFIX.length, firstLine.length - META_SUFFIX.length).trim();
  try {
    const parsed = JSON.parse(jsonPayload);
    const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((value) => typeof value === "string").map(normalizeTagName).filter((value) => value.length > 0) : [];
    return {
      tags,
      bodyText: lines.slice(1).join("\n"),
      hasLegacyHeader: true
    };
  } catch {
    return { tags: [], bodyText: normalized, hasLegacyHeader: false };
  }
}
class DatabaseService {
  constructor(dataRoot) {
    __publicField(this, "dataRoot");
    __publicField(this, "notesDir");
    __publicField(this, "dbPath");
    __publicField(this, "db", null);
    this.dataRoot = dataRoot;
    this.notesDir = path.join(dataRoot, "notes");
    this.dbPath = path.join(dataRoot, DB_FILE_NAME);
  }
  async initialize() {
    await promises.mkdir(this.dataRoot, { recursive: true });
    const db = new BetterSqlite3(this.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = NORMAL");
    this.db = db;
    this.ensureSchema();
    this.ensureProtectedTags();
  }
  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }
  getDatabasePath() {
    return this.dbPath;
  }
  async bootstrapFromFilesystem() {
    await promises.mkdir(this.notesDir, { recursive: true });
    const db = this.requireDb();
    const entries = await promises.readdir(this.notesDir, { withFileTypes: true });
    const fileNames = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md")).map((entry) => entry.name);
    const syncedRows = [];
    const existingRows = db.prepare(`
      SELECT nt.noteId AS noteId, t.name AS tagName
      FROM note_tags nt
      JOIN tags t ON nt.tagId = t.id
      ORDER BY nt.noteId ASC, nt.position ASC
    `).all();
    const existingTagsByNoteId = /* @__PURE__ */ new Map();
    for (const row of existingRows) {
      if (!existingTagsByNoteId.has(row.noteId)) {
        existingTagsByNoteId.set(row.noteId, []);
      }
      existingTagsByNoteId.get(row.noteId).push(row.tagName);
    }
    for (const fileName of fileNames) {
      const filePath = path.join(this.notesDir, fileName);
      const [stat, rawText] = await Promise.all([
        promises.stat(filePath),
        promises.readFile(filePath, "utf8")
      ]);
      const parsed = parseLegacyMetadata(rawText);
      const id = fileName.replace(/\.md$/i, "");
      syncedRows.push({
        id,
        title: titleFromText(parsed.bodyText),
        filePath,
        text: parsed.bodyText,
        tags: parsed.hasLegacyHeader ? withProtectedTagsFirst(parsed.tags) : withProtectedTagsFirst(existingTagsByNoteId.get(id) ?? []),
        createdAtMs: stat.birthtimeMs || stat.mtimeMs,
        updatedAtMs: stat.mtimeMs
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
    const deleteMissingNotesStmt = db.prepare("DELETE FROM notes WHERE id = ?");
    const deleteNoteTagsStmt = db.prepare("DELETE FROM note_tags WHERE noteId = ?");
    const insertNoteTagStmt = db.prepare("INSERT OR REPLACE INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)");
    const selectAllNoteIdsStmt = db.prepare("SELECT id FROM notes");
    const findTagStmt = db.prepare("SELECT id FROM tags WHERE name = ?");
    const insertTagStmt = db.prepare("INSERT INTO tags (name) VALUES (?)");
    const upsertFtsStmt = db.prepare("INSERT OR REPLACE INTO notes_fts (noteId, title, content) VALUES (?, ?, ?)");
    const deleteMissingFtsStmt = db.prepare("DELETE FROM notes_fts WHERE noteId = ?");
    const toIso = (timestampMs) => new Date(timestampMs).toISOString();
    const getOrCreateTagId = (tagNameRaw) => {
      const tagName = normalizeTagName(tagNameRaw);
      if (!tagName) {
        throw new Error("Cannot create empty tag");
      }
      const existing = findTagStmt.get(tagName);
      if (existing) return existing.id;
      const created = insertTagStmt.run(tagName);
      return Number(created.lastInsertRowid);
    };
    const seenIds = /* @__PURE__ */ new Set();
    const tx = db.transaction((rows) => {
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
          checksumText(row.text)
        );
        deleteNoteTagsStmt.run(row.id);
        row.tags.forEach((tagName, position) => {
          const tagId = getOrCreateTagId(tagName);
          insertNoteTagStmt.run(row.id, tagId, position);
        });
        seenIds.add(row.id);
      }
      const existingIds = selectAllNoteIdsStmt.all();
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
  runSanityChecks() {
    const db = this.requireDb();
    const missingNoteFiles = [];
    const orphanedTagRows = Number(db.prepare(`
      SELECT COUNT(*) AS c
      FROM note_tags nt
      LEFT JOIN notes n ON n.id = nt.noteId
      LEFT JOIN tags t ON t.id = nt.tagId
      WHERE n.id IS NULL OR t.id IS NULL
    `).get().c);
    const normalizedTagOrderCount = this.normalizeAllTagPositions();
    const fsRows = db.prepare("SELECT id, filePath FROM notes").all();
    for (const row of fsRows) {
      try {
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
      orphanedTagRows
    };
  }
  upsertNoteContent(input) {
    const db = this.requireDb();
    const createdAtIso = new Date(input.createdAtMs).toISOString();
    const updatedAtIso = new Date(input.updatedAtMs).toISOString();
    const normalizedText = normalizeText(input.text);
    const contentChecksum = checksumText(normalizedText);
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
    `).run(
      input.id,
      input.title,
      input.filePath,
      createdAtIso,
      updatedAtIso,
      updatedAtIso,
      contentChecksum
    );
    db.prepare("INSERT OR REPLACE INTO notes_fts (noteId, title, content) VALUES (?, ?, ?)").run(input.id, input.title, normalizedText);
  }
  listNoteRecords() {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT id, title, filePath, createdAt, updatedAt, contentChecksum, isTemp, externalPath, hasUnsavedChanges, syncMode
      FROM notes
      ORDER BY datetime(updatedAt) DESC
    `).all();
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
      syncMode: Boolean(row.syncMode)
    }));
  }
  getNoteRecord(noteId) {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT id, title, filePath, createdAt, updatedAt, contentChecksum, isTemp, externalPath, hasUnsavedChanges, syncMode
      FROM notes
      WHERE id = ?
      LIMIT 1
    `).get(noteId);
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
      syncMode: Boolean(row.syncMode)
    };
  }
  getNoteContentSnapshot(noteId) {
    const db = this.requireDb();
    const row = db.prepare("SELECT content FROM notes_fts WHERE noteId = ?").get(noteId);
    return (row == null ? void 0 : row.content) ?? null;
  }
  getExternalSyncState(noteId) {
    const record = this.getNoteRecord(noteId);
    if (!(record == null ? void 0 : record.isTemp)) {
      return {
        isExternal: false,
        hasUnsavedChanges: false,
        isInSync: true
      };
    }
    return {
      isExternal: true,
      hasUnsavedChanges: record.hasUnsavedChanges,
      isInSync: record.syncMode && !record.hasUnsavedChanges
    };
  }
  deleteNote(id) {
    const db = this.requireDb();
    db.prepare("DELETE FROM notes WHERE id = ?").run(id);
    db.prepare("DELETE FROM notes_fts WHERE noteId = ?").run(id);
  }
  getNoteTags(noteId) {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT t.name
      FROM note_tags nt
      JOIN tags t ON nt.tagId = t.id
      WHERE nt.noteId = ?
      ORDER BY nt.position ASC
    `).all(noteId);
    return rows.map((row) => row.name);
  }
  addTagToNote(noteId, rawTagName, position) {
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
    if (PROTECTED_TAGS.includes(normalizedTag)) {
      next = [
        normalizedTag,
        ...withoutDup.filter((tag) => !PROTECTED_TAGS.includes(tag))
      ];
    }
    const finalTags = withProtectedTagsFirst(next);
    this.writeNoteTags(noteId, finalTags);
    return finalTags;
  }
  removeTagFromNote(noteId, rawTagName) {
    const normalizedTag = normalizeTagName(rawTagName);
    const current = this.getNoteTags(noteId);
    if (hasExternalTag(current) && normalizedTag !== EXTERNAL_TAG) {
      return current;
    }
    const finalTags = withProtectedTagsFirst(current.filter((tag) => tag !== normalizedTag));
    this.writeNoteTags(noteId, finalTags);
    return finalTags;
  }
  reorderNoteTags(noteId, requestedTagNames) {
    const current = this.getNoteTags(noteId);
    if (hasExternalTag(current)) {
      return current;
    }
    const requested = uniqueNormalizedTags(requestedTagNames);
    const merged = [];
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
  renameTag(input) {
    const db = this.requireDb();
    const fromName = normalizeTagName(input.fromName);
    const toName = normalizeTagName(input.toName);
    if (!fromName || !toName || fromName === toName) {
      return { updatedNoteIds: [] };
    }
    if (PROTECTED_TAGS.includes(fromName)) {
      throw new Error("This tag is protected and cannot be renamed");
    }
    const existingTag = db.prepare("SELECT id FROM tags WHERE name = ?").get(fromName);
    if (!existingTag) {
      return { updatedNoteIds: [] };
    }
    const updatedNoteIds = db.prepare("SELECT noteId FROM note_tags WHERE tagId = ?").all(existingTag.id);
    const conflict = db.prepare("SELECT id FROM tags WHERE name = ?").get(toName);
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
        db.prepare("DELETE FROM note_tags WHERE tagId = ?").run(existingTag.id);
        db.prepare("DELETE FROM tags WHERE id = ?").run(existingTag.id);
      } else {
        db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(toName, existingTag.id);
      }
    });
    tx();
    return { updatedNoteIds: updatedNoteIds.map((row) => row.noteId) };
  }
  listTags() {
    const db = this.requireDb();
    return db.prepare(`
      SELECT t.name AS name, COUNT(nt.noteId) AS usageCount
      FROM tags t
      LEFT JOIN note_tags nt ON t.id = nt.tagId
      GROUP BY t.id, t.name
      HAVING usageCount > 0 OR t.name IN ('deleted', 'archived', 'EXTERNAL')
      ORDER BY usageCount DESC, t.name ASC
    `).all();
  }
  getLastEditedNoteId() {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT id
      FROM notes
      WHERE lastEdited IS NOT NULL
      ORDER BY datetime(lastEdited) DESC
      LIMIT 1
    `).get();
    return (row == null ? void 0 : row.id) ?? null;
  }
  getTrashNoteIds() {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT n.id AS id
      FROM notes n
      JOIN note_tags nt ON n.id = nt.noteId
      JOIN tags t ON nt.tagId = t.id
      WHERE LOWER(t.name) = 'deleted'
      ORDER BY datetime(n.lastEdited) DESC, datetime(n.updatedAt) DESC
    `).all();
    return rows.map((row) => row.id);
  }
  searchNoteIdsByTag(tagQuery) {
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
    `).all(`%${normalized}%`);
    return rows.map((row) => row.id);
  }
  saveNoteUiState(noteId, payload) {
    const db = this.requireDb();
    const hasProgressPreview = Object.prototype.hasOwnProperty.call(payload, "progressPreview");
    const hasProgressEdit = Object.prototype.hasOwnProperty.call(payload, "progressEdit");
    const hasCursorPos = Object.prototype.hasOwnProperty.call(payload, "cursorPos");
    const hasScrollTop = Object.prototype.hasOwnProperty.call(payload, "scrollTop");
    db.prepare(`
      UPDATE notes
      SET
        progressPreview = CASE WHEN ? THEN ? ELSE progressPreview END,
        progressEdit = CASE WHEN ? THEN ? ELSE progressEdit END,
        cursorPos = CASE WHEN ? THEN ? ELSE cursorPos END,
        scrollTop = CASE WHEN ? THEN ? ELSE scrollTop END
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
      noteId
    );
  }
  getNoteUiState(noteId) {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT progressPreview, progressEdit, cursorPos, scrollTop
      FROM notes
      WHERE id = ?
    `).get(noteId);
    return {
      progressPreview: (row == null ? void 0 : row.progressPreview) ?? null,
      progressEdit: (row == null ? void 0 : row.progressEdit) ?? null,
      cursorPos: (row == null ? void 0 : row.cursorPos) ?? null,
      scrollTop: (row == null ? void 0 : row.scrollTop) ?? null
    };
  }
  saveNoteSnapshot(noteId, content, isManual = false) {
    const db = this.requireDb();
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(`
      INSERT INTO note_snapshots (noteId, content, timestamp, isManual)
      VALUES (?, ?, ?, ?)
    `).run(noteId, content, timestamp, isManual ? 1 : 0);
  }
  getNoteSnapshots(noteId) {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT id, noteId, content, timestamp, isManual
      FROM note_snapshots
      WHERE noteId = ?
      ORDER BY datetime(timestamp) DESC
    `).all(noteId);
    return rows.map((row) => ({
      id: row.id,
      noteId: row.noteId,
      content: row.content,
      timestamp: row.timestamp,
      isManual: Boolean(row.isManual)
    }));
  }
  deleteNoteSnapshot(snapshotId) {
    const db = this.requireDb();
    db.prepare("DELETE FROM note_snapshots WHERE id = ?").run(snapshotId);
  }
  createTempNote(input) {
    const db = this.requireDb();
    const id = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
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
      input.originalEncoding ?? null
    );
    const tempTagId = this.getOrCreateTagId(EXTERNAL_TAG);
    this.writeTagRelations(id, [tempTagId]);
    return id;
  }
  updateTempNoteState(noteId, hasUnsavedChanges, syncMode) {
    const db = this.requireDb();
    db.prepare(`
      UPDATE notes
      SET hasUnsavedChanges = ?, syncMode = ?, updatedAt = ?
      WHERE id = ? AND isTemp = 1
    `).run(hasUnsavedChanges ? 1 : 0, syncMode ? 1 : 0, (/* @__PURE__ */ new Date()).toISOString(), noteId);
  }
  convertTempNoteToRegular(noteId, newFilePath) {
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
    `).run(newFilePath, (/* @__PURE__ */ new Date()).toISOString(), noteId);
    const tempTagId = this.findTagIdByName(EXTERNAL_TAG);
    if (tempTagId !== null) {
      const dbRows = db.prepare("SELECT tagId FROM note_tags WHERE noteId = ? ORDER BY position ASC").all(noteId);
      const filtered = dbRows.map((row) => row.tagId).filter((tagId) => tagId !== tempTagId);
      this.writeTagRelations(noteId, filtered);
    }
  }
  markExternalNoteSynced(noteId) {
    const db = this.requireDb();
    db.prepare(`
      UPDATE notes
      SET hasUnsavedChanges = 0, syncMode = 1, updatedAt = ?
      WHERE id = ? AND isTemp = 1
    `).run((/* @__PURE__ */ new Date()).toISOString(), noteId);
  }
  getTempNoteIds() {
    const db = this.requireDb();
    const rows = db.prepare("SELECT id FROM notes WHERE isTemp = 1 ORDER BY datetime(lastEdited) DESC").all();
    return rows.map((row) => row.id);
  }
  getTempNoteIdByExternalPath(externalPath) {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT id
      FROM notes
      WHERE isTemp = 1 AND externalPath = ?
      ORDER BY datetime(updatedAt) DESC
      LIMIT 1
    `).get(externalPath);
    return (row == null ? void 0 : row.id) ?? null;
  }
  deleteTempNote(noteId) {
    const db = this.requireDb();
    db.prepare("DELETE FROM notes WHERE id = ? AND isTemp = 1").run(noteId);
    db.prepare("DELETE FROM notes_fts WHERE noteId = ?").run(noteId);
  }
  ensureSchema() {
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
    `);
    this.ensureNotesColumn("contentChecksum", "TEXT");
  }
  ensureNotesColumn(columnName, columnDefinition) {
    const db = this.requireDb();
    const columns = db.prepare("PRAGMA table_info(notes)").all();
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    db.exec(`ALTER TABLE notes ADD COLUMN ${columnName} ${columnDefinition}`);
  }
  ensureProtectedTags() {
    const db = this.requireDb();
    const findTagStmt = db.prepare("SELECT id FROM tags WHERE name = ?");
    const insertTagStmt = db.prepare("INSERT INTO tags (name) VALUES (?)");
    const tx = db.transaction(() => {
      for (const tagName of PROTECTED_TAGS) {
        const existing = findTagStmt.get(tagName);
        if (existing) continue;
        insertTagStmt.run(tagName);
      }
    });
    tx();
  }
  normalizeAllTagPositions() {
    const db = this.requireDb();
    const noteIds = db.prepare("SELECT id FROM notes").all();
    const selectTagsForNoteStmt = db.prepare("SELECT tagId FROM note_tags WHERE noteId = ? ORDER BY position ASC, tagId ASC");
    const updatePosStmt = db.prepare("UPDATE note_tags SET position = ? WHERE noteId = ? AND tagId = ?");
    let touchedCount = 0;
    const tx = db.transaction(() => {
      for (const { id } of noteIds) {
        const rows = selectTagsForNoteStmt.all(id);
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
  writeNoteTags(noteId, orderedTags) {
    const db = this.requireDb();
    const findTagStmt = db.prepare("SELECT id FROM tags WHERE name = ?");
    const insertTagStmt = db.prepare("INSERT INTO tags (name) VALUES (?)");
    const deleteNoteTagsStmt = db.prepare("DELETE FROM note_tags WHERE noteId = ?");
    const insertNoteTagStmt = db.prepare("INSERT OR REPLACE INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)");
    const getOrCreateTagId = (tagNameRaw) => {
      const tagName = normalizeTagName(tagNameRaw);
      const existing = findTagStmt.get(tagName);
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
  findTagIdByName(tagNameRaw) {
    const db = this.requireDb();
    const tagName = normalizeTagName(tagNameRaw);
    const row = db.prepare("SELECT id FROM tags WHERE name = ?").get(tagName);
    return (row == null ? void 0 : row.id) ?? null;
  }
  getOrCreateTagId(tagNameRaw) {
    const db = this.requireDb();
    const tagName = normalizeTagName(tagNameRaw);
    const existing = db.prepare("SELECT id FROM tags WHERE name = ?").get(tagName);
    if (existing) return existing.id;
    const created = db.prepare("INSERT INTO tags (name) VALUES (?)").run(tagName);
    return Number(created.lastInsertRowid);
  }
  writeTagRelations(noteId, orderedTagIds) {
    const db = this.requireDb();
    const deleteStmt = db.prepare("DELETE FROM note_tags WHERE noteId = ?");
    const insertStmt = db.prepare("INSERT OR REPLACE INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)");
    const tx = db.transaction(() => {
      deleteStmt.run(noteId);
      orderedTagIds.forEach((tagId, position) => {
        insertStmt.run(noteId, tagId, position);
      });
    });
    tx();
  }
  requireDb() {
    if (!this.db) {
      throw new Error("DatabaseService is not initialized");
    }
    return this.db;
  }
}
const EXTERNAL_FILE_CHANNELS = {
  getPendingPaths: "external-files:get-pending-paths",
  readContent: "external-files:read-content",
  writeContent: "external-files:write-content",
  basename: "external-files:basename",
  opened: "external-files:opened"
};
const LEGACY_DB_CHANNELS = {
  getLastEditedNoteId: "legacy-db:get-last-edited-note-id",
  getTrashNoteIds: "legacy-db:get-trash-note-ids",
  searchNoteIdsByTag: "legacy-db:search-note-ids-by-tag",
  saveNoteUiState: "legacy-db:save-note-ui-state",
  getNoteUiState: "legacy-db:get-note-ui-state",
  saveNoteSnapshot: "legacy-db:save-note-snapshot",
  getNoteSnapshots: "legacy-db:get-note-snapshots",
  deleteNoteSnapshot: "legacy-db:delete-note-snapshot",
  createTempNote: "legacy-db:create-temp-note",
  updateTempNoteState: "legacy-db:update-temp-note-state",
  convertTempNoteToRegular: "legacy-db:convert-temp-note-to-regular",
  getTempNoteIds: "legacy-db:get-temp-note-ids",
  getTempNoteIdByExternalPath: "legacy-db:get-temp-note-id-by-external-path",
  syncExternalNoteToFile: "legacy-db:sync-external-note-to-file",
  getExternalSyncState: "legacy-db:get-external-sync-state",
  deleteTempNote: "legacy-db:delete-temp-note"
};
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
let noteLifecycleService = null;
let stateService = null;
let databaseService = null;
let pendingExternalFilePaths = [];
const OPENABLE_EXTENSIONS = /* @__PURE__ */ new Set([".md", ".txt"]);
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}
function isOpenableExternalFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return OPENABLE_EXTENSIONS.has(ext) && existsSync(filePath);
}
function extractOpenablePaths(argv) {
  return argv.map((value) => value.replace(/^"|"$/g, "")).filter((value) => value.length > 0).filter((value) => path.isAbsolute(value)).filter((value) => isOpenableExternalFile(value));
}
function enqueueExternalFilePaths(filePaths) {
  const seen = new Set(pendingExternalFilePaths);
  for (const filePath of filePaths) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    pendingExternalFilePaths.push(filePath);
  }
}
function flushPendingExternalPathsToRenderer() {
  if (!win || win.isDestroyed()) return;
  if (pendingExternalFilePaths.length === 0) return;
  const paths = [...pendingExternalFilePaths];
  pendingExternalFilePaths = [];
  for (const filePath of paths) {
    win.webContents.send(EXTERNAL_FILE_CHANNELS.opened, filePath);
  }
}
function resolveDataRoot() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "data");
  }
  return path.join(process.env.APP_ROOT, "data");
}
function registerIpcHandlers() {
  if (!databaseService) {
    databaseService = new DatabaseService(resolveDataRoot());
  }
  if (!noteLifecycleService) {
    noteLifecycleService = new NoteLifecycleService(resolveDataRoot(), databaseService);
  }
  if (!stateService) {
    stateService = new StateService(resolveDataRoot());
  }
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.list, async () => noteLifecycleService.listNotes());
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.load, async (_event, input) => noteLifecycleService.loadNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.create, async (_event, input) => noteLifecycleService.createNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.save, async (_event, input) => noteLifecycleService.saveNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.remove, async (_event, input) => noteLifecycleService.deleteNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.getNoteTags, async (_event, input) => noteLifecycleService.getNoteTags(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.addTag, async (_event, input) => noteLifecycleService.addTagToNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.removeTag, async (_event, input) => noteLifecycleService.removeTagFromNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.reorderTags, async (_event, input) => noteLifecycleService.reorderNoteTags(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.renameTag, async (_event, input) => noteLifecycleService.renameTag(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.listTags, async () => noteLifecycleService.listTags());
  ipcMain.handle(APP_STATE_CHANNELS.loadAppState, async () => stateService.loadAppState());
  ipcMain.handle(APP_STATE_CHANNELS.saveAppState, async (_event, payload) => stateService.saveAppState(payload));
  ipcMain.handle(APP_STATE_CHANNELS.loadWindowState, async () => stateService.loadWindowState());
  ipcMain.handle(APP_STATE_CHANNELS.saveWindowState, async (_event, payload) => stateService.saveWindowState(payload));
  ipcMain.handle(EXTERNAL_FILE_CHANNELS.getPendingPaths, async () => {
    const paths = [...pendingExternalFilePaths];
    pendingExternalFilePaths = [];
    return paths;
  });
  ipcMain.handle(EXTERNAL_FILE_CHANNELS.readContent, async (_event, filePath) => {
    if (typeof filePath !== "string" || !isOpenableExternalFile(filePath)) return null;
    try {
      return readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  });
  ipcMain.handle(EXTERNAL_FILE_CHANNELS.writeContent, async (_event, filePath, content) => {
    if (typeof filePath !== "string" || typeof content !== "string") return false;
    if (!isOpenableExternalFile(filePath)) return false;
    try {
      writeFileSync(filePath, content, "utf8");
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle(EXTERNAL_FILE_CHANNELS.basename, async (_event, filePath) => {
    if (typeof filePath !== "string") return "";
    try {
      return path.basename(filePath);
    } catch {
      return "";
    }
  });
  ipcMain.handle(LEGACY_DB_CHANNELS.getLastEditedNoteId, async () => databaseService.getLastEditedNoteId());
  ipcMain.handle(LEGACY_DB_CHANNELS.getTrashNoteIds, async () => databaseService.getTrashNoteIds());
  ipcMain.handle(
    LEGACY_DB_CHANNELS.searchNoteIdsByTag,
    async (_event, tagQuery) => databaseService.searchNoteIdsByTag(tagQuery)
  );
  ipcMain.handle(LEGACY_DB_CHANNELS.saveNoteUiState, async (_event, noteId, payload) => {
    databaseService.saveNoteUiState(noteId, payload ?? {});
  });
  ipcMain.handle(
    LEGACY_DB_CHANNELS.getNoteUiState,
    async (_event, noteId) => databaseService.getNoteUiState(noteId)
  );
  ipcMain.handle(LEGACY_DB_CHANNELS.saveNoteSnapshot, async (_event, noteId, content, isManual) => {
    databaseService.saveNoteSnapshot(noteId, content, Boolean(isManual));
  });
  ipcMain.handle(
    LEGACY_DB_CHANNELS.getNoteSnapshots,
    async (_event, noteId) => databaseService.getNoteSnapshots(noteId)
  );
  ipcMain.handle(LEGACY_DB_CHANNELS.deleteNoteSnapshot, async (_event, snapshotId) => {
    databaseService.deleteNoteSnapshot(snapshotId);
  });
  ipcMain.handle(
    LEGACY_DB_CHANNELS.createTempNote,
    async (_event, title, externalPath, originalEncoding) => databaseService.createTempNote({ title, externalPath, originalEncoding })
  );
  ipcMain.handle(LEGACY_DB_CHANNELS.updateTempNoteState, async (_event, noteId, hasUnsavedChanges, syncMode) => {
    databaseService.updateTempNoteState(noteId, hasUnsavedChanges, syncMode);
  });
  ipcMain.handle(LEGACY_DB_CHANNELS.convertTempNoteToRegular, async (_event, noteId, newFilePath) => {
    databaseService.convertTempNoteToRegular(noteId, newFilePath);
  });
  ipcMain.handle(LEGACY_DB_CHANNELS.getTempNoteIds, async () => databaseService.getTempNoteIds());
  ipcMain.handle(
    LEGACY_DB_CHANNELS.getTempNoteIdByExternalPath,
    async (_event, externalPath) => databaseService.getTempNoteIdByExternalPath(externalPath)
  );
  ipcMain.handle(
    LEGACY_DB_CHANNELS.getExternalSyncState,
    async (_event, noteId) => databaseService.getExternalSyncState(noteId)
  );
  ipcMain.handle(LEGACY_DB_CHANNELS.syncExternalNoteToFile, async (_event, noteId) => {
    const record = databaseService.getNoteRecord(noteId);
    if (!(record == null ? void 0 : record.isTemp) || !record.externalPath) {
      return false;
    }
    const content = databaseService.getNoteContentSnapshot(noteId);
    if (content === null) {
      return false;
    }
    try {
      writeFileSync(record.externalPath, content, "utf8");
      databaseService.markExternalNoteSynced(noteId);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle(LEGACY_DB_CHANNELS.deleteTempNote, async (_event, noteId) => {
    databaseService.deleteTempNote(noteId);
  });
}
function readCurrentWindowState(windowRef) {
  const bounds = windowRef.getBounds();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: windowRef.isMaximized()
  };
}
async function createWindow() {
  if (!stateService) {
    stateService = new StateService(resolveDataRoot());
  }
  const savedWindowState = await stateService.loadWindowState();
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    width: savedWindowState.width,
    height: savedWindowState.height,
    x: savedWindowState.x,
    y: savedWindowState.y,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  if (savedWindowState.isMaximized) {
    win.maximize();
  }
  const persistWindowState = () => {
    if (!win || !stateService) return;
    void stateService.saveWindowState(readCurrentWindowState(win));
  };
  win.on("resize", persistWindowState);
  win.on("move", persistWindowState);
  win.on("maximize", persistWindowState);
  win.on("unmaximize", persistWindowState);
  win.on("close", persistWindowState);
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
    flushPendingExternalPathsToRenderer();
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
app.on("second-instance", (_event, argv) => {
  const paths = extractOpenablePaths(argv);
  enqueueExternalFilePaths(paths);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) {
      win.restore();
    }
    win.focus();
    flushPendingExternalPathsToRenderer();
  }
});
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (!isOpenableExternalFile(filePath)) return;
  enqueueExternalFilePaths([filePath]);
  flushPendingExternalPathsToRenderer();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
app.whenReady().then(async () => {
  enqueueExternalFilePaths(extractOpenablePaths(process.argv));
  if (!databaseService) {
    databaseService = new DatabaseService(resolveDataRoot());
  }
  await databaseService.initialize();
  await databaseService.bootstrapFromFilesystem();
  const sanity = databaseService.runSanityChecks();
  if (sanity.missingNoteFiles.length > 0 || sanity.orphanedTagRows > 0) {
    console.warn("[db] startup sanity issues", sanity);
  }
  registerIpcHandlers();
  await createWindow();
}).catch((error) => {
  console.error("[main] fatal startup failure", error);
  app.quit();
});
app.on("before-quit", () => {
  databaseService == null ? void 0 : databaseService.close();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
