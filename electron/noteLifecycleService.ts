import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AddTagInput,
  BranchNoteFromSnapshotInput,
  CreateNoteInput,
  DeleteNoteInput,
  DeleteNoteSnapshotInput,
  LoadNoteInput,
  NoteDocument,
  NoteSummary,
  NoteUiState,
  NoteUiStatePayload,
  ReorderTagsInput,
  RemoveTagInput,
  RenameTagInput,
  SaveNoteInput,
  TagSummary,
} from '../src/shared/noteLifecycle';
import { sanitizeDocumentText, truncateTitle } from '../src/shared/textSanitization';
import { normalizeChapterHeadings } from '../src/shared/markdownHeadings';
import { computeHeadingAnchors, formatHeadingAnchorFragment, formatOutlineEntryLine, headingsChanged } from '../src/shared/tableOfContentsText';
import { assembleOpenItemsText, buildOpenItemsGroupMarkdown, checklistStateChanged, parseOpenItemsGroups } from '../src/shared/openItemsText';
import { resolveIdentityLabel } from '../src/shared/tabLabels';
import { formatInternalNoteLink } from '../src/shared/internalNoteLinks';
import type { ChapterEntry, DatabaseService, NoteRecord } from './databaseService';

const NOTES_DIR_NAME = 'notes';
const META_PREFIX = '<!-- thockdown-meta:';
const META_SUFFIX = '-->';
const EXTERNAL_TAG = 'EXTERNAL';

type ParsedNoteMetadata = {
  bodyText: string;
};

function normalizeText(text: string): string {
  return sanitizeDocumentText(text);
}

function normalizeLineEndingsOnly(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n');
}

function checksumText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function titleFromText(text: string): string {
  const lines = normalizeText(text).split('\n');
  // Level 1 only -- a chapter's own first-line heading is always level 2
  // (see markdownHeadings.ts's normalizeChapterHeadings/clampHeadlineLevels
  // with CHAPTER_HEADLINE_LEVEL_RULE) and deliberately does NOT count: chapters
  // have no "title" concept at all, only a chapterId, user-assigned or else
  // never persisted (see tabLabels.ts's resolveIdentityLabel for the actual
  // chapter-identity logic; nothing chapter-facing should read `.title`).
  const heading = lines.find((line) => line.startsWith('# ') && line.trim().length > 2);
  if (heading) return truncateTitle(heading.slice(2).trim());

  const firstContent = lines.find((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && trimmed !== '#';
  });
  return truncateTitle(firstContent?.trim() ?? 'Untitled');
}

function parseNoteMetadata(rawText: string, sanitize: boolean): ParsedNoteMetadata {
  const normalized = sanitize ? normalizeText(rawText) : normalizeLineEndingsOnly(rawText);
  const lines = normalized.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  if (!firstLine.startsWith(META_PREFIX) || !firstLine.endsWith(META_SUFFIX)) {
    return { bodyText: normalized };
  }

  const jsonPayload = firstLine.slice(META_PREFIX.length, firstLine.length - META_SUFFIX.length).trim();

  try {
    JSON.parse(jsonPayload);

    return {
      bodyText: lines.slice(1).join('\n'),
    };
  } catch {
    return { bodyText: normalized };
  }
}

function isExternalTag(tagName: string): boolean {
  return tagName.trim().toLowerCase() === 'external';
}

function idToFileName(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${safe}.md`;
}

function buildNoteId(now: Date): string {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const suffix = randomBytes(5).toString('base64url').toUpperCase();
  return `${yy}-${mm}-${dd}_${hh}-${min}_${suffix}`;
}

// "yy-mm-dd hh:mm" label for the snapshot moment a branch was created from.
function formatBranchLabel(when: Date): string {
  const yy = String(when.getFullYear()).slice(-2);
  const mm = String(when.getMonth() + 1).padStart(2, '0');
  const dd = String(when.getDate()).padStart(2, '0');
  const hh = String(when.getHours()).padStart(2, '0');
  const min = String(when.getMinutes()).padStart(2, '0');
  return `${yy}-${mm}-${dd} ${hh}:${min}`;
}

// Branching a branch shouldn't stack "[Branch: ...] [Branch: ...]" suffixes
// onto the title indefinitely -- strip a trailing one before appending a new one.
const TRAILING_BRANCH_SUFFIX_RE = / \[Branch: \d{2}-\d{2}-\d{2} \d{2}:\d{2}\]$/;
function stripExistingBranchSuffix(title: string): string {
  return title.replace(TRAILING_BRANCH_SUFFIX_RE, '');
}

export class NoteLifecycleService {
  private readonly notesDir: string;
  private readonly databaseService: DatabaseService;
  constructor(dataRoot: string, databaseService: DatabaseService) {
    this.notesDir = path.join(dataRoot, NOTES_DIR_NAME);
    this.databaseService = databaseService;
  }

  private async ensureNotesDir(): Promise<void> {
    await fs.mkdir(this.notesDir, { recursive: true });
  }

  private notePathFromId(id: string): { fileName: string; filePath: string } {
    const fileName = idToFileName(id);
    return {
      fileName,
      filePath: path.join(this.notesDir, fileName),
    };
  }

  private async readSummary(record: NoteRecord): Promise<NoteSummary | null> {
    try {
      const text = record.isTemp
        ? (this.databaseService.getNoteContentSnapshot(record.id) ?? '')
        : await fs.readFile(record.filePath, 'utf8');

      const stat = record.isTemp
        ? {
            birthtimeMs: record.createdAtMs,
            mtimeMs: record.updatedAtMs,
            size: Buffer.byteLength(text, 'utf8'),
          }
        : await fs.stat(record.filePath);

      const parsed = parseNoteMetadata(text, true);
      const fileName = path.basename(record.filePath);

      const tags = this.databaseService.getNoteTags(record.id);
      return {
        id: record.id,
        fileName,
        title: titleFromText(parsed.bodyText),
        tags,
        contentText: parsed.bodyText,
        createdAtMs: stat.birthtimeMs || record.createdAtMs,
        updatedAtMs: stat.mtimeMs,
        sizeBytes: stat.size,
        isExternal: tags.includes(EXTERNAL_TAG),
        externalPath: record.externalPath ?? (record.isTemp ? record.filePath : null) ?? null,
        hasUnsavedChanges: record.hasUnsavedChanges,
        isInSync: Boolean(record.syncMode && !record.hasUnsavedChanges),
        assignedId: record.assignedId,
        chapterOnly: record.chapterOnly,
        isAutoToc: record.isAutoToc,
        isAutoOpenItems: record.isAutoOpenItems,
        chapterParentId: record.chapterParentId,
      };
    } catch {
      return null;
    }
  }

  async listNotes(): Promise<NoteSummary[]> {
    const records = this.databaseService.listNoteRecords();
    const summaries = await Promise.all(records.map((record) => this.readSummary(record)));

    return summaries
      .filter((summary): summary is NoteSummary => summary !== null)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  async loadNote(input: LoadNoteInput): Promise<NoteDocument> {
    const record = this.databaseService.getNoteRecord(input.id);
    const filePath = record?.filePath ?? path.join(this.notesDir, idToFileName(input.id));
    const fileName = path.basename(filePath);
    let rawText: string
    if (record?.isTemp) {
      const snapshotText = this.databaseService.getNoteContentSnapshot(input.id)
      if (snapshotText !== null) {
        rawText = snapshotText
      } else if (record.externalPath) {
        rawText = await fs.readFile(record.externalPath, 'utf8')
      } else {
        rawText = ''
      }
    } else {
      rawText = await fs.readFile(filePath, 'utf8')
    }

    const stat = record?.isTemp
      ? {
          birthtimeMs: record.createdAtMs,
          mtimeMs: record.updatedAtMs,
          size: Buffer.byteLength(rawText, 'utf8'),
        }
      : await fs.stat(filePath);

    let text = rawText;
    let shouldSanitize = true;

    // External/temp notes are always full-pass sanitized.
    if (!record?.isTemp) {
      const storedChecksum = record?.contentChecksum;
      const currentChecksum = checksumText(rawText);
      // Trusted fast path for internal notes: unchanged content bypasses sanitizer.
      shouldSanitize = !(storedChecksum && storedChecksum === currentChecksum);
    }

    if (shouldSanitize) {
      const sanitizedText = normalizeText(rawText);
      text = sanitizedText;

      if (record?.isTemp) {
        const sanitizedTitle = titleFromText(sanitizedText);
        const shouldUpdateTempNote =
          sanitizedText !== rawText ||
          sanitizedTitle !== record.title;

        if (shouldUpdateTempNote) {
          this.databaseService.upsertNoteContent({
            id: input.id,
            title: sanitizedTitle,
            filePath,
            text: sanitizedText,
            createdAtMs: record.createdAtMs,
            updatedAtMs: Date.now(),
            isTemp: true,
            hasUnsavedChanges: record.hasUnsavedChanges,
            syncMode: record.syncMode,
          });
        }
      } else {
        if (sanitizedText !== rawText) {
          await fs.writeFile(filePath, sanitizedText, 'utf8');
        }

        this.databaseService.upsertNoteContent({
          id: input.id,
          title: titleFromText(sanitizedText),
          filePath,
          text: sanitizedText,
          createdAtMs: stat.birthtimeMs || record?.createdAtMs || stat.mtimeMs,
          updatedAtMs: stat.mtimeMs,
        });
      }
    }

    const parsed = parseNoteMetadata(text, shouldSanitize);

    const tags = this.databaseService.getNoteTags(input.id);

    return {
      id: input.id,
      fileName,
      title: titleFromText(parsed.bodyText),
      tags,
      contentText: parsed.bodyText,
      createdAtMs: stat.birthtimeMs || record?.createdAtMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      text: parsed.bodyText,
      isExternal: tags.includes(EXTERNAL_TAG),
      externalPath: record?.externalPath ?? (record?.isTemp ? record.filePath : null) ?? null,
      hasUnsavedChanges: record?.hasUnsavedChanges ?? false,
      isInSync: Boolean(record?.syncMode && !record?.hasUnsavedChanges),
      chapterOnly: record?.chapterOnly ?? false,
      isAutoToc: record?.isAutoToc ?? false,
      isAutoOpenItems: record?.isAutoOpenItems ?? false,
      chapterParentId: record?.chapterParentId ?? null,
    };
  }

  async createNote(input?: CreateNoteInput): Promise<NoteDocument> {
    const id = buildNoteId(new Date());
    const text = normalizeText(input?.initialText ?? '');
    const title = input?.title ? input.title.trim() || titleFromText(text) : titleFromText(text);
    const createdAtMs = Date.now();
    const updatedAtMs = createdAtMs;

    if (input?.externalPath) {
      const externalPath = input.externalPath;
      const filePath = externalPath;
      this.databaseService.upsertNoteContent({
        id,
        title,
        filePath,
        externalPath,
        text,
        createdAtMs,
        updatedAtMs,
        isTemp: true,
        hasUnsavedChanges: false,
        syncMode: true,
      });
      await this.databaseService.addTagToNote(id, EXTERNAL_TAG, 0);
      return this.loadNote({ id });
    }

    await this.ensureNotesDir();
    const fileName = idToFileName(id);
    const filePath = path.join(this.notesDir, fileName);

    await fs.writeFile(filePath, text, 'utf8');
    const stat = await fs.stat(filePath);
    this.databaseService.upsertNoteContent({
      id,
      title,
      filePath,
      text,
      createdAtMs: stat.birthtimeMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
    });
    if (input?.initialTags?.length) {
      for (const tag of input.initialTags) {
        await this.databaseService.addTagToNote(id, tag, 0);
      }
    }
    return this.loadNote({ id });
  }

  // Every chapter-creation path shares the same shape: createNote() (which
  // awaits at least once internally -- ensureNotesDir/fs.writeFile/fs.stat)
  // followed by a synchronous link into parentNoteId's chapter list. That
  // await gives a concurrent deletion of the same parent (e.g. the user
  // deletes the whole chapter family from another section while this one's
  // reactive "create the auto-TOC chapter" effect is still mid-flight) room
  // to land first -- without this guard, the synchronous link step below
  // would throw a raw SQLite FOREIGN KEY constraint error, and worse, leave
  // the just-created note behind as a permanent, invisible orphan (a `notes`
  // row and, for a non-external note, a file on disk nothing will ever
  // reference or clean up again). Re-checks the parent still exists right
  // before linking (nothing async happens between that check and `link()`,
  // so no further interleaving is possible), and if it doesn't -- or `link`
  // itself still throws for any other reason -- deletes `chapterNoteId`
  // before surfacing the error, so a failed chapter-creation call never
  // leaves debris behind.
  private async linkChapterOrCleanUp<T>(parentNoteId: string, chapterNoteId: string, link: () => T): Promise<T> {
    if (!this.databaseService.getNoteRecord(parentNoteId)) {
      await this.deleteNote({ id: chapterNoteId }).catch(() => {});
      throw new Error(`Parent note ${parentNoteId} not found`);
    }
    try {
      return link();
    } catch (error) {
      await this.deleteNote({ id: chapterNoteId }).catch(() => {});
      throw error;
    }
  }

  // Creates a fresh empty note marked chapterOnly and appends it as
  // parentNoteId's last chapter -- the chapter bar's "+" button. Chapters
  // are otherwise full, independent notes (own tags, own file, own
  // snapshots); chapterOnly only controls menu-view visibility.
  async createChapterNote(parentNoteId: string): Promise<NoteDocument> {
    const created = await this.createNote({});
    this.databaseService.setNoteChapterOnly(created.id, true);
    await this.linkChapterOrCleanUp(parentNoteId, created.id, () => this.databaseService.addChapter(parentNoteId, created.id));
    return this.loadNote({ id: created.id });
  }

  // Creates the auto-generated Table of Contents chapter: an empty chapter
  // pinned to position 0 (before every real chapter), then immediately
  // populated by the same regeneration pass a later on-view refresh uses --
  // see regenerateAutoTocChapter's own doc comment for what that actually
  // does. Throws if one already exists for this parent (the toolbar toggle
  // button is the only caller, and it only ever calls this when
  // isAutoTocActive is false).
  async createAutoTocChapter(parentNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }> {
    if (this.databaseService.getAutoTocChapterNoteId(parentNoteId)) {
      throw new Error(`Parent ${parentNoteId} already has an auto-TOC chapter`);
    }

    const created = await this.createNote({});
    this.databaseService.setNoteChapterOnly(created.id, true);
    this.databaseService.setNoteAutoToc(created.id, true);
    await this.linkChapterOrCleanUp(parentNoteId, created.id, () => {
      this.databaseService.addChapter(parentNoteId, created.id);
      this.databaseService.pinChapterToFront(parentNoteId, created.id);
    });

    return this.regenerateAutoTocChapter(parentNoteId);
  }

  // Refreshes the auto-TOC chapter's content from the *current* state of the
  // parent and every real chapter -- called right before the auto-TOC
  // chapter is actually displayed (EditorSection.tsx's activateNote), so
  // it's always accurate the moment it's looked at without ever being
  // eagerly kept in sync in the background.
  //
  // The master index is rebuilt: the parent's own headings under a link to
  // the parent itself, then each chapter's own headings under a link to
  // that chapter. Every one of these links is built with
  // formatInternalNoteLink (internalNoteLinks.ts) -- the `@<noteId>`
  // scheme, addressed purely by real internal note ids (parentNoteId /
  // row.chapterNoteId), which every note has the instant it's created. This
  // is deliberately a *different* linking system from the user-facing
  // `$NOTE-ID§CHAPTER-ID` scheme (see usePreviewMarkdownRendering.tsx's
  // navigateToInternalPreviewLink): that one exists for a PERSON to type,
  // read, and remember, so it's built entirely around assignedId/chapterId
  // (ids that only exist because the user explicitly set them). Auto-TOC
  // navigation has no such audience -- it's generated and consumed
  // entirely by this app's own code -- so it has no business being gated on
  // whether the user happened to assign an id. The TOC is therefore always
  // fully linked, with or without any assigned id anywhere in the chain.
  //
  // A chapter's own entry is its own FIRST heading -- not a separate
  // chapter-id-labeled line above it. Opening the chapter from that entry
  // already lands at the top, at that very heading, which is what makes a
  // separate identity line redundant. (A chapter with no heading at all yet
  // -- an edge case the heading-level invariant doesn't prevent, since it
  // only clamps existing headings, never synthesizes one -- falls back to
  // the same identity label its own pill would show, via
  // resolveIdentityLabel: its chapterId if assigned, otherwise a live
  // content-derived snippet, same as always. That's purely a display
  // choice, unrelated to the link itself, which is always present.) Every
  // other heading nests one level under it.
  //
  // Heading anchor ids are computed on the fly (computeHeadingAnchors) and
  // wrapped in a `heading:` fragment (formatHeadingAnchorFragment) --
  // deliberately never rewriting the parent's or any chapter's own heading
  // source just because a second chapter came into existence. Neither the
  // parent nor any chapter is ever read back through saveNote here; only the
  // TOC chapter's own content changes. See computeHeadingAnchors's doc
  // comment for the full rationale.
  async regenerateAutoTocChapter(parentNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }> {
    const tocChapterNoteId = this.databaseService.getAutoTocChapterNoteId(parentNoteId);
    if (!tocChapterNoteId) {
      throw new Error(`Parent ${parentNoteId} has no auto-TOC chapter to regenerate`);
    }

    const parentRecord = this.databaseService.getNoteRecord(parentNoteId);
    if (!parentRecord) {
      throw new Error(`Parent note ${parentNoteId} not found`);
    }

    const parentDoc = await this.loadNote({ id: parentNoteId });
    const parentHeadings = computeHeadingAnchors(parentDoc.text);
    const parentHref = formatInternalNoteLink(parentNoteId);

    const lines = ['# Table of Contents', '', formatOutlineEntryLine(0, parentRecord.title || 'Untitled', parentHref)];
    for (const heading of parentHeadings) {
      lines.push(formatOutlineEntryLine(1, heading.label, formatInternalNoteLink(parentNoteId, formatHeadingAnchorFragment(heading.anchorId))));
    }

    const chapterRows = this.getRealChapterRows(parentNoteId);
    for (const row of chapterRows) {
      const chapterDoc = await this.loadNote({ id: row.chapterNoteId });
      const [rootHeading, ...restHeadings] = computeHeadingAnchors(chapterDoc.text);

      const rootHref = formatInternalNoteLink(row.chapterNoteId);
      const rootLabel = rootHeading ? rootHeading.label : resolveIdentityLabel(row.chapterId, chapterDoc.text).text;
      lines.push(formatOutlineEntryLine(0, rootLabel, rootHref));
      for (const heading of restHeadings) {
        lines.push(formatOutlineEntryLine(1, heading.label, formatInternalNoteLink(row.chapterNoteId, formatHeadingAnchorFragment(heading.anchorId))));
      }
    }

    const tocText = lines.join('\n');
    const currentTocDoc = await this.loadNote({ id: tocChapterNoteId });
    if (tocText !== currentTocDoc.text) {
      await this.saveNote({ id: tocChapterNoteId, text: tocText }, { skipAutoChapterHooks: true });
    }

    const chapters = this.databaseService.listChaptersForNote(parentNoteId);
    const created = await this.loadNote({ id: tocChapterNoteId });
    return { chapters, created };
  }

  // The single canonical source of "real" chapters for parentNoteId --
  // every row in listChaptersForNote() with the auto-TOC and auto-Open-Items
  // chapters (if either exists) excluded, decided the same way in exactly
  // one place: by reading each chapter note's own isAutoToc/isAutoOpenItems
  // flags off its NoteRecord. Every content-facing consumer in this file
  // (TOC regeneration, Open-Items family ordering, and any future one) MUST
  // go through this rather than re-deriving its own exclusion filter --
  // that duplication is exactly how regenerateAutoTocChapter previously
  // excluded only the TOC chapter itself and left the auto-Open-Items
  // chapter to be walked as if it were a real chapter (its own "## Bugs" /
  // "## Features" group headings got anchor-linkified and indexed as
  // duplicate, malformed chapter entries in the generated TOC). If a third
  // auto-chapter kind is ever added, extend the check inside this one
  // function -- nowhere else.
  private getRealChapterRows(parentNoteId: string): ChapterEntry[] {
    return this.databaseService.listChaptersForNote(parentNoteId)
      .filter((chapter) => {
        const chapterRecord = this.databaseService.getNoteRecord(chapter.chapterNoteId);
        return chapterRecord ? !chapterRecord.isAutoToc && !chapterRecord.isAutoOpenItems : false;
      });
  }

  // The parent, then every *real* (non-auto) chapter, in current chapter-bar
  // order -- the canonical ordering the auto-Open-Items chapter's own groups
  // are kept sorted against, both when a group is (re)written
  // (regenerateOpenItemsGroup) and when chapters are reordered with no text
  // change at all (resyncOpenItemsOrder).
  private openItemsFamilyOrder(parentNoteId: string): string[] {
    const realChapterIds = this.getRealChapterRows(parentNoteId).map((chapter) => chapter.chapterNoteId);
    return [parentNoteId, ...realChapterIds];
  }

  // Drops `noteIdToRemove`'s own group out of the auto-Open-Items chapter --
  // used both when that note's checklist items all became empty/checked
  // (regenerateOpenItemsGroup) and when the note itself is being permanently
  // deleted (removeChapterAndSyncOpenItems). Removing the last remaining
  // group deletes the whole Open-Items chapter, mirroring the "disappears
  // when there are none left" requirement -- an empty title with nothing
  // under it is never left behind.
  private async dropOpenItemsGroup(parentNoteId: string, openItemsChapterNoteId: string, noteIdToRemove: string): Promise<void> {
    const currentDoc = await this.loadNote({ id: openItemsChapterNoteId });
    const remainingGroups = parseOpenItemsGroups(currentDoc.text).filter((group) => group.noteId !== noteIdToRemove);
    const nextText = assembleOpenItemsText(remainingGroups);

    if (nextText === null) {
      this.databaseService.removeChapter(parentNoteId, openItemsChapterNoteId);
      await this.deleteNote({ id: openItemsChapterNoteId });
      return;
    }

    if (nextText !== currentDoc.text) {
      await this.saveNote({ id: openItemsChapterNoteId, text: nextText });
    }
  }

  // Re-derives and patches *only* `changedNoteId`'s own group inside the
  // auto-Open-Items chapter -- called from saveNote whenever a checklist
  // item was created or its checked state flipped (see checklistStateChanged's
  // own doc comment for exactly what does and doesn't count). Every other
  // note's already-correct group markdown is left untouched, which is what
  // makes this an incremental patch rather than a rescan of the whole
  // chapter family: costs one read on the changed note (buildOpenItemsGroupMarkdown
  // derives its heading anchors on the fly, same as the auto-TOC chapter --
  // the changed note's own content is never written back just to build this
  // group) and one read/write on the auto-Open-Items chapter itself.
  //
  // Requires the auto-TOC chapter to already exist -- same "at least one
  // real chapter" precondition regenerateAutoTocChapter has, and TOC is
  // always created first (its own reactive creation effect in
  // useNoteChapters.ts fires the moment the first real chapter appears,
  // before the user has had a chance to type a checklist item into it). If
  // it's missing, this save landed in that brief window; the next
  // checklist-changing save on any family member simply retries.
  async regenerateOpenItemsGroup(parentNoteId: string, changedNoteId: string): Promise<void> {
    if (!this.databaseService.getAutoTocChapterNoteId(parentNoteId)) return;

    const changedDoc = await this.loadNote({ id: changedNoteId });
    const parentRecord = this.databaseService.getNoteRecord(parentNoteId);
    if (!parentRecord) return;

    // Same internal-only `@noteId` addressing regenerateAutoTocChapter uses
    // (formatInternalNoteLink, internalNoteLinks.ts) -- an Open Items entry
    // is always exactly as clickable as the TOC's own entry for the same
    // note/chapter, with or without any user-assigned id. The label shown
    // (groupLabel) is a separate, purely cosmetic concern: the parent's own
    // title, or a chapter's chapterId/derived-snippet via resolveIdentityLabel,
    // same as regenerateAutoTocChapter's own TOC-entry label.
    const linkPrefix = formatInternalNoteLink(changedNoteId);
    let groupLabel: string;
    if (changedNoteId === parentNoteId) {
      groupLabel = changedDoc.title || 'Untitled';
    } else {
      const chapterId = this.databaseService.listChaptersForNote(parentNoteId).find((row) => row.chapterNoteId === changedNoteId)?.chapterId ?? null;
      groupLabel = resolveIdentityLabel(chapterId, changedDoc.text).text;
    }

    const newGroupMarkdown = buildOpenItemsGroupMarkdown(changedDoc.text, linkPrefix, groupLabel);

    let openItemsChapterNoteId = this.databaseService.getAutoOpenItemsChapterNoteId(parentNoteId);

    if (newGroupMarkdown === null) {
      if (openItemsChapterNoteId) {
        await this.dropOpenItemsGroup(parentNoteId, openItemsChapterNoteId, changedNoteId);
      }
      return;
    }

    if (!openItemsChapterNoteId) {
      const created = await this.createNote({});
      this.databaseService.setNoteChapterOnly(created.id, true);
      this.databaseService.setNoteAutoOpenItems(created.id, true);
      await this.linkChapterOrCleanUp(parentNoteId, created.id, () => {
        this.databaseService.addChapter(parentNoteId, created.id);
        this.databaseService.pinChapterAfterAutoToc(parentNoteId, created.id);
      });
      openItemsChapterNoteId = created.id;
    }

    const currentDoc = await this.loadNote({ id: openItemsChapterNoteId });
    const existingGroups = parseOpenItemsGroups(currentDoc.text).filter((group) => group.noteId !== changedNoteId);
    const familyOrder = this.openItemsFamilyOrder(parentNoteId);
    const orderIndex = new Map(familyOrder.map((id, index) => [id, index]));
    const nextGroups = [...existingGroups, { noteId: changedNoteId, markdown: newGroupMarkdown }]
      .sort((a, b) => (orderIndex.get(a.noteId) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.noteId) ?? Number.MAX_SAFE_INTEGER));

    const nextText = assembleOpenItemsText(nextGroups);
    if (nextText !== null && nextText !== currentDoc.text) {
      await this.saveNote({ id: openItemsChapterNoteId, text: nextText });
    }
  }

  // Re-sorts the auto-Open-Items chapter's already-correct groups to match a
  // fresh chapter order with no text regeneration at all -- the "reorder
  // reorders the list without a rescan" half of the Open Items contract.
  private async resyncOpenItemsOrder(parentNoteId: string): Promise<void> {
    const openItemsChapterNoteId = this.databaseService.getAutoOpenItemsChapterNoteId(parentNoteId);
    if (!openItemsChapterNoteId) return;

    const currentDoc = await this.loadNote({ id: openItemsChapterNoteId });
    const groups = parseOpenItemsGroups(currentDoc.text);
    if (groups.length === 0) return;

    const familyOrder = this.openItemsFamilyOrder(parentNoteId);
    const orderIndex = new Map(familyOrder.map((id, index) => [id, index]));
    const sorted = [...groups].sort((a, b) => (orderIndex.get(a.noteId) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.noteId) ?? Number.MAX_SAFE_INTEGER));
    if (sorted.every((group, index) => group.noteId === groups[index].noteId)) return;

    const nextText = assembleOpenItemsText(sorted);
    if (nextText !== null && nextText !== currentDoc.text) {
      await this.saveNote({ id: openItemsChapterNoteId, text: nextText });
    }
  }

  // Wraps databaseService.reorderChapters with the Open Items "smart reorder"
  // sync -- every chapter-bar reorder (drag-and-drop, or any of the
  // extract/split/merge handlers repositioning a freshly-created chapter)
  // goes through this single choke point (main.ts's CHAPTER_CHANNELS.reorder
  // handler), so callers never need to remember to sync it themselves.
  async reorderChaptersAndSyncOpenItems(parentNoteId: string, orderedChapterNoteIds: string[]): Promise<ChapterEntry[]> {
    const chapters = this.databaseService.reorderChapters(parentNoteId, orderedChapterNoteIds);
    await this.resyncOpenItemsOrder(parentNoteId);
    return chapters;
  }

  // Wraps databaseService.removeChapter with the Open Items "smart delete"
  // sync -- drops the removed chapter's own group (if any) before the
  // chapter row itself is deleted, same single-choke-point reasoning as
  // reorderChaptersAndSyncOpenItems (main.ts's CHAPTER_CHANNELS.remove
  // handler). Guarded against `chapterNoteId` being the auto-Open-Items
  // chapter itself (its own removal, via the chapter bar's reactive cleanup
  // effect, has no "own group" to drop).
  async removeChapterAndSyncOpenItems(parentNoteId: string, chapterNoteId: string): Promise<ChapterEntry[]> {
    const openItemsChapterNoteId = this.databaseService.getAutoOpenItemsChapterNoteId(parentNoteId);
    if (openItemsChapterNoteId && openItemsChapterNoteId !== chapterNoteId) {
      await this.dropOpenItemsGroup(parentNoteId, openItemsChapterNoteId, chapterNoteId);
    }
    return this.databaseService.removeChapter(parentNoteId, chapterNoteId);
  }

  // Dragging a note from the sidebar onto a chapter bar: clones the dragged
  // note's content into a brand-new chapterOnly note and appends that as
  // parentNoteId's last chapter. The dragged note itself is never touched,
  // marked chapterOnly, or linked -- only already-chapterOnly notes can ever
  // be chapters (see the chapterOnly doc comment on NoteSummary), so this is
  // the only way a regular note's content reaches a chapter bar, and it's
  // also what rules out sub-chapters: a chapterOnly note is never a valid
  // drag source in the first place. The clone's headings are normalized
  // (see normalizeChapterHeadings' doc comment) the same way every other
  // chapter-creation path is -- the source note itself keeps its original
  // heading levels.
  async cloneNoteAsChapter(parentNoteId: string, sourceNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }> {
    const sourceRecord = this.databaseService.getNoteRecord(sourceNoteId);
    if (sourceRecord?.chapterOnly) {
      throw new Error(`Cannot clone chapter-only note ${sourceNoteId} as a chapter -- only regular notes can be dragged onto a chapter bar`);
    }

    const source = await this.loadNote({ id: sourceNoteId });
    // title explicit, not re-derived from the shifted text: titleFromText
    // only recognizes a level-1 "# " heading, so a shifted "## Title" would
    // otherwise fall through to using that whole line (hashes and all) as
    // the title instead.
    const created = await this.createNote({ initialText: normalizeChapterHeadings(source.text), title: source.title });
    this.databaseService.setNoteChapterOnly(created.id, true);
    const chapters = await this.linkChapterOrCleanUp(parentNoteId, created.id, () => this.databaseService.addChapter(parentNoteId, created.id));
    const createdDocument = await this.loadNote({ id: created.id });
    return { chapters, created: createdDocument };
  }

  // Clones a past snapshot of an existing note into a brand-new, independent
  // note: same content as of that moment, same tags, and the shared snapshot
  // history up to (and including) the branch point. The two notes diverge
  // from here on -- the branch has no further connection to the source note.
  async branchNoteFromSnapshot(input: BranchNoteFromSnapshotInput): Promise<NoteDocument> {
    const snapshot = this.databaseService.getSnapshotById(input.snapshotId);
    if (!snapshot || snapshot.noteId !== input.sourceNoteId) {
      throw new Error(`Snapshot ${input.snapshotId} does not belong to note ${input.sourceNoteId}`);
    }

    const sourceRecord = this.databaseService.getNoteRecord(input.sourceNoteId);
    const sourceTitle = sourceRecord?.title?.trim() || titleFromText(snapshot.content);
    const sourceTags = this.databaseService.getNoteTags(input.sourceNoteId);

    const branchLabel = formatBranchLabel(new Date(snapshot.timestamp));
    const newTitle = `${stripExistingBranchSuffix(sourceTitle)} [Branch: ${branchLabel}]`;

    const created = await this.createNote({
      initialText: snapshot.content,
      title: newTitle,
      initialTags: sourceTags,
    });

    return this.loadNote({ id: created.id });
  }

  // `skipAutoChapterHooks` is internal-only (not part of the public
  // SaveNoteInput IPC type) -- set by regenerateAutoTocChapter's own save of
  // the TOC chapter's own freshly-rebuilt text, belt-and-suspenders on top
  // of the `isAutoChapter` gate a few lines below (which already excludes
  // auto-chapters from the checklist-diff/heading-diff hooks entirely, since
  // an auto-chapter's own content is generated output, not something a
  // regeneration pass should ever react to as if the user had edited it).
  // Neither hook ever mutates the parent's or a real chapter's own content
  // -- both auto-TOC and auto-Open-Items generation compute their heading
  // anchors on the fly (computeHeadingAnchors) instead of rewriting heading
  // source into the note itself, so there's no write-triggers-another-write
  // recursion risk here to guard against on that side either.
  async saveNote(input: SaveNoteInput, options?: { skipAutoChapterHooks?: boolean }): Promise<NoteSummary> {
    const record = this.databaseService.getNoteRecord(input.id);
    const filePath = record?.filePath ?? path.join(this.notesDir, idToFileName(input.id));
    const text = normalizeText(input.text);

    if (record?.isTemp) {
      const nowMs = Date.now();
      const snapshotRows = await this.getNoteSnapshots({ id: input.id });
      const originalSnapshotRow = snapshotRows.find((row) => !row.isManual) ?? snapshotRows[0];
      const originalSnapshotText = originalSnapshotRow ? normalizeText(originalSnapshotRow.content) : null;
      const isCleanAgainstOriginal = originalSnapshotText !== null && originalSnapshotText === text;
      const hasUnsavedChanges = !isCleanAgainstOriginal;
      const syncMode = isCleanAgainstOriginal ? true : false;

      this.databaseService.upsertNoteContent({
        id: input.id,
        title: titleFromText(text),
        filePath,
        externalPath: record.externalPath,
        text,
        createdAtMs: record.createdAtMs,
        updatedAtMs: nowMs,
        isTemp: true,
        hasUnsavedChanges,
        syncMode,
        cursorPos: input.cursorPos,
        previewBlockCache: input.previewBlockCache ? JSON.stringify(input.previewBlockCache) : null,
      });
      this.databaseService.updateTempNoteState(input.id, hasUnsavedChanges, syncMode);
      const summary = await this.readSummary(this.databaseService.getNoteRecord(input.id) ?? {
        id: input.id,
        title: titleFromText(text),
        filePath,
        createdAtMs: record.createdAtMs,
        updatedAtMs: nowMs,
        contentChecksum: null,
        isTemp: true,
        externalPath: record.externalPath,
        hasUnsavedChanges,
        syncMode,
        assignedId: record.assignedId ?? null,
        previewBlockCache: null,
        chapterOnly: record.chapterOnly,
        isAutoToc: record.isAutoToc,
        isAutoOpenItems: record.isAutoOpenItems,
        chapterParentId: record.chapterParentId,
      });

      if (!summary) {
        throw new Error(`Failed to read saved temp note summary for id=${input.id}`);
      }

      return summary;
    }

    // Cheap "is this note part of a chapter family" check up front (a
    // handful of DB reads, no I/O) so the file read below -- needed only to
    // diff checklist/heading state against the pre-save text -- is skipped
    // entirely for the vast majority of saves, which touch a note with no
    // chapters at all. Auto-generated chapters (TOC, Open Items) are
    // excluded here even though they *are* chapters -- Open Items' own text
    // contains literal `- [ ] ...` lines by design, and diffing those
    // against themselves would otherwise regenerate the very group it just
    // wrote; TOC's own text is all headings that just got rewritten, same
    // problem. Shared between the checklist-diff (Open Items) and
    // heading-diff (TOC) hooks below -- both need the same "which parent,
    // what did it look like before this save" facts.
    const isAutoChapter = Boolean(record?.isAutoToc || record?.isAutoOpenItems);
    const chapterFamilyParentId = isAutoChapter
      ? null
      : (this.databaseService.getChapterParent(input.id) ?? (this.databaseService.listChaptersForNote(input.id).length > 0 ? input.id : null));
    let oldTextForChapterFamilyDiff: string | null = null;
    if (chapterFamilyParentId && !options?.skipAutoChapterHooks) {
      try {
        oldTextForChapterFamilyDiff = await fs.readFile(filePath, 'utf8');
      } catch {
        oldTextForChapterFamilyDiff = null;
      }
    }

    await fs.writeFile(filePath, text, 'utf8');
    const stat = await fs.stat(filePath);
    this.databaseService.upsertNoteContent({
      id: input.id,
      title: titleFromText(text),
      filePath,
      text,
      createdAtMs: stat.birthtimeMs || record?.createdAtMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
      externalPath: record?.externalPath ?? null,
      hasUnsavedChanges: record?.hasUnsavedChanges ?? false,
      syncMode: record?.syncMode ?? false,
      cursorPos: input.cursorPos,
      previewBlockCache: input.previewBlockCache ? JSON.stringify(input.previewBlockCache) : null,
    });
    const summary = await this.readSummary(this.databaseService.getNoteRecord(input.id) ?? {
      id: input.id,
      title: titleFromText(text),
      filePath,
      createdAtMs: stat.birthtimeMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
      contentChecksum: null,
      isTemp: false,
      externalPath: null,
      hasUnsavedChanges: false,
      syncMode: false,
      assignedId: record?.assignedId ?? null,
      previewBlockCache: null,
      chapterOnly: record?.chapterOnly ?? false,
      isAutoToc: record?.isAutoToc ?? false,
      isAutoOpenItems: record?.isAutoOpenItems ?? false,
      chapterParentId: record?.chapterParentId ?? null,
    });

    if (!summary) {
      throw new Error(`Failed to read saved note summary for id=${input.id}`);
    }

    // Only ever triggers on the two events the auto-Open-Items chapter is
    // meant to update on -- a checklist item created/removed, or an existing
    // one's checked state flipped (see checklistStateChanged) -- never on a
    // plain text edit, and never blocks the save itself if it fails.
    if (!options?.skipAutoChapterHooks && chapterFamilyParentId && oldTextForChapterFamilyDiff !== null && checklistStateChanged(oldTextForChapterFamilyDiff, text)) {
      try {
        await this.regenerateOpenItemsGroup(chapterFamilyParentId, input.id);
      } catch {
        // best-effort -- the list will catch up on the next checklist-changing save
      }
    }

    // Same debounce-riding, best-effort pattern as the checklist-diff hook
    // above, keyed on heading changes instead: a heading added/removed/
    // relabeled/re-leveled in the parent or any real chapter refreshes the
    // auto-TOC chapter immediately (on this save's own debounce) rather than
    // waiting for the TOC chapter to actually be viewed.
    if (!options?.skipAutoChapterHooks && chapterFamilyParentId && oldTextForChapterFamilyDiff !== null && headingsChanged(oldTextForChapterFamilyDiff, text)) {
      const tocChapterNoteId = this.databaseService.getAutoTocChapterNoteId(chapterFamilyParentId);
      if (tocChapterNoteId) {
        try {
          await this.regenerateAutoTocChapter(chapterFamilyParentId);
        } catch {
          // best-effort -- the TOC will catch up on the next heading-changing save, or the next time it's viewed
        }
      }
    }

    return summary;
  }

  // Chapters have no life outside their parent -- deleting a parent note
  // must delete its chapters' files too, not just their DB rows (which
  // databaseService.deleteNote already cascades). Recurses one level (chapters
  // can't have sub-chapters, so listChaptersForNote on a chapter is always
  // empty) before deleting the note's own file/row.
  async deleteNote(input: DeleteNoteInput): Promise<void> {
    const chapterEntries = this.databaseService.listChaptersForNote(input.id);
    for (const chapter of chapterEntries) {
      await this.deleteNote({ id: chapter.chapterNoteId });
    }

    const record = this.databaseService.getNoteRecord(input.id);

    if (record?.isTemp) {
      this.databaseService.deleteTempNote(input.id);
      return;
    }

    const filePath = record?.filePath ?? path.join(this.notesDir, idToFileName(input.id));
    await fs.unlink(filePath);
    this.databaseService.deleteNote(input.id);
  }

  async saveNoteUiState(input: { id: string; payload: NoteUiStatePayload }): Promise<void> {
    const payload: Parameters<DatabaseService['saveNoteUiState']>[1] = {
      anchorBlockIndex: input.payload.anchorBlockIndex,
      cursorPos: input.payload.cursorPos,
      previewBlockCache: input.payload.previewBlockCache
        ? JSON.stringify(input.payload.previewBlockCache)
        : input.payload.previewBlockCache,
    };
    this.databaseService.saveNoteUiState(input.id, payload);
  }

  async getNoteUiState(input: LoadNoteInput): Promise<NoteUiState> {
    const uiState = this.databaseService.getNoteUiState(input.id);
    let previewBlockCache: NoteUiState['previewBlockCache'] = null;
    if (uiState.previewBlockCache) {
      try {
        previewBlockCache = JSON.parse(uiState.previewBlockCache) as NoteUiState['previewBlockCache'];
      } catch {
        previewBlockCache = null;
      }
    }
    return {
      anchorBlockIndex: uiState.anchorBlockIndex,
      cursorPos: uiState.cursorPos,
      previewBlockCache,
    };
  }

  async updateExternalNoteState(input: { id: string; hasUnsavedChanges: boolean; syncMode: boolean }): Promise<NoteSummary> {
    this.databaseService.updateTempNoteState(input.id, input.hasUnsavedChanges, input.syncMode);
    const summary = await this.readSummary(this.databaseService.getNoteRecord(input.id)!);
    if (!summary) {
      throw new Error(`Failed to read updated external note summary for id=${input.id}`);
    }
    return summary;
  }

  async saveNoteSnapshot(input: { id: string; content: string; isManual?: boolean }): Promise<number> {
    return this.databaseService.saveNoteSnapshot(input.id, input.content, Boolean(input.isManual));
  }

  async getNoteSnapshots(input: LoadNoteInput): Promise<Array<{ id: number; noteId: string; content: string; timestamp: string; isManual: boolean }>> {
    return this.databaseService.getNoteSnapshots(input.id);
  }

  async saveSnapshotAnchor(input: { snapshotId: number; anchorBlockIndex: number | null }): Promise<void> {
    this.databaseService.saveSnapshotAnchor(input.snapshotId, input.anchorBlockIndex);
  }

  async getSnapshotAnchor(input: { snapshotId: number }): Promise<number> {
    return this.databaseService.getSnapshotAnchor(input.snapshotId);
  }

  async deleteNoteSnapshot(input: DeleteNoteSnapshotInput): Promise<void> {
    this.databaseService.deleteNoteSnapshot(input.snapshotId);
  }


  async syncExternalNoteToFile(input: { id: string; content: string }): Promise<boolean> {
    const record = this.databaseService.getNoteRecord(input.id);
    if (!record?.isTemp || !record.externalPath) {
      return false;
    }

    try {
      await fs.writeFile(record.externalPath, input.content, 'utf8');
      const verification = await fs.readFile(record.externalPath, 'utf8');
      if (verification !== input.content) {
        return false;
      }
      this.databaseService.markExternalNoteSynced(input.id);
      return true;
    } catch {
      return false;
    }
  }

  async getNoteIdByExternalPath(input: { externalPath: string }): Promise<string | null> {
    return this.databaseService.getTempNoteIdByExternalPath(input.externalPath);
  }

  async getNoteTags(input: LoadNoteInput): Promise<string[]> {
    return this.databaseService.getNoteTags(input.id);
  }

  async addTagToNote(input: AddTagInput): Promise<string[]> {
    return this.databaseService.addTagToNote(input.id, input.tagName, input.position);
  }

  async removeTagFromNote(input: RemoveTagInput): Promise<string[]> {
    const record = this.databaseService.getNoteRecord(input.id);
    const removingExternalTag = isExternalTag(input.tagName);

    if (record?.isTemp && removingExternalTag) {
      await this.ensureNotesDir();
      const { filePath } = this.notePathFromId(input.id);
      const snapshot = this.databaseService.getNoteContentSnapshot(input.id) ?? '';
      await fs.writeFile(filePath, snapshot, 'utf8');
      const stat = await fs.stat(filePath);

      this.databaseService.convertTempNoteToRegular(input.id, filePath);
      this.databaseService.upsertNoteContent({
        id: input.id,
        title: titleFromText(snapshot),
        filePath,
        text: snapshot,
        createdAtMs: record.createdAtMs,
        updatedAtMs: stat.mtimeMs,
      });

      return this.databaseService.removeTagFromNote(input.id, EXTERNAL_TAG);
    }

    return this.databaseService.removeTagFromNote(input.id, input.tagName);
  }

  async reorderNoteTags(input: ReorderTagsInput): Promise<string[]> {
    return this.databaseService.reorderNoteTags(input.id, input.tagNames);
  }

  async renameTag(input: RenameTagInput): Promise<{ updatedNoteIds: string[] }> {
    return this.databaseService.renameTag(input);
  }

  /**
   * Assigns a user-entered `$id` value to a note (tab-bar label). Always
   * overwrites any existing internal ID; collisions with another note's ID
   * get an incremental "-2", "-3", ... suffix. Returns the refreshed
   * summary so the renderer can pick up the resolved ID immediately.
   */
  async setNoteAssignedId(input: { id: string; requestedId: string }): Promise<NoteSummary | null> {
    this.databaseService.setNoteAssignedId(input.id, input.requestedId);
    const record = this.databaseService.getNoteRecord(input.id);
    if (!record) return null;
    return this.readSummary(record);
  }

  async listTags(): Promise<TagSummary[]> {
    return this.databaseService.listTags();
  }
}
