import { describe, expect, it } from 'vitest';
import { addScanToSet, chooseSong, createSet, deleteSet, nextSong, poolOf, removeFromSet, setCounts, type MusicCatalog } from './musicLibrary';

function song(id: number, setIds: number[], title = `Song ${id}`) {
  return { id, filePath: `content://music/${id}`, setIds, title, artist: '', album: '', durationSec: 0 };
}

const catalog: MusicCatalog = {
  songs: [song(1, [1]), song(2, [1]), song(3, [2]), song(4, [1, 2], 'Blue')],
  sets: [{ slot: 1, name: 'One', icon: null }, { slot: 2, name: 'Two', icon: null }],
  folders: [],
  activeSetIds: [1],
  filter: { query: '', enabled: true },
};

describe('the Android music library', () => {
  it('pools the active sets, filtered, new songs first', () => {
    expect(poolOf(catalog, []).map((entry) => entry.id)).toEqual([1, 2, 4]);
    expect(poolOf({ ...catalog, filter: { query: 'blue', enabled: true } }, []).map((entry) => entry.id)).toEqual([4]);
    // Switched off, the query is kept and filters nothing.
    expect(poolOf({ ...catalog, filter: { query: 'blue', enabled: false } }, []).map((entry) => entry.id)).toEqual([1, 2, 4]);
    expect(poolOf(catalog, [{ id: 1, priority: 5, favorability: 1 }]).map((entry) => entry.id)).toEqual([2, 4, 1]);
  });

  it('plays through the pool without repeating until every song has played', () => {
    let rotation = poolOf(catalog, []).map(({ id, priority, favorability }) => ({ id, priority, favorability }));
    let previous: number | null = null;
    const played: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const next = nextSong(catalog, rotation, previous, () => 0);
      rotation = next.rotation;
      previous = next.song!.id;
      played.push(previous);
    }
    expect(new Set(played).size).toBe(3);
  });

  it('makes a chosen song the next pick', () => {
    const rotation = chooseSong(catalog, [], 4);
    expect(nextSong(catalog, rotation, null, () => 0.99).song?.id).toBe(4);
  });

  it('adds a folder to a set, sharing songs already known, and deletes a set with its orphans', () => {
    const created = createSet(catalog);
    const slot = created.slot;
    const scanned = addScanToSet(created.catalog, slot, 'tree://a', ['content://music/3', 'content://new'], [
      { filePath: 'content://new', title: 'New', artist: '', album: '', durationSec: 1 },
    ]);
    expect(setCounts(scanned)[slot]).toBe(2);
    expect(scanned.songs.find((entry) => entry.filePath === 'content://new')?.id).toBe(5);
    const deleted = deleteSet(scanned, slot);
    expect(deleted.released).toEqual(['tree://a']);
    expect(deleted.catalog.songs.map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
    expect(removeFromSet(catalog, 2, [3]).songs.map((entry) => entry.id)).toEqual([1, 2, 4]);
  });
});
