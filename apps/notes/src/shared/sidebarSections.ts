import type { SidebarMode } from './appState';

/**
 * The sidebar's VIEWS and their SECTIONS.
 *
 * The view bar holds the views: Notes, Images, the Music Library, Find and
 * Options. Notes and Images each hold the same four SECTIONS (by date, by
 * category, the archive, the trash), chosen in a section selector at the top
 * of the list; the Music Library's sections are the music sets; Find and
 * Options have none of this kind.
 *
 * `SidebarMode` names what the sidebar shows at the section level ('date',
 * 'category', 'archive', 'trash', or one of the views without list sections),
 * and a separate flag says whether the list sections show images. This module
 * holds the section each of the two list views was last on, so pressing a
 * view's button returns to it.
 */
export type SidebarListSection = 'date' | 'category' | 'archive' | 'trash';
export type SidebarListView = 'notes' | 'images';
export type SidebarSections = Record<SidebarListView, SidebarListSection>;

export const DEFAULT_SIDEBAR_SECTIONS: SidebarSections = { notes: 'date', images: 'date' };

export function isSidebarListSection(mode: unknown): mode is SidebarListSection {
  return mode === 'date' || mode === 'category' || mode === 'archive' || mode === 'trash';
}

export function sidebarListViewOf(showsImages: boolean): SidebarListView {
  return showsImages ? 'images' : 'notes';
}

/** `sections` with `mode` recorded as its view's section, when `mode` is a list section at all. */
export function rememberSidebarSection(sections: SidebarSections, mode: SidebarMode, showsImages: boolean): SidebarSections {
  if (!isSidebarListSection(mode)) return sections;
  const view = sidebarListViewOf(showsImages);
  return sections[view] === mode ? sections : { ...sections, [view]: mode };
}

export function sanitizeSidebarSections(input: unknown): SidebarSections {
  const candidate = (input ?? {}) as Partial<Record<SidebarListView, unknown>>;
  return {
    notes: isSidebarListSection(candidate.notes) ? candidate.notes : DEFAULT_SIDEBAR_SECTIONS.notes,
    images: isSidebarListSection(candidate.images) ? candidate.images : DEFAULT_SIDEBAR_SECTIONS.images,
  };
}
