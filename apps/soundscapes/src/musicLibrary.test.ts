import { describe, expect, it } from 'vitest';
import { addScanToSet, chooseSong, createSet, deleteSet, likeSong, nextSong, poolOf, removeFromSet, sanitizeCatalog, sanitizeRotation, setCounts, settleRotation, stepBackRotation, type MusicCatalog } from './musicLibrary';

function song(id: number, setIds: number[], title = `Song ${id}`) {
  return { id, filePath: `content://music/${id}`, setIds, title, artist: '', album: '', durationSec: 0, likes: 0 };
}

const catalog: MusicCatalog = {
  songs: [song(1, [1]), song(2, [1]), song(3, [2]), song(4, [1, 2], 'Blue')],
  sets: [{ slot: 1, name: 'One', icon: null }, { slot: 2, name: 'Two', icon: null }],
  folders: [],
  activeSetIds: [1],
  filter: { query: '', enabled: true },
  playMode: 'mix',
};

const rotation = [{ id: 1, due: 0 }, { id: 2, due: 1 }, { id: 3, due: 2 }, { id: 4, due: 3 }];

describe('the Android music library', () => {
  it('pools the active sets, filtered, in queue order, unplaced songs last', () => {
    expect(poolOf(catalog, rotation).map((entry) => entry.id)).toEqual([1, 2, 4]);
    expect(poolOf({ ...catalog, filter: { query: 'blue', enabled: true } }, rotation).map((entry) => entry.id)).toEqual([4]);
    // Switched off, the query is kept and filters nothing.
    expect(poolOf({ ...catalog, filter: { query: 'blue', enabled: false } }, rotation).map((entry) => entry.id)).toEqual([1, 2, 4]);
    expect(poolOf(catalog, [{ id: 2, due: 0 }]).map((entry) => entry.id)).toEqual([2, 1, 4]);
  });

  it('places every song, drops the ones gone, and generates the mix on a first run', () => {
    expect(settleRotation(catalog, [{ id: 9, due: 0 }, { id: 1, due: 5 }], () => 0).map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
    expect(new Set(settleRotation(catalog, [], Math.random).map((entry) => entry.due)).size).toBe(4);
  });

  it('plays through the pool without repeating until every song has played', () => {
    let current: number | null = null;
    let next = rotation;
    const played: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const move = nextSong(catalog, next, current);
      next = move.rotation;
      current = move.song!.id;
      played.push(current);
    }
    expect(played).toEqual([1, 2, 4, 1, 2, 4]);
  });

  it('plays in folder order when the mode says so', () => {
    const ordered = { ...catalog, playMode: 'order' as const, songs: catalog.songs.map((entry) => ({ ...entry, filePath: `content://music/${5 - entry.id}` })) };
    expect(poolOf(ordered, rotation).map((entry) => entry.id)).toEqual([4, 2, 1]);
    expect(nextSong(ordered, rotation, 2)).toEqual({ song: expect.objectContaining({ id: 1 }), rotation });
  });

  it('plays a chosen song at once and goes back to the one before', () => {
    const chosen = chooseSong(catalog, rotation, 1, 4);
    expect(chosen.song?.id).toBe(4);
    expect(poolOf(catalog, chosen.rotation).map((entry) => entry.id)).toEqual([4, 2, 1]);
    const back = stepBackRotation(catalog, chosen.rotation, 4, 1);
    expect(poolOf(catalog, back).map((entry) => entry.id)).toEqual([1, 4, 2]);
    // A song the pool leaves out is played as given.
    expect(chooseSong(catalog, rotation, 1, 3).song?.id).toBe(3);
  });

  it('likes a song in steps, held to the range', () => {
    expect(likeSong(catalog, 1, 1).songs[0].likes).toBe(1);
    expect(likeSong(catalog, 1, -40).songs[0].likes).toBe(-10);
    expect(likeSong(catalog, 99, 1)).toBe(catalog);
  });

  it('reads catalogs and rotations stored before likes, play modes and dues', () => {
    const old = sanitizeCatalog({ songs: [{ ...song(1, [1]), likes: undefined }] });
    expect(old.songs[0].likes).toBe(0);
    expect(old.playMode).toBe('mix');
    expect(sanitizeRotation([{ id: 1, priority: 3, favorability: 2 }, { id: 2, due: 4 }])).toEqual([{ id: 2, due: 4 }]);
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
