import type { SidebarMode } from './appState';

/**
 * The sidebar's VIEWS and their SECTIONS.
 *
 * The view bar holds the views: Notes, Images, the Music Library, Find and
 * Options. Notes and Images each hold SECTIONS, chosen in a section selector
 * at the top of the list: both have by date, by category, the archive and the
 * trash, and Notes has a fifth, External, which is the only place notes
 * opened from files outside the app are listed. The Music Library's sections
 * are the music sets; Find and Options have none of this kind.
 *
 * `SidebarMode` names what the sidebar shows at the section level ('date',
 * 'category', 'archive', 'trash', 'external', or one of the views without
 * list sections),
 * and a separate flag says whether the list sections show images. This module
 * holds the section each of the two list views was last on, so pressing a
 * view's button returns to it.
 */
export type SidebarListSection = 'date' | 'category' | 'archive' | 'trash' | 'external';
export type SidebarListView = 'notes' | 'images';
export type SidebarSections = Record<SidebarListView, SidebarListSection>;

/** Which sections each list view has, in the section selector's order. */
export const SECTIONS_OF_VIEW: Record<SidebarListView, readonly SidebarListSection[]> = {
  notes: ['date', 'category', 'archive', 'external', 'trash'],
  images: ['date', 'category', 'archive', 'trash'],
};

export const DEFAULT_SIDEBAR_SECTIONS: SidebarSections = { notes: 'date', images: 'date' };

export function isSidebarListSection(mode: unknown): mode is SidebarListSection {
  return SECTIONS_OF_VIEW.notes.includes(mode as SidebarListSection);
}

/**
 * The sections that are one flat list of note cards, fifty to a page and
 * scrolling (`NOTES_PER_PAGE` in App.tsx), rather than a category tree.
 */
export function isPagedNoteSection(mode: unknown): mode is 'date' | 'trash' | 'external' {
  return mode === 'date' || mode === 'trash' || mode === 'external';
}

export function sidebarListViewOf(showsImages: boolean): SidebarListView {
  return showsImages ? 'images' : 'notes';
}

/** `sections` with `mode` recorded as its view's section, when `mode` is a list section at all. */
export function rememberSidebarSection(sections: SidebarSections, mode: SidebarMode, showsImages: boolean): SidebarSections {
  if (!isSidebarListSection(mode)) return sections;
  const view = sidebarListViewOf(showsImages);
  if (!SECTIONS_OF_VIEW[view].includes(mode)) return sections;
  return sections[view] === mode ? sections : { ...sections, [view]: mode };
}

export function sanitizeSidebarSections(input: unknown): SidebarSections {
  const candidate = (input ?? {}) as Partial<Record<SidebarListView, unknown>>;
  return {
    notes: isSidebarListSection(candidate.notes) ? candidate.notes : DEFAULT_SIDEBAR_SECTIONS.notes,
    images: SECTIONS_OF_VIEW.images.includes(candidate.images as SidebarListSection)
      ? candidate.images as SidebarListSection
      : DEFAULT_SIDEBAR_SECTIONS.images,
  };
}
